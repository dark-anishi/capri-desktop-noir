'use strict';
// Read only metadata from DPAPI. Never opens real userData, starts/stops a core,
// writes a profile, prints credentials, subscription URLs or server addresses.
const { app, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-vpn-metadata-'));
const local = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'capri-desktop/Local State'), 'utf8'));
fs.writeFileSync(path.join(temp, 'Local State'), JSON.stringify({ os_crypt: local.os_crypt }), { mode: 0o600 });
app.setPath('userData', temp);
app.whenReady().then(() => {
  const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(process.env.APPDATA, 'capri-desktop/vpn/profiles.dat'))));
  const profile = data.profiles.find(p => p.id === data.activeId), settings = data.settings;
  const selections = Object.entries(data.selections?.[data.activeId] || {}).map(([group, name]) => ({ group, name, protocol: profile?.config.proxies?.find(p => p.name === name)?.type || 'group' }));
  const dns = settings.dns || {};
  console.log(JSON.stringify({ mode: settings.mode, proxyPort: settings.proxyPort, tun: { enable: settings.tun?.enable, stack: settings.tun?.stack, autoRoute: settings.tun?.['auto-route'], strictRoute: settings.tun?.['strict-route'], autoDetect: settings.tun?.['auto-detect-interface'], mtu: settings.tun?.mtu, dnsHijack: settings.tun?.['dns-hijack'] }, dns: { mode: dns['enhanced-mode'], respectRules: dns['respect-rules'], nameserverCount: dns.nameserver?.length, proxyNameserverCount: dns['proxy-server-nameserver']?.length }, bypassCount: settings.bypassSites?.length || 0, selections, proxyCount: profile?.config.proxies?.length }));
}).catch(() => { console.error('Cannot read VPN metadata.'); process.exitCode = 1; }).finally(() => app.quit());
app.on('will-quit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { } });
