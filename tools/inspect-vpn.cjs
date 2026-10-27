'use strict';
// Read-only metadata inspection; never prints credentials, URLs or config contents.
const { app, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const os = require('node:os'), http = require('node:http'), tls = require('node:tls');
const { VpnManager, freePort } = require('../src/main/vpn/manager');
const { VpnStore } = require('../src/main/vpn/store');
app.setPath('userData', path.join(process.env.APPDATA, 'capri-desktop'));
app.whenReady().then(async () => {
  const file = path.join(process.env.APPDATA, 'capri-desktop/vpn/profiles.dat');
  const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  const profile = data.profiles.find((p) => p.id === data.activeId);
  console.log(JSON.stringify({ mode: data.settings.mode, tun: data.settings.tun, proxyPort: data.settings.proxyPort, selections: data.selections[data.activeId], proxyCount: profile?.config.proxies?.length, groupTypes: profile?.config['proxy-groups']?.map((g) => ({ name: g.name, type: g.type, count: g.proxies?.length })), ruleTypes: [...new Set((profile?.config.rules || []).map((r) => r.split(',')[0]))], finalRule: profile?.config.rules?.at(-1) }));
  if (!process.argv.includes('--probe-proxy')) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-remote-probe-'));
  const store = new VpnStore(root, safeStorage);
  data.settings.tun.enable = false; data.settings.mode = 'global'; data.settings.proxyPort = await freePort();
  store.commit(data);
  const manager = new VpnManager({ app, store, helper: undefined });
  try {
    await manager.start();
    const choices = [...new Set(Object.values(data.selections[data.activeId] || {}))];
    for (const name of choices) {
      const proxy = profile.config.proxies.find((p) => p.name === name); if (!proxy) continue;
      console.log(JSON.stringify({ probeServer: name, protocol: proxy.type, fields: Object.keys(proxy), tls: proxy.tls, hasClientFingerprint: Boolean(proxy['client-fingerprint']), hasReality: Boolean(proxy['reality-opts']) }));
      await manager.selectProxy('GLOBAL', name);
      const at = Date.now();
      try { const delay = await manager.delay(name); console.log(JSON.stringify({ coreDelay: delay.delay, elapsedMs: Date.now() - at })); } catch { console.log(JSON.stringify({ coreDelay: 'failed', elapsedMs: Date.now() - at })); }
      const result = await new Promise((resolve) => {
        const request = http.request({ hostname: '127.0.0.1', port: data.settings.proxyPort, method: 'CONNECT', path: 'www.gstatic.com:443', timeout: 12000 });
        request.on('error', (e) => resolve(e.code || 'CONNECT_FAILED'));
        request.on('timeout', () => { request.destroy(); resolve('CONNECT_TIMEOUT'); });
        request.on('connect', (response, socket) => {
          if (response.statusCode !== 200) { socket.destroy(); return resolve('CONNECT_HTTP_' + response.statusCode); }
          const secure = tls.connect({ socket, servername: 'www.gstatic.com', rejectUnauthorized: true });
          secure.setTimeout(12000); secure.on('timeout', () => { secure.destroy(); resolve('TLS_TIMEOUT'); });
          secure.on('error', (e) => resolve(e.code || 'TLS_FAILED'));
          secure.once('secureConnect', () => secure.write('GET /generate_204 HTTP/1.1\r\nHost: www.gstatic.com\r\nConnection: close\r\n\r\n'));
          secure.once('data', (chunk) => { const status = chunk.toString('ascii').match(/^HTTP\/\S+ (\d+)/)?.[1]; secure.destroy(); resolve(status ? 'HTTPS_' + status : 'INVALID_HTTPS'); });
          secure.once('end', () => resolve('TLS_EOF'));
        }); request.end();
      });
      console.log(JSON.stringify({ externalHttps: result }));
    }
  } finally { await manager.close(); fs.rmSync(root, { recursive: true, force: true }); }
}).catch((err) => { console.error('Cannot inspect VPN metadata: ' + err.message); process.exitCode = 1; }).finally(() => app.quit());
