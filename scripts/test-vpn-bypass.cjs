'use strict';
// Real core routing proof using only owned loopback origins/proxies. No TUN or real subscription.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
require('./loopback-vpn-fixture.cjs');
const { VpnManager, freePort } = require('../src/main/vpn/manager');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-bypass-test-'));
  const cipher = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  const manager = new VpnManager({ app: { isPackaged: false, getPath: () => root }, cipher });
  const direct = http.createServer((_req, res) => res.end('DIRECT_ORIGIN'));
  let proxied = 0;
  const upstream = http.createServer((_req, res) => { proxied++; res.end('PROXY_ORIGIN'); });
  upstream.on('connect', (_req, socket) => {
    proxied++; socket.on('error', () => {});
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\nPROXY_ORIGIN'));
  });
  await new Promise((r) => direct.listen(0, '127.0.0.1', r)); await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  try {
    await manager.importConfig('Routing proof', JSON.stringify({ proxies: [{ name: 'Upstream', type: 'http', server: '127.0.0.1', port: upstream.address().port }], hosts: { 'allowed.test': '127.0.0.1', 'sub.allowed.test': '127.0.0.1', 'music.yandex.ru':'127.0.0.1', 'api.music.yandex.net':'127.0.0.1', 's77.storage.yandex.net':'127.0.0.1', 'storage.mds.yandex.net':'127.0.0.1', 'edge.strm.yandex.net':'127.0.0.1' }, 'proxy-groups': [{ name: 'CAPRI', type: 'select', proxies: ['Upstream'] }], rules: ['MATCH,CAPRI'] }));
    await manager.updateSettings({ mode: 'global', proxyPort: await freePort(), bypassSites: ['https://allowed.test/page'] });
    await manager.start(); await manager.selectProxy('GLOBAL', 'Upstream');
    const request = (host) => new Promise((resolve, reject) => {
      const destination = host + ':' + direct.address().port;
      const req = http.get({ hostname: '127.0.0.1', port: manager.store.data.settings.proxyPort, path: 'http://' + destination + '/test', headers: { Host: destination, Connection: 'close' }, timeout: 5000 }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Routing proof timeout')));
    });
    assert.equal((await request('allowed.test')).body, 'DIRECT_ORIGIN');
    assert.equal((await request('sub.allowed.test')).body, 'DIRECT_ORIGIN');
    assert.equal((await request('other.test')).body, 'PROXY_ORIGIN');
    assert.equal((await request('evilallowed.test')).body, 'PROXY_ORIGIN');
    assert.equal(proxied, 2, 'only non-exempt requests must reach the selected GLOBAL proxy');
    await manager.updateSettings({ bypassSites: ['allowed.test', 'https://music.yandex.ru/home'] });
    for (const host of ['music.yandex.ru','api.music.yandex.net','s77.storage.yandex.net','storage.mds.yandex.net','edge.strm.yandex.net']) assert.equal((await request(host)).body, 'DIRECT_ORIGIN', host + ' must bypass the VPN with the music page');
    for (const host of ['mail.yandex.net','evilmusic.yandex.net','api.music.yandex.net.evil.test']) assert.equal((await request(host)).body, 'PROXY_ORIGIN', 'unrelated/lookalike host must stay proxied');
    await manager.updateSettings({ mode: 'rule', rules: ['MATCH,REJECT'] });
    assert.equal((await request('allowed.test')).body, 'DIRECT_ORIGIN');
    assert.notEqual((await request('other.test')).status, 200);
    await manager.updateSettings({ mode: 'global', bypassSites: [] });
    assert.equal((await request('allowed.test')).body, 'PROXY_ORIGIN', 'removing exceptions must restore global routing');
    assert.equal((await request('s77.storage.yandex.net')).body, 'PROXY_ORIGIN', 'removing music bypass must also remove its CDN exceptions');
    console.log('REAL BYPASS PASS: listed domain/subdomain DIRECT, other and lookalike hosts through GLOBAL, rule-mode precedence, and removal verified with actual HTTP traffic. Music API/storage/CDN bypass and unrelated/lookalike isolation also verified. No TUN or remote traffic.');
  } finally {
    await manager.close(); await new Promise((r) => direct.close(r)); await new Promise((r) => upstream.close(r)); assert.ok(root.startsWith(path.join(os.tmpdir(), 'capri-bypass-test-'))); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
