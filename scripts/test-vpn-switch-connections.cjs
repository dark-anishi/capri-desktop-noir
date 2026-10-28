'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), net = require('node:net');
require('./loopback-vpn-fixture.cjs');
const { VpnManager, freePort } = require('../src/main/vpn/manager');

test('selecting another location closes existing tunnels and reconnects through the new proxy without restarting the core', { timeout: 20000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-switch-core-')), servers = [], sockets = new Set();
  const cipher = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
  const manager = new VpnManager({ app: { isPackaged: false, getPath: () => temp }, cipher });
  try {
    for (const name of ['Location A', 'Location B']) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' }); res.write(name + '\n');
        const timer = setInterval(() => res.write(name + '\n'), 100);
        res.on('close', () => clearInterval(timer));
      });
      server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
      server.on('connect', (_req, socket, head) => {
        const upstream = net.connect(server.address().port, '127.0.0.1', () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          socket.pipe(upstream); upstream.pipe(socket);
        });
        sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
        socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
    }
    await manager.importConfig('Switch fixture', JSON.stringify({ proxies: servers.map((server, i) => ({ name: ['Location A', 'Location B'][i], type: 'http', server: '127.0.0.1', port: server.address().port })), 'proxy-groups': [{ name: 'CAPRI', type: 'select', proxies: ['Location A', 'Location B'] }], rules: ['MATCH,CAPRI'] }));
    await manager.updateSettings({ proxyPort: await freePort() }); await manager.start();
    const core = manager.child;
    async function stream(expected) {
      return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: manager.store.data.settings.proxyPort, method: 'CONNECT', path: '198.51.100.1:80', timeout: 4000 });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Fixture tunnel timeout')));
        req.on('connect', (res, socket) => {
          if (res.statusCode !== 200) { socket.destroy(); return reject(new Error('Fixture CONNECT failed')); }
          let text = '';
          socket.on('error', () => {});
          const ended = new Promise(done => socket.once('close', done));
          const timer = setTimeout(() => { socket.destroy(); reject(new Error('Fixture tunnel produced no data')); }, 4000);
          socket.on('data', data => { text += data; if (text.includes(expected)) { clearTimeout(timer); resolve({ socket, ended }); } });
          socket.write('GET /stream HTTP/1.1\r\nHost: 198.51.100.1\r\n\r\n');
        }); req.end();
      });
    }
    const old = await stream('Location A');
    await manager.selectProxy('CAPRI', 'Location B');
    let timeout;
    try { await Promise.race([old.ended, new Promise((_, reject) => timeout = setTimeout(() => reject(new Error('Old location tunnel remained open after selection')), 2000))]); }
    finally { clearTimeout(timeout); }
    const next = await stream('Location B'); next.socket.destroy();
    assert.equal(manager.child, core); assert.equal(manager.phase, 'connected');
    assert.equal(manager.store.data.selections[manager.store.data.activeId].CAPRI, 'Location B');
    console.log('REAL SWITCH PASS: old streaming tunnel closed automatically; new stream uses Location B; same owned core, no TUN/service/live network changes.');
  } finally {
    await manager.close(); for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-switch-core-'))); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
