'use strict';
// Real Electron IPC + owned Mihomo, local HTTP proxies only. Never uses the
// installed TUN service, changes routes or reads the user's profiles.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const net = require('node:net');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-vpn-traffic-ui-'));
  let app; const servers = [], hits = [], errors = [];
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  try {
    for (const name of ['Location A', 'Location B']) {
      const server = http.createServer((req, res) => {
        if (req.url.includes('/capri-long-lived')) {
          res.writeHead(200, { 'Content-Type': 'text/plain' }); res.write(name + '\n');
          const timer = setInterval(() => res.write(name + '\n'), 100);
          res.on('close', () => clearInterval(timer)); return;
        }
        let bytes = 0; req.on('data', data => bytes += data.length);
        req.on('end', () => { hits.push({ name, bytes }); res.writeHead(200, { 'Connection': 'close', 'Content-Type': 'text/plain' }); res.end(name + '\n' + 'x'.repeat(512 * 1024)); });
      });
      server.on('connect', (_req, socket, head) => {
        const upstream = net.connect(server.address().port, '127.0.0.1', () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          socket.pipe(upstream); upstream.pipe(socket);
        });
        socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
    }
    const profile = path.join(temp, 'profile.yaml');
    fs.writeFileSync(profile, JSON.stringify({ proxies: servers.map((server, i) => ({ name: ['Location A', 'Location B'][i], type: 'http', server: '127.0.0.1', port: server.address().port })), 'proxy-groups': [{ name: 'CAPRI', type: 'select', proxies: ['Location A', 'Location B'] }], rules: ['MATCH,CAPRI'] }));
    app = await _electron.launch({ executablePath: process.env.CAPRI_TEST_APP || require('electron'), args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    const overlay = await app.firstWindow(); overlay.on('pageerror', error => errors.push(error.message));
    const opened = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openMenu()); const menu = await opened;
    menu.on('pageerror', error => errors.push(error.message));
    await menu.locator('[data-tab="vpn"]').click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, profile);
    assert.equal((await menu.evaluate(() => window.launcher.vpn.importFile())).ok, true);
    assert.equal((await menu.evaluate(() => window.launcher.vpn.updateSettings({ mode: 'global' }))).ok, true);
    const started = await menu.evaluate(() => window.launcher.vpn.start());
    assert.equal(started.ok, true, started.error); assert.equal(started.state.settings.tun.enable, false);
    const port = started.state.settings.proxyPort;
    async function request(expected) {
      const marker = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: 'http://198.51.100.1/capri-fixture', headers: { Host: '198.51.100.1', Connection: 'close', 'Content-Length': 256 * 1024 }, timeout: 8000 }, response => {
          const chunks = []; response.on('data', data => chunks.push(data)); response.on('end', () => response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString().split('\n')[0]) : reject(new Error('Fixture HTTP ' + response.statusCode))); response.on('error', reject);
        });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Fixture proxy timeout'))); req.end(Buffer.alloc(256 * 1024, 120));
      }); assert.equal(marker, expected);
    }
    async function stream(expected) {
      return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, method: 'CONNECT', path: '198.51.100.1:80', timeout: 5000 });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Fixture stream timeout')));
        req.on('connect', (response, socket) => {
          if (response.statusCode !== 200) { socket.destroy(); return reject(new Error('Fixture stream CONNECT failed')); }
          socket.on('error', () => {});
          const ended = new Promise(done => socket.once('close', done));
          let text = ''; const timer = setTimeout(() => { socket.destroy(); reject(new Error('Fixture stream produced no data')); }, 5000);
          const data = chunk => { text += chunk; if (text.includes(expected)) { clearTimeout(timer); socket.removeListener('data', data); socket.resume(); resolve({ socket, ended }); } };
          socket.on('data', data); socket.write('GET /capri-long-lived HTTP/1.1\r\nHost: 198.51.100.1\r\n\r\n');
        }); req.end();
      });
    }
    let previous;
    for (const location of ['Location A', 'Location B', 'Location A']) {
      await menu.locator('#vpn-servers select[aria-label="GLOBAL"]').selectOption(location);
      await menu.waitForFunction(() => !document.querySelector('#vpn').hasAttribute('aria-busy'));
      const state = await menu.evaluate(() => window.launcher.vpn.getStatus());
      assert.equal(state.state.proxies.find(proxy => proxy.name === 'GLOBAL').now, location);
      if (previous) {
        let timer; try { await Promise.race([previous.ended, new Promise((_, reject) => timer = setTimeout(() => reject(new Error('Previous location stream was not reconnected by the UI selection')), 3000))]); }
        finally { clearTimeout(timer); }
      }
      await request(location);
      previous = await stream(location);
    }
    await menu.waitForFunction(() => !/^0\s/.test(document.querySelector('#vpn-total-down').textContent) && !/^0\s/.test(document.querySelector('#vpn-total-up').textContent));
    const observed = await menu.waitForFunction(async () => {
      const { state } = await window.launcher.vpn.getStatus();
      return state.traffic.downloadTotal > 0 && state.traffic.uploadTotal > 0 ? { phase: state.phase, traffic: state.traffic } : false;
    });
    const state = await observed.jsonValue();
    console.log('VPN TRAFFIC SNAPSHOT', JSON.stringify(state));
    assert.ok(state.traffic.downloadTotal > 0); assert.ok(state.traffic.uploadTotal > 0);
    assert.deepEqual(hits.map(hit => hit.name), ['Location A', 'Location B', 'Location A']);
    assert.ok(hits.every(hit => hit.bytes === 256 * 1024));
    previous.socket.destroy();
    assert.equal((await menu.evaluate(() => window.launcher.vpn.stop())).ok, true);
    assert.deepEqual(errors, []);
    console.log('VPN LAUNCHER TRAFFIC UI PASS: actual renderer changes GLOBAL A -> B -> A, old long-lived tunnels close automatically, new streams use selected proxy, main and UI upload/download counters grow. Real no-TUN core only; live VPN untouched.');
  } finally {
    if (app) await app.close();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
