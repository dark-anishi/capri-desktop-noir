'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createZapret, inspectFolder, fingerprint } = require('../src/main/zapret');
const { quickTemplate } = require('../src/main/quick-menu');

function fixture(t, engine = 'winws.exe') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-zapret-test-'));
  t.after(() => { assert.ok(dir.startsWith(path.join(os.tmpdir(), 'capri-zapret-test-'))); fs.rmSync(dir, { recursive: true, force: true }); });
  const folder = path.join(dir, 'Zapret & (strategies) !'); fs.mkdirSync(path.join(folder, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'bin', engine), 'TEST FIXTURE: NOT AN EXECUTABLE');
  for (const name of ['general.bat', 'general (ALT2).bat']) fs.writeFileSync(path.join(folder, name), '@rem fixture only bin\\' + engine);
  fs.writeFileSync(path.join(folder, 'service.bat'), 'never run');
  fs.writeFileSync(path.join(folder, 'cleanup.bat'), 'winws.exe');
  const file = path.join(dir, 'prefs.json'), calls = [], selected = [folder];
  let fail = false, launches = 0, stopCount = 0;
  const manager = createZapret({ platform: 'win32', storeFile: file, app: {}, dialog: { async showOpenDialog() { calls.push('picker'); const result = selected.shift(); return result ? { filePaths: [result] } : { canceled: true }; } }, launcher(_app, spec, exit) {
    calls.push(spec); launches++;
    return { started: fail ? Promise.reject(new Error('UAC cancelled fixture')) : Promise.resolve(), async stop() { stopCount++; exit(''); } };
  } });
  return { dir, folder, file, calls, selected, manager, fail: () => { fail = true; }, launches: () => launches, stops: () => stopCount };
}
test('Zapret discovers local strategies, excludes service/utility scripts and fingerprints every native component', (t) => {
  const f = fixture(t), info = inspectFolder(f.folder);
  assert.deepEqual(info.batches, ['general (ALT2).bat', 'general.bat']);
  const files = fingerprint(f.folder);
  assert.match(files['bin/winws.exe'], /^[a-f0-9]{64}$/); assert.ok(files['service.bat']);
  assert.throws(() => inspectFolder('../relative'), /папка/);
});
test('Zapret accepts the actual referenced bin engine without assuming the winws name', async (t) => {
  for (const engine of ['winwx.exe', 'Capri-Renamed-Engine.EXE']) {
    const f = fixture(t, engine);
    assert.equal(inspectFolder(f.folder).batches.length, 2);
    await f.manager.start(); await f.manager.select('general.bat');
    assert.ok(f.calls.at(-1).files['bin/' + engine]);
    assert.equal(f.manager.state().phase, 'running'); await f.manager.close();
    fs.unlinkSync(path.join(f.folder, 'bin', engine));
    assert.throws(() => inspectFolder(f.folder), /движком/);
  }
});
test('first click prompts folder without executing a default strategy; explicit start persists only a successful choice', async (t) => {
  const f = fixture(t);
  await f.manager.start(); assert.equal(f.calls[0], 'picker'); assert.equal(f.launches(), 0);
  assert.equal(f.manager.state().lastBat, '');
  await f.manager.select('general (ALT2).bat');
  assert.equal(f.manager.state().phase, 'running'); assert.equal(f.manager.state().lastBat, 'general (ALT2).bat');
  assert.equal(JSON.parse(fs.readFileSync(f.file)).lastBat, 'general (ALT2).bat');
  await f.manager.stop(); assert.equal(f.stops(), 1); assert.equal(f.manager.state().phase, 'stopped');
  await Promise.all([f.manager.start(), f.manager.start(), f.manager.start()]); assert.equal(f.launches(), 2);
  assert.equal(f.calls.at(-1).batch, 'general (ALT2).bat');
  await f.manager.close(); assert.equal(f.stops(), 2);
});
test('failed elevation preserves last successful strategy; path traversal and arbitrary commands are rejected', async (t) => {
  const f = fixture(t); await f.manager.start(); await f.manager.select('general.bat'); await f.manager.stop(); f.fail();
  await assert.rejects(f.manager.select('general (ALT2).bat'), /UAC/);
  assert.equal(f.manager.state().lastBat, 'general.bat'); assert.equal(f.manager.state().phase, 'error');
  await assert.rejects(f.manager.select('../general.bat'), /стратегия/);
  await assert.rejects(f.manager.select('general.bat & calc.exe'), /стратегия/);
  assert.equal(f.launches(), 2);
});
test('moved or missing folder reopens picker, cancel does not launch a stale path', async (t) => {
  const f = fixture(t); await f.manager.start(); await f.manager.select('general.bat'); await f.manager.stop();
  fs.renameSync(f.folder, f.folder + '-moved');
  await f.manager.start(); assert.equal(f.calls.filter((v) => v === 'picker').length, 2); assert.equal(f.launches(), 1);
});
test('quick Zapret actions contain no renderer-provided paths and maintain stopped/running/busy states', () => {
  const calls = [], actions = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const input = { pet: {}, music: {}, zapret: { supported: true, phase: 'stopped', lastBat: 'general.bat', batches: ['general.bat', 'general (ALT2).bat'] } };
  const flat = (list) => list.flatMap((v) => [v, ...flat(v.submenu || [])]);
  const items = flat(quickTemplate(input, actions));
  items.find((v) => v.id === 'quick-zapret-toggle').click(); assert.deepEqual(calls.pop(), ['zapretToggle', false]);
  items.find((v) => v.id === 'quick-zapret-batch:1').click(); assert.deepEqual(calls.pop(), ['zapretSelect', 'general (ALT2).bat']);
  assert.equal(items.find((v) => v.id === 'quick-zapret-batch:0').checked, true);
  const running = flat(quickTemplate({ ...input, zapret: { ...input.zapret, phase: 'running' } }, actions));
  assert.equal(running.find((v) => v.id === 'quick-zapret-toggle').label, 'Остановить Zapret');
  assert.equal(running.find((v) => v.id === 'quick-zapret-folder').enabled, false);
  const busy = flat(quickTemplate({ ...input, busy: { zapret: true } }, actions)); assert.equal(busy.find((v) => v.id === 'quick-zapret-toggle').enabled, false);
});
test('stop during a pending start cancels the operation without saving a failed strategy', async (t) => {
  const f = fixture(t); let resolveStart, rejectStart, stops = 0;
  const manager = createZapret({ app: {}, platform: 'win32', storeFile: path.join(f.dir, 'race.json'), dialog: { async showOpenDialog() { return { filePaths: [f.folder] }; } }, launcher(_app, _spec, exit) {
    return { started: new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; }), async stop() { stops++; rejectStart(new Error('fixture cancelled')); exit(''); } };
  } });
  await manager.start();
  const starting = manager.start('general.bat');
  assert.equal(manager.state().phase, 'starting'); await manager.stop(); await starting;
  assert.equal(manager.state().phase, 'stopped'); assert.equal(manager.state().lastBat, ''); assert.ok(stops >= 1);
  await manager.close();
});
test('close while the native directory picker is pending prevents any later launch', async (t) => {
  const f = fixture(t); let answer, launches = 0;
  const manager = createZapret({ app: {}, platform: 'win32', storeFile: path.join(f.dir, 'picker-race.json'), dialog: { showOpenDialog() { return new Promise((resolve) => { answer = resolve; }); } }, launcher() { launches++; throw new Error('must never launch'); } });
  const pending = manager.start(); await manager.close(); answer({ filePaths: [f.folder] }); await pending;
  assert.equal(launches, 0); assert.equal(manager.state().phase, 'stopped');
});
