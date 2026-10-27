'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { parseProfile, runtime, tunSettings, dnsSettings, bypassSites, TUN_DEFAULTS, DNS_DEFAULTS } = require('../src/main/vpn/config');
const { VpnStore } = require('../src/main/vpn/store');
const { downloadSubscription } = require('../src/main/vpn/subscription');
const { validateAction } = require('../src/main/vpn/ipc');
const { VpnManager, apiRequest } = require('../src/main/vpn/manager');
const { controlService } = require('../src/main/vpn/service-control');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const YAML = 'proxies:\n - name: Reality\n   type: vless\n   server: example.com\n   port: 443\n   uuid: 11111111-1111-4111-8111-111111111111\n   tls: true\n   reality-opts:\n     public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n     short-id: ab12\n';
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-vpn-test-')); const key = crypto.randomBytes(32);
  const cipher = { isEncryptionAvailable: () => true, encryptString: (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), bytes]); }, decryptString: (b) => { const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(); } };
  const store = new VpnStore(root, cipher);
  return Promise.resolve().then(() => fn({ root, cipher, store })).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}
test('profiles preserve VLESS Reality and never import privileged controller/TUN settings', () => {
  const parsed = parseProfile(YAML + 'external-controller: 0.0.0.0:9999\nsecret: stolen\ntun: {enable: true}\n');
  assert.equal(parsed.config.proxies[0]['reality-opts']['short-id'], 'ab12');
  assert.ok(parsed.ignoredFields.includes('secret'));
  const config = runtime(parsed.config, { tun: TUN_DEFAULTS, dns: DNS_DEFAULTS, mode: 'rule', proxyPort: 7897 }, '127.0.0.1:30000', 'owned');
  assert.equal(config.secret, 'owned'); assert.equal(config['external-controller'], '127.0.0.1:30000'); assert.equal(config.tun.enable, false); assert.equal(config['allow-lan'], false);
  assert.throws(() => parseProfile(YAML.replace('   tls: true', '   plugin: evil')));
  assert.throws(() => parseProfile(YAML.replace('   tls: true', '   private-key-file: C:/Windows/secret')));
  assert.throws(() => parseProfile('a: &a [*a,*a,*a]\nproxies: *a'));
});
test('TUN and DNS schemas reject unsupported stacks, malformed routes and unsafe fields', () => {
  for (const stack of ['system', 'gvisor', 'mixed']) assert.equal(tunSettings({ stack }).stack, stack);
  assert.throws(() => tunSettings({ stack: 'imaginary' })); assert.throws(() => tunSettings({ mtu: 9001 })); assert.throws(() => tunSettings({ 'route-exclude-address': ['1.1.1.1/50'] }));
  assert.throws(() => tunSettings({ device: 'x; cmd' })); assert.throws(() => dnsSettings({ command: 'evil' }));
  assert.equal(dnsSettings({ listen: '0.0.0.0:53' }).listen, '127.0.0.1:1053');
});

test('site exceptions normalize URLs, IDN, wildcard suffixes and IP literals; reject injected rules', () => {
  assert.deepEqual(bypassSites(['https://Music.Yandex.ru/album?id=1', 'music.yandex.ru', '*.example.com', 'пример.рф', '127.0.0.1', 'https://[2001:db8::1]/', '']), ['music.yandex.ru', 'example.com', 'xn--e1afmkfd.xn--p1ai', '127.0.0.1', '2001:db8::1']);
  for (const value of [['MATCH,DIRECT'], ['https://user:pass@example.com'], ['file://example.com/path'], ['ftp://example.com'], ['foo.*.com'], ['foo bar.com'], ['example.com\nMATCH,DIRECT'], ['a'.repeat(64) + '.com'], Array(501).fill('example.com'), 'example.com', null]) assert.throws(() => bypassSites(value));
});

