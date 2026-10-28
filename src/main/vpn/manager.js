'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { VpnStore } = require('./store');
const { paths, verify } = require('./paths');
const { parseProfile, runtime, tunSettings, dnsSettings, bypassSites } = require('./config');
const { downloadSubscription } = require('./subscription');
const { createWindowsHelper } = require('../windows-helper');
const { controlService } = require('./service-control');

function freePort(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (cause) => { const error = new Error(port ? `Порт ${port} недоступен.` : 'Не удалось выделить свободный локальный порт.'); error.code = cause.code; reject(error); });
    server.listen(port, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); });
  });
}
function apiRequest(endpoint, secret, method, target, body) {
  return new Promise((resolve, reject) => {
    if (!/^127\.0\.0\.1:\d+$/.test(endpoint)) return reject(new Error('Недопустимый адрес API.'));
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request('http://' + endpoint + target, { method, headers: { Authorization: 'Bearer ' + secret, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }, timeout: 8000 }, (res) => {
      const chunks = []; let length = 0;
      res.on('data', (chunk) => { length += chunk.length; if (length > 8 * 1024 * 1024) req.destroy(new Error('Ответ ядра слишком большой.')); else chunks.push(chunk); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('API Mihomo: HTTP ' + res.statusCode));
        const text = Buffer.concat(chunks).toString('utf8'); try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('Некорректный ответ ядра.')); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Ядро не отвечает.')));
    req.on('error', () => reject(new Error('Нет связи с ядром Mihomo.')));
    req.end(payload);
  });
}
class VpnManager {
  constructor({ app, cipher, onState = () => {}, subscription = downloadSubscription, store, helper, binaries, request = apiRequest }) {
    this.app = app; this.binaries = binaries || paths(app); this.helper = helper || createWindowsHelper(app);
    this.store = store || new VpnStore(path.join(app.getPath('userData'), 'vpn'), cipher);
    this.subscription = subscription; this.request = request; this.onState = onState;
    this.phase = 'disconnected'; this.logs = []; this.error = ''; this.child = null; this.endpoint = null; this.secret = null;
    this.queue = Promise.resolve(); this.wanted = false; this.closed = false; this.generation = 0; this.retry = null; this.retries = 0; this.polling = false;
    this.service = { installed: fs.existsSync(this.binaries.installedHelper), running: false };
    this.traffic = { down: 0, up: 0, downloadTotal: 0, uploadTotal: 0 }; this.previousTraffic = null; this.proxies = [];
    this.directory = path.join(this.store.root, 'runtime'); fs.mkdirSync(this.directory, { recursive: true });
    for (const name of ['candidate.json', 'runtime.json']) try { fs.unlinkSync(path.join(this.directory, name)); } catch { }
    this.timer = setInterval(() => this.poll(), 1000); this.timer.unref();
  }
  log(message, level = 'info') {
    // Never record raw profiles, URLs, API responses, core stdout or authentication material.
    this.logs.push({ at: Date.now(), level, message: String(message).replace(/https?:\/\/\S+/gi, '[ссылка скрыта]').replace(/(?:password|secret|token|uuid|private-key)\s*[:=]\s*\S+/gi, '[секрет скрыт]').slice(0, 300) });
    if (this.logs.length > 100) this.logs.shift();
  }
  state() {
    return { phase: this.phase, error: this.error, version: '1.19.33', profiles: this.store.publicProfiles(), activeId: this.store.data.activeId, favorites: [...(this.store.data.favorites?.[this.store.data.activeId] || [])], settings: structuredClone(this.store.data.settings), service: { ...this.service }, traffic: { ...this.traffic }, proxies: structuredClone(this.proxies), logs: this.logs.slice(), proxyAddress: this.phase === 'connected' ? '127.0.0.1:' + this.store.data.settings.proxyPort : null };
  }
  emit() { if (!this.closed) this.onState(this.state()); }
  serialize(fn) { const operation = this.queue.then(fn); this.queue = operation.catch(() => {}); return operation; }
  async validate(config) {
    const manifest = JSON.parse(fs.readFileSync(this.binaries.manifest, 'utf8')); verify(this.binaries.core, manifest.coreSha256);
    const file = path.join(this.directory, 'candidate.json'); fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    try {
      await new Promise((resolve, reject) => execFile(this.binaries.core, ['-t', '-d', this.directory, '-f', file], { windowsHide: true, timeout: 25000, maxBuffer: 2 * 1024 * 1024 }, (err) => err ? reject(new Error('Mihomo отклонил профиль. Предыдущая конфигурация сохранена.')) : resolve()));
    } finally { try { fs.unlinkSync(file); } catch { } }
  }
  async importConfig(name, text, url) {
    return this.serialize(async () => {
      const parsed = parseProfile(text);
      const endpoint = '127.0.0.1:' + await freePort();
      const settings = structuredClone(this.store.data.settings); settings.tun.enable = false;
      await this.validate(runtime(parsed.config, settings, endpoint, crypto.randomBytes(32).toString('hex')));
      this.store.add(name, parsed.config, url); this.log('Профиль импортирован и проверен ядром.');
      if (parsed.ignoredFields.length) this.log('Системные поля подписки не применены: локальные DNS/TUN/API остаются под управлением Capri.');
      this.emit(); return this.state();
    });
  }
  async importSubscription(name, url) { const text = await this.subscription(url); return this.importConfig(name, text, url); }
  async updateSubscription(id) {
    return this.serialize(async () => {
      const profile = this.store.profile(id); if (!profile.url) throw new Error('У локального профиля нет подписки.');
      const parsed = parseProfile(await this.subscription(profile.url));
      const settings = structuredClone(this.store.data.settings); settings.tun.enable = false;
      await this.validate(runtime(parsed.config, settings, '127.0.0.1:' + await freePort(), crypto.randomBytes(32).toString('hex')));
      const previous = structuredClone(this.store.data);
      this.store.commit({ ...previous, profiles: previous.profiles.map((p) => p.id === id ? { ...p, previousConfig: p.config, config: parsed.config, updatedAt: Date.now() } : p) });
      try { if (this.wanted && id === previous.activeId) await this.restartInternal(); }
      catch (err) { this.store.commit(previous); if (this.wanted) await this.restartInternal().catch(() => {}); throw err; }
      this.log('Подписка обновлена; сохранена предыдущая версия.'); this.emit(); return this.state();
    });
  }
  selectProfile(id) {
    return this.serialize(async () => {
      this.store.profile(id); const previous = structuredClone(this.store.data);
      this.store.commit({ ...previous, activeId: id });
      try { if (this.wanted) await this.restartInternal(); }
      catch (err) { this.store.commit(previous); if (this.wanted) await this.restartInternal().catch(() => {}); throw err; }
      this.emit(); return this.state();
    });
  }
  rollbackProfile(id) {
    return this.serialize(async () => {
      const profile = this.store.profile(id); if (!profile.previousConfig) throw new Error('Предыдущей версии профиля нет.');
      const previous = structuredClone(this.store.data);
      this.store.commit({ ...previous, profiles: previous.profiles.map((p) => p.id === id ? { ...p, config: p.previousConfig, previousConfig: p.config } : p) });
      try { if (this.wanted && id === previous.activeId) await this.restartInternal(); }
      catch (err) { this.store.commit(previous); if (this.wanted) await this.restartInternal().catch(() => {}); throw err; }
      this.log('Профиль восстановлен из предыдущей версии.'); this.emit(); return this.state();
    });
  }
  removeProfile(id) {
    return this.serialize(async () => {
      this.store.profile(id);
      if (this.wanted && id === this.store.data.activeId) throw new Error('Сначала отключи активный профиль.');
      const profiles = this.store.data.profiles.filter((p) => p.id !== id);
      this.store.commit({ ...this.store.data, profiles, activeId: this.store.data.activeId === id ? profiles[0]?.id || null : this.store.data.activeId });
      this.emit(); return this.state();
    });
  }
  updateSettings(patch) {
    return this.serialize(async () => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Некорректные настройки VPN.');
      for (const key of Object.keys(patch)) if (!['tun', 'dns', 'mode', 'ipv6', 'proxyPort', 'rules', 'bypassSites'].includes(key)) throw new Error('Неизвестная настройка VPN.');
      const previous = structuredClone(this.store.data);
      const settings = { ...previous.settings, ...patch, tun: patch.tun ? tunSettings(patch.tun) : previous.settings.tun, dns: patch.dns ? dnsSettings(patch.dns) : previous.settings.dns };
      if (Object.hasOwn(patch, 'bypassSites')) settings.bypassSites = bypassSites(patch.bypassSites);
      if (!['rule', 'global', 'direct'].includes(settings.mode) || typeof settings.ipv6 !== 'boolean' || !Number.isInteger(settings.proxyPort) || settings.proxyPort < 1024 || settings.proxyPort > 65535) throw new Error('Неверный режим, IPv6 или порт.');
      if (settings.rules !== undefined && settings.rules !== null && (!Array.isArray(settings.rules) || settings.rules.length > 100000 || settings.rules.some((rule) => typeof rule !== 'string' || rule.length > 4096))) throw new Error('Некорректные правила маршрутизации.');
      if (previous.activeId) {
        const checkSettings = structuredClone(settings); checkSettings.tun.enable = false;
        await this.validate(runtime(this.store.profile().config, checkSettings, '127.0.0.1:' + await freePort(), crypto.randomBytes(32).toString('hex')));
      }
      this.store.commit({ ...previous, settings });
      try { if (this.wanted) await this.restartInternal(); }
      catch (err) { this.store.commit(previous); if (this.wanted) await this.restartInternal().catch(() => {}); throw err; }
      this.log('Локальные настройки VPN обновлены.'); this.emit(); return this.state();
    });
  }
  start() {
    if (this.starting) return this.starting;
    this.wanted = true;
    this.starting = this.serialize(() => this.startInternal()).finally(() => { this.starting = null; });
    return this.starting;
  }
  async startInternal() {
    if (this.phase === 'connected') return this.state();
    if (!this.wanted || this.closed) return this.state();
    this.phase = 'connecting'; this.error = ''; this.emit();
    try {
      const profile = this.store.profile(); const settings = structuredClone(this.store.data.settings);
      try { await freePort(settings.proxyPort); }
      catch (err) {
        if (!['EADDRINUSE', 'EACCES'].includes(err.code)) throw err;
        const previousPort = settings.proxyPort;
        settings.proxyPort = await freePort();
        this.store.commit({ ...this.store.data, settings });
        this.log(`Порт ${previousPort} недоступен. Выбран свободный порт ${settings.proxyPort}.`, 'warning');
        this.emit();
      }
      const endpoint = '127.0.0.1:' + await freePort(); const secret = crypto.randomBytes(32).toString('hex');
      const config = runtime(profile.config, settings, endpoint, secret);
      if (settings.tun.enable) {
        // A timed-out pipe reply does not mean the service failed to start its
        // core. Retain ownership before sending so the catch path can stop it.
        this.endpoint = null; this.secret = null; this.usingService = true;
        const reply = await this.helper.run(['--client'], { action: 'start', config }, 50000);
        if (reply.running !== true || reply.ready === false) throw new Error('Служба не подтвердила готовность ядра VPN.');
        if (reply.ready !== true) this.log('Обнови службу Capri VPN: установленный компонент ещё не проверяет готовность сетевых портов.', 'warning');
        this.service = { installed: true, running: true };
      } else {
        await this.validate(config);
        const manifest = JSON.parse(fs.readFileSync(this.binaries.manifest, 'utf8')); verify(this.binaries.helper, manifest.helperSha256);
        const file = path.join(this.directory, 'runtime.json'); fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
        const generation = ++this.generation;
        this.endpoint = endpoint; this.secret = secret; this.usingService = false;
        this.child = spawn(this.binaries.helper, ['--sidecar', this.binaries.core, this.directory, file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        let networkReady = false, startupOutput = '';
        this.child.stdout.on('data', chunk => {
          if (startupOutput.length > 4096) return;
          startupOutput += chunk.toString('utf8');
          for (const line of startupOutput.split(/\r?\n/)) {
            try { const reply = JSON.parse(line); if (reply.ok === true && reply.ready === true) networkReady = true; } catch { }
          }
        });
        this.child.stdin.on('error', () => {});
        this.child.on('error', () => { if (generation === this.generation && this.wanted) this.scheduleReconnect(); });
        this.child.on('exit', () => { if (generation === this.generation && this.wanted) this.scheduleReconnect(); });
        for (let attempt = 0; attempt < 120; attempt++) {
          if (!this.wanted) throw new Error('Подключение отменено.');
          if (this.child.exitCode !== null) throw new Error('Ядро остановилось при запуске.');
          try { const version = await this.api('GET', '/version'); if (!String(version.version).includes('1.19.33')) throw new Error('Версия ядра не совпадает.'); if (!networkReady) throw new Error('Ядро ещё не подтвердило готовность локальных портов прокси и DNS.'); break; }
          catch (err) { if (attempt === 119) throw err; await new Promise((r) => setTimeout(r, 100)); }
        }
      }
      if (!this.wanted) { await this.stopInternal(); return this.state(); }
      await this.refreshProxies();
      for (const [group, selected] of Object.entries(this.store.data.selections[this.store.data.activeId] || {})) {
        if (this.proxies.some((p) => p.name === group && p.type === 'Selector' && p.all?.includes(selected))) await this.api('PUT', '/proxies/' + encodeURIComponent(group), { name: selected });
      }
      await this.refreshProxies();
      this.phase = 'connected'; this.retries = 0; this.previousTraffic = null;
      this.log(settings.tun.enable ? 'Mihomo запущен через службу; TUN запрошен.' : 'Локальный прокси Mihomo запущен.');
      this.emit(); return this.state();
    } catch (err) {
      try { await this.stopInternal(); } catch (cleanup) { this.log(cleanup.message, 'error'); }
      this.phase = 'error'; this.error = err.message; this.log(err.message, 'error'); this.emit(); throw err;
    }
  }
  api(method, target, body) {
    if (this.usingService) return this.helper.run(['--client'], { action: 'api', method, target, ...(body === undefined ? {} : { body }) }, 15000).then((reply) => reply.data);
    if (!this.endpoint || !this.secret) return Promise.reject(new Error('Ядро не подключено.'));
    return this.request(this.endpoint, this.secret, method, target, body);
  }
  async refreshProxies() {
    const data = await this.api('GET', '/proxies');
    this.proxies = Object.entries(data.proxies || {}).slice(0, 10000).map(([name, p]) => ({ name, type: String(p.type || ''), now: typeof p.now === 'string' ? p.now : null, all: Array.isArray(p.all) ? p.all.filter((x) => typeof x === 'string') : null, delay: p.history?.at(-1)?.delay ?? null, alive: p.alive !== false }));
  }
  selectProxy(group, name) {
    return this.serialize(async () => {
      await this.refreshProxies();
      const selector = this.proxies.find((p) => p.name === group && p.type === 'Selector' && p.all?.includes(name));
      if (!selector) throw new Error('Сервер не принадлежит выбираемой группе.');
      const changed = selector.now !== name;
      if (changed) await this.api('PUT', '/proxies/' + encodeURIComponent(group), { name });
      const selections = structuredClone(this.store.data.selections || {}); selections[this.store.data.activeId] ||= {}; selections[this.store.data.activeId][group] = name;
      this.store.commit({ ...this.store.data, selections });
      if (changed) {
        try {
          // Changing a selector affects new dials only. Existing TCP/UDP tunnels
          // must reconnect, otherwise browsers keep the previous exit location.
          await this.api('DELETE', '/connections');
        } catch (err) {
          if (!this.wanted || this.closed) throw err;
          // Older installed Capri services do not allow this bounded API action.
          // Their existing stop/start protocol applies the saved location too.
          this.log('Переподключаю ядро, чтобы применить локацию к открытым соединениям.', 'warning');
          await this.restartInternal();
        }
      }
      await this.refreshProxies(); this.emit(); return this.state();
    });
  }
  async delay(name) {
    if (!this.proxies.some((p) => p.name === name)) throw new Error('Неизвестный сервер.');
    const reply = await this.api('GET', '/proxies/' + encodeURIComponent(name) + '/delay?timeout=5000&url=' + encodeURIComponent('https://www.gstatic.com/generate_204'));
    const proxy = this.proxies.find((p) => p.name === name); if (proxy) proxy.delay = Number(reply.delay) || null;
    this.emit(); return { delay: Number(reply.delay) || null };
  }
  setFavorite(name, favorite) {
    return this.serialize(async () => {
      const profile = this.store.profile();
      if (typeof name !== 'string' || !name || name.length > 200 || /[\u0000-\u001f]/.test(name) || typeof favorite !== 'boolean') throw new Error('Некорректная избранная локация.');
      const known = profile.config.proxies?.some((p) => p.name === name) || this.proxies.some((p) => p.name === name && !p.all && !['Direct', 'Reject', 'Pass', 'Compatible', 'RejectDrop', 'PassRule'].includes(p.type));
      if (favorite && !known) throw new Error('Локация не найдена в активном профиле.');
      const favorites = structuredClone(this.store.data.favorites || {});
      const names = new Set(favorites[profile.id] || []);
      if (favorite) names.add(name); else names.delete(name);
      if (names.size > 5000) throw new Error('Слишком много избранных локаций.');
      favorites[profile.id] = [...names];
      this.store.commit({ ...this.store.data, favorites }); this.emit(); return this.state();
    });
  }
  stop() { this.wanted = false; clearTimeout(this.retry); this.retry = null; return this.serialize(async () => {
    try { await this.stopInternal(); }
    catch (err) { this.phase = 'error'; this.error = err.message; this.log(err.message, 'error'); this.emit(); throw err; }
    this.phase = 'disconnected'; this.error = ''; this.log('VPN отключён; принадлежащие Capri процессы остановлены.'); this.emit(); return this.state();
  }); }
  async stopInternal() {
    ++this.generation;
    if (this.usingService) {
      try { await this.helper.run(['--client'], { action: 'stop' }, 15000); }
      catch {
        try { await this.api('PATCH', '/configs', { tun: { enable: false } }); }
        catch { throw new Error('Не удалось подтвердить отключение TUN. Останови службу через диагностику. Без heartbeat защитный таймер службы остановит ядро через 30 секунд.'); }
      }
    }
    if (this.child) {
      const child = this.child; this.child = null;
      child.stdin.end();
      await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); const timeout = setTimeout(() => { child.kill(); resolve(); }, 4000); child.once('exit', () => { clearTimeout(timeout); resolve(); }); });
    }
    this.endpoint = null; this.secret = null; this.usingService = false; this.proxies = []; this.previousTraffic = null;
    this.traffic.down = this.traffic.up = 0;
    for (const name of ['runtime.json', 'candidate.json']) try { fs.unlinkSync(path.join(this.directory, name)); } catch { }
  }
  restartInternal() { return this.stopInternal().then(() => { this.phase = 'disconnected'; return this.startInternal(); }); }
  restart() { this.wanted = true; return this.serialize(() => this.restartInternal()); }
  scheduleReconnect() {
    if (!this.wanted || this.closed || this.retry) return;
    this.phase = 'reconnecting'; this.log('Связь с ядром потеряна. Планирую восстановление.', 'warning'); this.emit();
    this.retry = setTimeout(() => { this.retry = null; if (this.wanted) this.serialize(() => this.restartInternal()).catch(() => this.scheduleReconnect()); }, Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5)));
    this.retry.unref();
  }
  async poll() {
    if (this.polling || this.closed || !this.wanted || this.phase !== 'connected') return;
    this.polling = true; const generation = this.generation;
    try {
      if (this.usingService && (!this.leaseAt || Date.now() - this.leaseAt > 8000)) {
        const service = await this.helper.run(['--client'], { action: 'status' }, 5000);
        this.leaseAt = Date.now(); this.service.running = true;
        if (!service.running) throw new Error('Служба восстанавливает ядро.');
      }
      const data = await this.api('GET', '/connections'); if (generation !== this.generation) return;
      const now = Date.now(), downloadTotal = Number(data.downloadTotal) || 0, uploadTotal = Number(data.uploadTotal) || 0;
      const last = this.previousTraffic, seconds = last ? Math.max(.001, (now - last.at) / 1000) : 1;
      this.traffic = { downloadTotal, uploadTotal, down: last ? Math.max(0, downloadTotal - last.down) / seconds : 0, up: last ? Math.max(0, uploadTotal - last.up) / seconds : 0 };
      this.previousTraffic = { at: now, down: downloadTotal, up: uploadTotal }; this.emit();
    } catch { if (generation === this.generation && this.wanted) this.scheduleReconnect(); }
    finally { this.polling = false; }
  }
  async serviceControl(operation) {
    if (!['install', 'uninstall', 'start', 'stop'].includes(operation)) throw new Error('Недопустимая операция службы.');
    return this.serialize(async () => {
      if (['stop', 'uninstall'].includes(operation)) {
        this.wanted = false;
        try { await this.stopInternal(); } catch { this.log('Канал службы недоступен; выполняется остановка через Windows SCM.', 'warning'); }
      }
      const manifest = JSON.parse(fs.readFileSync(this.binaries.manifest, 'utf8')); verify(this.binaries.helper, manifest.helperSha256); verify(this.binaries.core, manifest.coreSha256);
      const identity = await this.helper.run(['--identity']);
      try { await controlService(this.binaries, operation, identity.sid); }
      catch (err) { this.error = err.message; this.log(err.message, 'error'); this.emit(); throw err; }
      this.service.installed = operation !== 'uninstall'; this.service.running = !['uninstall', 'stop'].includes(operation);
      this.error = '';
      if (['stop', 'uninstall'].includes(operation)) { this.usingService = false; this.phase = 'disconnected'; this.error = ''; this.proxies = []; }
      this.log('Операция службы завершена: ' + operation); this.emit(); return this.state();
    });
  }
  async close() { this.wanted = false; this.closed = true; clearInterval(this.timer); clearTimeout(this.retry); await this.serialize(() => this.stopInternal()); }
}
module.exports = { VpnManager, apiRequest, freePort };
