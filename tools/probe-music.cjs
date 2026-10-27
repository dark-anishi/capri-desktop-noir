'use strict';
// Explicit connectivity diagnostic. No cookies, account tokens or page bodies are printed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), tls = require('node:tls');
const { execFileSync, spawn } = require('node:child_process');
const { freePort } = require('../src/main/vpn/manager');
const { paths, verify } = require('../src/main/vpn/paths');
function probe(port) {
  return new Promise((resolve) => {
    let secure, socket, finished = false;
    const done = (result) => { if (finished) return; finished = true; clearTimeout(timer); secure?.destroy(); socket?.destroy(); request.destroy(); resolve(result); };
    const request = http.request({ hostname: '127.0.0.1', port, method: 'CONNECT', path: 'music.yandex.ru:443' });
    const timer = setTimeout(() => done({ result: 'TIMEOUT' }), 14000);
    request.on('error', (err) => done({ result: err.code || 'CONNECT_FAILED' }));
    request.on('connect', (res, connection) => {
      socket = connection;
      if (res.statusCode !== 200) return done({ result: 'CONNECT_HTTP_' + res.statusCode });
      secure = tls.connect({ socket, servername: 'music.yandex.ru', rejectUnauthorized: true });
      secure.on('error', (err) => done({ result: err.code || 'TLS_FAILED' }));
      secure.once('secureConnect', () => secure.write('GET / HTTP/1.1\r\nHost: music.yandex.ru\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n'));
      let bytes = 0, first = '';
      secure.on('data', (chunk) => { bytes += chunk.length; if (first.length < 5000) first += chunk.toString(); if (bytes > 2 * 1024 * 1024) done({ result: 'HTTP_' + first.match(/^HTTP\/\S+ (\d+)/)?.[1], bytes, captcha: /SmartCaptcha|showcaptcha/i.test(first) }); });
      secure.on('end', () => done({ result: first ? 'HTTP_' + first.match(/^HTTP\/\S+ (\d+)/)?.[1] : 'TLS_EOF', bytes, captcha: /SmartCaptcha|showcaptcha/i.test(first) }));
    }); request.end();
  });
}
(async () => {
  const network = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$adapter = Get-NetAdapter -Physical | Where-Object Status -eq Up | Select-Object -First 1; if (!$adapter) { throw 'No physical adapter' }; @{name=$adapter.Name;dns=@((Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4).ServerAddresses)} | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }));
  if (!network.dns.length) throw new Error('Physical DNS is unavailable.');
  const p = paths({ isPackaged: false }), manifest = JSON.parse(fs.readFileSync(p.manifest));
  verify(p.core, manifest.coreSha256); verify(p.helper, manifest.helperSha256);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-music-probe-')), port = await freePort(); let child;
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ 'mixed-port': port, 'allow-lan': false, 'bind-address': '127.0.0.1', 'log-level': 'silent', mode: 'direct', 'interface-name': network.name, dns: { enable: true, nameserver: network.dns, 'default-nameserver': network.dns }, rules: ['MATCH,DIRECT'] }));
    child = spawn(p.helper, ['--sidecar', p.core, dir, file], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }); child.stdin.on('error', () => {});
    await new Promise((r) => setTimeout(r, 800));
    console.log(JSON.stringify({ path: 'physical-interface-direct', ...await probe(port) }));
    if (process.argv[2]) console.log(JSON.stringify({ path: 'current-vpn-proxy', ...await probe(Number(process.argv[2])) }));
  } finally {
    if (child) { child.stdin.end(); await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
