'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { VpnManager, freePort } = require('../src/main/vpn/manager');
const { VpnStore } = require('../src/main/vpn/store');
const { parseProfile } = require('../src/main/vpn/config');

test('a lost service start reply still cleans up the Capri-owned core before retrying', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-vpn-startup-'));
  const cipher = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };
  const store = new VpnStore(root, cipher);
  store.add('Fixture', parseProfile('proxies: [{name: Fixture, type: socks5, server: 127.0.0.1, port: 9}]').config);
  store.commit({ ...store.data, settings: { ...store.data.settings, proxyPort: await freePort(), tun: { ...store.data.settings.tun, enable: true } } });
  let running = false, starts = 0, readiness = 'ready'; const actions = [];
  const helper = { async run(_args, request) {
    actions.push(request.action);
    if (request.action === 'start') { running = true; if (++starts === 1) throw new Error('Fixture reply lost after start'); return { ok: true, running: readiness !== 'not-ready', ...(readiness === 'legacy' ? {} : { ready: readiness === 'ready' }) }; }
    if (request.action === 'stop') { running = false; return { ok: true }; }
    if (request.action === 'api') return { data: { proxies: {} } };
    throw new Error('Unexpected fixture request');
  } };
  const manager = new VpnManager({ app: { getPath: () => root }, store, helper, binaries: { installedHelper: path.join(root, 'absent') } });
  try {
    await assert.rejects(manager.start(), /reply lost/);
    assert.equal(running, false, 'failed start must stop the core it may have started');
    assert.deepEqual(actions, ['start', 'stop']);
    assert.equal(manager.phase, 'error');
    await manager.start(); assert.equal(manager.phase, 'connected'); assert.equal(running, true);
    await manager.stop(); assert.equal(running, false);
    readiness = 'legacy'; await manager.start();
    assert.equal(manager.phase, 'connected', 'old services remain usable while explicitly requesting an upgrade');
    assert.ok(manager.logs.some(entry => /Обнови службу/.test(entry.message)));
    await manager.stop();
    readiness = 'not-ready'; await assert.rejects(manager.start(), /готовность/);
    assert.equal(manager.phase, 'error'); assert.equal(running, false, 'unready start must not report connected or leave its core');
  } finally { await manager.close(); assert.ok(root.startsWith(path.join(os.tmpdir(), 'capri-vpn-startup-'))); fs.rmSync(root, { recursive: true, force: true }); }
});
