'use strict';
// Explicit manual acceptance gate: requires an installed, idle Capri service.
// Creates a real adapter but does not intercept default routes or DNS traffic.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const http = require('node:http'); const { execFileSync } = require('node:child_process');
const { createWindowsHelper } = require('../src/main/windows-helper');
const { parseProfile, runtime, TUN_DEFAULTS, DNS_DEFAULTS } = require('../src/main/vpn/config');
const { freePort } = require('../src/main/vpn/manager');
if (!process.argv.includes('--test-interface')) throw new Error('Run explicitly with --test-interface; requires an installed idle Capri service.');
const helper = createWindowsHelper({ isPackaged: false });
function adapters() {
  const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | Where-Object Name -eq 'CapriProbeTun' | Select-Object Name,Status) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true });
  const values = JSON.parse(text || '[]'); return Array.isArray(values) ? values : [values];
}
(async () => {
  const status = await helper.run(['--client'], { action: 'status' });
  assert.ok(!status.running && !status.desired, 'Stop your Capri connection before this test.');
  assert.equal(adapters().length, 0, 'Test adapter name is already used.');
  const origin = http.createServer((_req, res) => res.end('service-proxy-ok'));
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  try {
    for (const stack of ['system', 'gvisor', 'mixed']) {
      let started = false;
      try {
        const profile = parseProfile('proxies:\n - name: Fixture\n   type: socks5\n   server: 127.0.0.1\n   port: 9\nproxy-groups:\n - name: CAPRI\n   type: select\n   proxies: [DIRECT, Fixture]\nrules: ["MATCH,CAPRI"]');
        const proxyPort = await freePort();
        const config = runtime(profile.config, { tun: { ...structuredClone(TUN_DEFAULTS), enable: true, stack, device: 'CapriProbeTun', 'auto-route': false, 'strict-route': false, 'dns-hijack': [], 'inet4-address': ['172.31.255.1/30'] }, dns: DNS_DEFAULTS, proxyPort, mode: 'rule' }, '127.0.0.1:' + await freePort(), crypto.randomBytes(32).toString('hex'));
        started = true;
        const reply = await helper.run(['--client'], { action: 'start', config }, 50000); assert.equal(reply.running, true);
        let up = false;
        for (let i = 0; i < 20; i++) { if (adapters().some((a) => a.Status === 'Up')) { up = true; break; } await new Promise((r) => setTimeout(r, 250)); }
        assert.ok(up, 'Real Windows TUN adapter must be Up.');
        const body = await new Promise((resolve, reject) => {
          const request = http.get({ hostname: '127.0.0.1', port: proxyPort, path: `http://127.0.0.1:${origin.address().port}/test`, headers: { Host: `127.0.0.1:${origin.address().port}`, Connection: 'close' }, timeout: 6000 }, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve(body)); });
          request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Proxy timeout')));
        });
        assert.equal(body, 'service-proxy-ok');
      } finally { if (started) await helper.run(['--client'], { action: 'stop' }, 15000); }
      for (let i = 0; i < 10 && adapters().length; i++) await new Promise((r) => setTimeout(r, 300));
      assert.equal(adapters().length, 0, 'Test TUN adapter must be removed.');
      console.log(`PASS ${stack}: authenticated service, real adapter Up, local proxy traffic, adapter cleanup. Auto Route/DNS Hijack disabled; no remote VPN traffic tested.`);
    }
  } finally { await new Promise((resolve) => origin.close(resolve)); }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
