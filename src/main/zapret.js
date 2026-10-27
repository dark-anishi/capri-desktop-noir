'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { paths, verify } = require('./vpn/paths');

const DEFAULT_FOLDER = 'C:\\Users\\mailm\\Desktop\\zapret-discord-youtube-1.9.9d';
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function regular(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Zapret: ссылки и специальные файлы не поддерживаются.');
}
function inspectFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || folder.length > 1000 || /[\r\n\0]/.test(folder)) throw new Error('Некорректная папка Zapret.');
  regular(folder, true);
  const root = fs.realpathSync(folder);
  regular(path.join(root, 'bin'), true);
  const engines = fs.readdirSync(path.join(root, 'bin')).filter((name) => /\.exe$/i.test(name)).filter((name) => {
    try { regular(path.join(root, 'bin', name)); return true; } catch { return false; }
  });
  const batches = fs.readdirSync(root).filter((name) => /^general(?:[ ._(\w-].*)?\.bat$/i.test(name)).filter((name) => {
    try {
      regular(path.join(root, name));
      const source = fs.readFileSync(path.join(root, name), 'utf8').toLowerCase();
      return engines.some((engine) => source.includes(engine.toLowerCase()));
    } catch { return false; }
  }).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  if (!batches.length) throw new Error('В папке не найдены стратегии general*.bat с доступным движком в bin. Выбери распакованную папку Zapret.');
  return { folder: root, batches };
}
// Pin every executable, driver, library and batch used by the selected local distribution.
// The elevated helper rechecks and holds these files against writes for its entire lease.
function fingerprint(folder) {
  const files = {};
  function visit(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), relative = prefix + name, st = fs.lstatSync(file);
      if (st.isSymbolicLink()) throw new Error('Папка Zapret содержит ссылку. Используй обычную распакованную папку.');
      if (st.isDirectory()) { if (prefix.split('/').length > 5) throw new Error('Слишком сложная структура папки Zapret.'); visit(file, relative + '/'); }
      else if (/\.(?:bat|exe|dll|sys)$/i.test(name)) {
        if (!st.isFile() || st.size > 128 * 1024 * 1024 || Object.keys(files).length >= 512) throw new Error('Неподдерживаемая структура папки Zapret.');
        files[relative] = hash(file);
      }
    }
  }
  visit(folder); return files;
}
function launchHelper(app, spec, onExit, deps = {}) {
  const p = paths(app); verify(p.helper, JSON.parse(fs.readFileSync(p.manifest, 'utf8')).helperSha256);
  const child = (deps.spawn || spawn)(p.helper, ['--zapret'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let ready = false, settled = false, stopped = false, text = '', reason = '';
  const timeout = setTimeout(() => { reason = 'Запуск Zapret не завершён. Проверь окно UAC и выбранную стратегию.'; child.stdin.end(); }, deps.startTimeoutMs ?? 65000);
  let resolveReady, rejectReady;
  const started = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  function fail(message) { reason = message; if (!settled) { settled = true; rejectReady(new Error(message)); } }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    text += chunk;
    if (text.length > 128 * 1024) { fail('Некорректный ответ компонента Zapret.'); child.stdin.end(); return; }
    let end;
    while ((end = text.indexOf('\n')) !== -1) {
      const line = text.slice(0, end); text = text.slice(end + 1);
      try {
        const result = JSON.parse(line);
        if (result.ok === false) fail(result.code === 1223 ? 'Запуск Zapret отменён в окне UAC.' : result.error || 'Zapret не запустился.');
        if (result.phase === 'running' && !settled) { ready = true; settled = true; clearTimeout(timeout); resolveReady(); }
      } catch { /* Only protocol JSON is consumed, never batch output. */ }
    }
  });
  child.stderr.resume(); child.stdin.on('error', () => {});
  child.once('error', (e) => { clearTimeout(timeout); fail('Не удалось запустить компонент Zapret: ' + e.message); });
  const exited = new Promise((resolve) => child.once('close', () => {
    clearTimeout(timeout);
    if (!settled) fail(reason || 'Zapret завершился до запуска. Проверь стратегию и наличие другого Zapret.');
    resolve(); onExit(stopped ? '' : reason || (ready ? 'Zapret завершился. Можно запустить его снова.' : ''));
  }));
  child.stdin.write(JSON.stringify(spec) + '\n');
  let stopping;
  async function wait(ms) { let timer; try { await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]); } finally { clearTimeout(timer); } }
  return { started, stop() {
    if (stopping) return stopping;
    stopping = (async () => {
    stopped = true; child.stdin.end('stop\n');
    // The broker closes its lease; the elevated host owns the Job Object and disposes it.
    await wait(7000);
    if (child.exitCode === null && child.pid) { child.kill(); await wait(2000); }
    })(); return stopping;
  } };
}
function createZapret({ app, dialog, onChange = () => {}, launcher = launchHelper, platform = process.platform, storeFile } = {}) {
  const file = storeFile || path.join(app.getPath('userData'), 'zapret.json');
  const events = new EventEmitter();
  let saved = { folder: '', lastBat: '' }, batches = [], phase = 'stopped', error = '', runningBat = '', child = null, pending = null, closing = false, epoch = 0;
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (typeof value.folder === 'string' && typeof value.lastBat === 'string') saved = { folder: value.folder, lastBat: path.basename(value.lastBat) }; } catch { }
  function state() { return { phase, folder: saved.folder, lastBat: saved.lastBat, runningBat, batches: [...batches], error, supported: platform === 'win32' }; }
  function emit() { const value = state(); onChange(value); events.emit('change', value); }
  function save() { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(saved, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); }
  function refresh() { try { const info = inspectFolder(saved.folder); saved.folder = info.folder; batches = info.batches; return true; } catch { batches = []; return false; } }
  refresh();
  async function chooseFolder() {
    if (phase !== 'stopped' && phase !== 'error') throw new Error('Сначала останови Zapret.');
    const result = await dialog.showOpenDialog({ title: 'Выбери распакованную папку Zapret', defaultPath: saved.folder || DEFAULT_FOLDER, properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths?.[0]) return state();
    const info = inspectFolder(result.filePaths[0]); saved.folder = info.folder; batches = info.batches;
    if (!batches.includes(saved.lastBat)) saved.lastBat = '';
    save(); error = ''; phase = 'stopped'; emit(); return state();
  }
  async function start(bat) {
    if (closing) return state();
    if (platform !== 'win32') throw new Error('Zapret доступен только в Windows.');
    if (pending) return pending;
    if (child) return state();
    const currentEpoch = epoch;
    pending = (async () => {
      error = '';
      if (!refresh() || (!bat && saved.lastBat && !batches.includes(saved.lastBat))) {
        await chooseFolder();
        // A cancelled picker must never fall through to a stale saved strategy.
        if (!batches.length || (!bat && saved.lastBat && !batches.includes(saved.lastBat))) return state();
      }
      if (closing || currentEpoch !== epoch) return state();
      if (!refresh()) return state(); // Directory picker cancelled.
      const selected = bat || saved.lastBat;
      if (!selected) { emit(); return state(); } // First use: menu now shows the explicit strategies.
      if (typeof selected !== 'string' || !batches.includes(selected) || path.basename(selected) !== selected) throw new Error('Выбранная стратегия Zapret недоступна. Выбери её в меню.');
      phase = 'starting'; runningBat = selected; emit();
      let instance;
      try {
        const spec = { folder: saved.folder, batch: selected, files: fingerprint(saved.folder) };
        instance = launcher(app, spec, (message) => {
          if (child !== instance) return;
          child = null; runningBat = ''; phase = message ? 'error' : 'stopped'; error = message; emit();
        });
        child = instance;
        await instance.started;
        if (closing || currentEpoch !== epoch) { await instance.stop(); return state(); }
        saved.lastBat = selected; save(); phase = 'running'; emit();
      } catch (e) {
        if (instance) await instance.stop();
        if (child === instance) child = null;
        runningBat = '';
        if (closing || currentEpoch !== epoch) { phase = 'stopped'; error = ''; emit(); return state(); }
        phase = 'error'; error = e.message; emit(); throw e;
      }
      return state();
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function stop() {
    epoch++;
    const instance = child;
    if (!instance) return state();
    phase = 'stopping'; emit(); await instance.stop();
    if (child === instance) child = null;
    runningBat = ''; phase = 'stopped'; error = ''; emit(); return state();
  }
  async function select(bat) {
    if (typeof bat !== 'string' || !refresh() || !batches.includes(bat)) throw new Error('Некорректная стратегия Zapret.');
    if (child) await stop();
    return start(bat);
  }
  return { state, start, stop, select, chooseFolder, on: events.on.bind(events), async close() { closing = true; await stop(); pending?.catch(() => {}); events.removeAllListeners(); } };
}
module.exports = { createZapret, inspectFolder, fingerprint, launchHelper };