test('site exceptions precede profile rules and keep GLOBAL as the global-mode fallback', () => {
  const profile = parseProfile(YAML).config;
  const settings = { tun: TUN_DEFAULTS, dns: DNS_DEFAULTS, mode: 'global', proxyPort: 7897, bypassSites: ['music.yandex.ru', '1.2.3.4'] };
  const global = runtime(profile, settings, '127.0.0.1:30000', 'test');
  assert.equal(global.mode, 'rule');
  assert.deepEqual(global.rules.slice(0, 2), ['DOMAIN-SUFFIX,music.yandex.ru,DIRECT', 'IP-CIDR,1.2.3.4/32,DIRECT,no-resolve']);
  assert.equal(global.rules.at(-1), 'MATCH,GLOBAL');
  assert.ok(global.rules.includes('DOMAIN-SUFFIX,music.yandex.net,DIRECT'), 'music delivery must precede the global fallback');
  assert.equal(runtime(profile, { ...settings, bypassSites: [] }, '127.0.0.1:30000', 'test').mode, 'global');
  assert.equal(runtime(profile, { ...settings, mode: 'direct' }, '127.0.0.1:30000', 'test').mode, 'direct');
  const rule = runtime(profile, { ...settings, mode: 'rule', rules: ['MATCH,REJECT'] }, '127.0.0.1:30000', 'test');
  assert.equal(rule.rules.at(-1), 'MATCH,REJECT'); assert.equal(rule.rules[0], global.rules[0]);
  assert.notEqual(profile.rules.at(-1), 'MATCH,REJECT', 'original profile must not be mutated');
});
test('encrypted profile store redacts passwords and subscription tokens from public state', () => fixture(({ store, root, cipher }) => {
  store.add('Private', parseProfile(YAML).config, 'https://example.com/private?token=do-not-show');
  assert.ok(!fs.readFileSync(path.join(root, 'profiles.dat')).includes(Buffer.from('do-not-show')));
  assert.ok(!JSON.stringify(store.publicProfiles()).includes('do-not-show'));
  const reload = new VpnStore(root, cipher); assert.equal(reload.data.profiles[0].url, 'https://example.com/private?token=do-not-show');
}));
test('HTTPS subscriptions enforce redirect scheme, private-address and response-size limits', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }];
  assert.equal(await downloadSubscription('https://example.com/profile', { lookup, fetchImpl: async () => new Response(YAML) }), YAML);
  await assert.rejects(downloadSubscription('http://example.com/profile', { lookup }), /HTTPS/);
  await assert.rejects(downloadSubscription('https://example.com/profile', { lookup: async () => [{ address: '127.0.0.1' }] }), /локальную/);
  await assert.rejects(downloadSubscription('https://example.com/profile', { lookup, fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }) }), /HTTPS/);
  await assert.rejects(downloadSubscription('https://example.com/profile', { lookup, fetchImpl: async () => new Response('x', { headers: { 'Content-Length': 99999999 } }) }), /2 МБ/);
});
test('subscription negotiation requests Mihomo YAML on import and redirects', async () => {
  let requests = 0;
  const result = await downloadSubscription('https://example.com/subscription', {
    lookup: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['User-Agent'], 'mihomo/1.19.33');
      assert.match(options.headers.Accept, /yaml/);
      if (++requests === 1) return new Response(null, { status: 302, headers: { Location: '/mihomo' } });
      // Providers can return an empty compatibility profile for unknown clients.
      return new Response(options.headers['User-Agent'].startsWith('mihomo/') ? YAML : 'proxies: []');
    },
  });
  assert.equal(requests, 2);
  assert.deepEqual(parseProfile(result).protocols, ['vless']);
});

test('VPN IPC rejects arbitrary commands, extra arguments and invalid profile identifiers', () => {
  assert.throws(() => validateAction('exec', { command: 'cmd.exe' }));
  assert.throws(() => validateAction('start', { path: 'evil' }));
  assert.throws(() => validateAction('select-proxy', { group: 'CAPRI', name: 'a', path: 'evil' }));
  assert.throws(() => validateAction('service', { operation: 'run-command' }));
  assert.throws(() => validateAction('select-profile', { id: '../../config' }));
  assert.deepEqual(validateAction('stop'), {});
  assert.deepEqual(validateAction('favorite', { name: 'Reality', favorite: true }), { name: 'Reality', favorite: true });
  assert.throws(() => validateAction('favorite', { name: 'Reality', favorite: 'true' }));
  assert.throws(() => validateAction('favorite', { name: 'Reality', favorite: true, path: 'evil' }));
});

