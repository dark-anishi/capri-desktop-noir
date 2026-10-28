'use strict';
// Real Windows Mihomo + owned sidecar smoke. No elevation, TUN or remote VPN account.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
require('./loopback-vpn-fixture.cjs');
const { VpnManager, freePort } = require('../src/main/vpn/manager');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-core-'));
  const cipher = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  const manager = new VpnManager({ app: { isPackaged: false, getPath: () => temp }, cipher });
  const origin = http.createServer((_req, res) => res.end('capri-real-proxy-ok'));
  const occupied = http.createServer((_req, res) => res.end('other-app-untouched'));
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  try {
    await manager.importConfig('Local core smoke', 'proxies:\n  - name: Fixture\n    type: socks5\n    server: 127.0.0.1\n    port: 9\nproxy-groups:\n  - name: CAPRI\n    type: select\n    proxies: [DIRECT, Fixture]\nrules: ["MATCH,CAPRI"]');
    const requestedPort = occupied.address().port; await manager.updateSettings({ proxyPort: requestedPort });
    const firstStart = manager.start(), duplicateStart = manager.start(); assert.equal(firstStart, duplicateStart, 'repeated Connect must share one start operation');
    await firstStart; assert.equal(manager.phase, 'connected');
    const port = manager.store.data.settings.proxyPort;
    assert.notEqual(port, requestedPort, 'busy proxy port must be replaced automatically');
    assert.equal(manager.state().proxyAddress, '127.0.0.1:' + port);
    const persisted = JSON.parse(cipher.decryptString(fs.readFileSync(manager.store.file)));
    assert.equal(persisted.settings.proxyPort, port, 'selected proxy port must survive app restart');
    const otherAppBody = await new Promise((resolve, reject) => { http.get({ hostname: '127.0.0.1', port: requestedPort, agent: false }, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve(body)); }).on('error', reject); });
    assert.equal(otherAppBody, 'other-app-untouched', 'conflicting application must remain untouched');
    await manager.selectProxy('CAPRI', 'DIRECT');
    const body = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: `http://127.0.0.1:${origin.address().port}/test`, headers: { Host: `127.0.0.1:${origin.address().port}`, Connection: 'close' }, timeout: 6000 }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => res.statusCode === 200 ? resolve(text) : reject(new Error('Real proxy HTTP ' + res.statusCode))); });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Proxy request timeout')));
    });
    assert.equal(body, 'capri-real-proxy-ok');
    await manager.poll(); assert.ok(manager.traffic.downloadTotal > 0, 'traffic counters must come from real forwarded bytes');
    const config = await manager.api('GET', '/configs'); assert.equal(config.tun.enable, false);
    assert.ok(manager.proxies.some((proxy) => proxy.name === 'CAPRI'));
    const publicState = JSON.stringify(manager.state()); assert.ok(!publicState.includes(manager.secret)); assert.ok(!publicState.includes('127.0.0.1:' + manager.endpoint.split(':')[1]));
    await manager.selectProxy('CAPRI', 'Fixture');
    const crashed = manager.child; crashed.kill();
    const recoveryDeadline = Date.now() + 12000;
    while (Date.now() < recoveryDeadline && (manager.child === crashed || manager.phase !== 'connected')) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(manager.phase, 'connected'); assert.notEqual(manager.child, crashed, 'owned core should reconnect after a real sidecar crash');
    assert.equal(manager.state().proxies.find((p) => p.name === 'CAPRI').now, 'Fixture', 'latest selected location must be restored before connected is reported');
    const old = manager.child; await manager.stop(); assert.equal(manager.phase, 'disconnected'); assert.ok(old.exitCode !== null || old.killed);
    assert.equal(await freePort(port), port, 'proxy port must be released');
    await manager.start(); assert.equal(manager.state().proxies.find((p) => p.name === 'CAPRI').now, 'Fixture'); assert.equal(manager.store.data.settings.proxyPort, port, 'available saved port should remain stable'); await manager.stop();
    await manager.close();
    const fresh = new VpnManager({ app: { isPackaged: false, getPath: () => temp }, cipher });
    try {
      await fresh.start();
      assert.equal(fresh.state().proxies.find((p) => p.name === 'CAPRI').now, 'Fixture', 'a fresh manager must load and restore the last location from disk');
    } finally { await fresh.close(); }
    console.log('REAL CORE PASS: verified Mihomo 1.19.33 resolves a real port conflict without touching the other listener, persists its new port, starts, authenticates, switches proxy, forwards actual local HTTP traffic, stops, restarts and restores the last server after both a core crash and a fresh manager loading persisted data. TUN was NOT enabled.');
  } finally { await manager.close(); await new Promise((resolve) => origin.close(resolve)); await new Promise((resolve) => occupied.close(resolve)); assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-core-'))); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