test('favorite locations persist, remain scoped to a profile, and can be removed offline', () => fixture(async ({ store, root, cipher }) => {
  const first = store.add('One', parseProfile(YAML).config);
  const second = store.add('Two', parseProfile(YAML.replace('name: Reality', 'name: Other')).config);
  const manager = new VpnManager({ app: { getPath: () => root }, store, helper: {}, binaries: { installedHelper: path.join(root, 'absent') } });
  try {
    await manager.setFavorite('Reality', true); await manager.setFavorite('Reality', true);
    assert.deepEqual(manager.state().favorites, ['Reality']);
    assert.deepEqual(new VpnStore(root, cipher).data.favorites[first], ['Reality']);
    await assert.rejects(manager.setFavorite('Missing', true), /не найдена/);
    await manager.selectProfile(second); assert.deepEqual(manager.state().favorites, []);
    await manager.setFavorite('Other', true); assert.deepEqual(manager.state().favorites, ['Other']);
    await manager.selectProfile(first); assert.deepEqual(manager.state().favorites, ['Reality']);
    await manager.setFavorite('Reality', false); assert.deepEqual(manager.state().favorites, []);
    assert.deepEqual(store.data.favorites[second], ['Other']);
  } finally { await manager.close(); }
}));

test('service control distinguishes SCM failure, UAC cancellation and timeout without raw diagnostics (mock elevation)', async () => {
  const binaries = { elevatedScript: 'fixed-script', helper: 'fixed-helper', core: 'fixed-core' }, sid = 'S-1-5-21-1-2-3-1001';
  const execute = (code, output = JSON.stringify({ ok: code === 0, code })) => (_file, args, options, done) => {
    assert.equal(args[args.indexOf('-Operation') + 1], 'install'); assert.equal(options.windowsHide, true);
    done(code ? Object.assign(new Error('untrusted raw output'), { code }) : null, output);
  };
  await controlService(binaries, 'install', sid, execute(0));
  await assert.rejects(controlService(binaries, 'install', sid, execute(1053)), (err) => /не ответила Windows/.test(err.message) && !/отменён|raw output/.test(err.message));
  await assert.rejects(controlService(binaries, 'install', sid, execute(1223)), /UAC был отменён/);
  await assert.rejects(controlService(binaries, 'install', sid, execute(1460)), /Истекло время/);
  await assert.rejects(controlService(binaries, 'install', sid, execute(1, 'invalid output')), /кодом 1/);
  await assert.rejects(controlService(binaries, 'exec', sid, () => { throw new Error('must not execute'); }), /Некорректная/);
});
test('Mihomo REST client sends a bearer secret and handles failed responses without leaking it', async () => {
  let authorization;
  const server = http.createServer((req, res) => { authorization = req.headers.authorization; if (req.url === '/fail') res.writeHead(500); res.end('{}'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { const endpoint = '127.0.0.1:' + server.address().port; await apiRequest(endpoint, 'hidden', 'GET', '/version'); assert.equal(authorization, 'Bearer hidden'); await assert.rejects(apiRequest(endpoint, 'hidden', 'GET', '/fail'), /HTTP 500/); await assert.rejects(apiRequest('0.0.0.0:9999', 'hidden', 'GET', '/'), /Недопустимый/); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});
test('subscription apply rolls back to the previous working configuration on restart failure (mock lifecycle)', () => fixture(async ({ store, root }) => {
  const id = store.add('Profile', parseProfile(YAML).config, 'https://example.com/sub');
  const manager = new VpnManager({ app: { getPath: () => root }, store, helper: {}, binaries: { installedHelper: path.join(root, 'absent') }, subscription: async () => YAML.replace('name: Reality', 'name: Replacement') });
  manager.validate = async () => {}; manager.wanted = true;
  let restarts = 0; manager.restartInternal = async () => { if (++restarts === 1) throw new Error('restart failed'); };
  try { await assert.rejects(manager.updateSubscription(id), /restart failed/); assert.equal(store.profile(id).config.proxies[0].name, 'Reality'); assert.equal(restarts, 2); }
  finally { manager.wanted = false; await manager.close(); }
}));

test('compiled native service policy rejects dangerous configuration (policy check only; no service/TUN)', () => {
  const helper = path.resolve(__dirname, '../native/bin/Capri.Windows.exe');
  const config = runtime(parseProfile(YAML).config, { tun: TUN_DEFAULTS, dns: DNS_DEFAULTS, mode: 'rule', proxyPort: 7897 }, '127.0.0.1:30000', 'test-only');
  const valid = execFileSync(helper, ['--check-policy'], { input: JSON.stringify(config), encoding: 'utf8', windowsHide: true }); assert.equal(JSON.parse(valid).ok, true);
  for (const change of [(c) => { c['external-ui'] = 'C:/Windows'; }, (c) => { c.tun.stack = 'invalid'; }, (c) => { c.proxies[0].plugin = 'evil.exe'; }, (c) => { c.proxies[0]['private-key-file'] = 'C:/Windows/secret'; }]) {
    const invalid = structuredClone(config); change(invalid);
    assert.throws(() => execFileSync(helper, ['--check-policy'], { input: JSON.stringify(invalid), encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
  }
});

test('privileged REST proxy blocks upgrades, arbitrary reloads and path traversal (native policy only)', () => {
  const helper = path.resolve(__dirname, '../native/bin/Capri.Windows.exe');
  const check = (input) => execFileSync(helper, ['--check-api'], { input: JSON.stringify({ action: 'api', ...input }), encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(JSON.parse(check({ method: 'GET', target: '/version' })).ok, true);
  assert.equal(JSON.parse(check({ method: 'PUT', target: '/proxies/CAPRI', body: { name: 'Server' } })).ok, true);
  assert.equal(JSON.parse(check({ method: 'DELETE', target: '/connections' })).ok, true);
  assert.equal(JSON.parse(check({ method: 'PATCH', target: '/configs', body: { tun: { enable: false } } })).ok, true);
  for (const request of [{ method: 'POST', target: '/upgrade' }, { method: 'DELETE', target: '/connections/arbitrary' }, { method: 'DELETE', target: '/connections?extra=1' }, { method: 'DELETE', target: '/connections', body: { all: true } }, { method: 'PUT', target: '/configs', body: { path: 'C:/Windows/secret' } }, { method: 'PATCH', target: '/configs', body: { tun: { enable: true } } }, { method: 'PUT', target: '/proxies/a%2f..%2f..%2fconfigs', body: { name: 'evil' } }, { method: 'GET', target: '/proxies/A/delay?url=http://127.0.0.1/' }]) assert.throws(() => check(request));
});

test('old TUN services reconnect automatically after selection; selecting the same server is non-disruptive', () => fixture(async ({ store, root }) => {
  store.add('Profile', parseProfile(YAML).config);
  const manager = new VpnManager({ app: { getPath: () => root }, store, helper: {}, binaries: { installedHelper: path.join(root, 'absent') } });
  manager.wanted = true; manager.phase = 'connected'; manager.usingService = true;
  let selected = 'Previous', restarts = 0; const calls = [];
  manager.refreshProxies = async () => { manager.proxies = [{ name: 'GLOBAL', type: 'Selector', now: selected, all: ['Previous', 'Reality'] }]; };
  manager.api = async (method, target, body) => {
    calls.push([method, target]);
    if (method === 'PUT') selected = body.name;
    else if (method === 'DELETE') throw new Error('API operation is not allowed');
    return {};
  };
  manager.restartInternal = async () => { restarts++; assert.equal(store.data.selections[store.data.activeId].GLOBAL, 'Reality'); return manager.state(); };
  try {
    await manager.selectProxy('GLOBAL', 'Reality');
    assert.deepEqual(calls, [['PUT', '/proxies/GLOBAL'], ['DELETE', '/connections']]); assert.equal(restarts, 1);
    await manager.selectProxy('GLOBAL', 'Reality'); assert.equal(restarts, 1); assert.equal(calls.length, 2);
    assert.equal(manager.phase, 'connected');
  } finally { manager.usingService = false; await manager.close(); }
}));

test('lost privileged control cannot falsely report a successful disconnect (mock service)', () => fixture(async ({ store, root }) => {
  const manager = new VpnManager({ app: { getPath: () => root }, store, helper: { run: async () => { throw new Error('pipe unavailable'); } }, binaries: { installedHelper: path.join(root, 'absent') } });
  manager.phase = 'connected'; manager.wanted = true; manager.usingService = true;
  try { await assert.rejects(manager.stop(), /подтвердить отключение/); assert.equal(manager.phase, 'error'); assert.equal(manager.wanted, false); }
  finally { manager.usingService = false; await manager.close(); }
}));
