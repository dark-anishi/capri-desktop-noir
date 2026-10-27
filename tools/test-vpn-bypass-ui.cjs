'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const executablePath = process.env.CAPRI_TEST_APP || require('electron');
const args = process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'];
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-bypass-ui-'));
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, lang: 'ru', skin: 'mono' }));
  let app;
  const errors = [], expected = ['music.yandex.ru', 'yastatic.net'];
  const open = async () => {
    app = await _electron.launch({ executablePath, args, cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    const overlay = await app.firstWindow(); const popup = app.waitForEvent('window');
    await overlay.evaluate(() => window.host.openMenu());
    const menu = await popup; menu.on('pageerror', (e) => errors.push(e.message));
    await menu.locator('[data-tab="vpn"]').click();
    await menu.waitForFunction(() => !document.getElementById('vpn').hasAttribute('aria-busy'));
    await menu.getByText('Сайты без VPN', { exact: true }).click();
    return menu;
  };
  try {
    let menu = await open();
    const global = await menu.evaluate(() => window.launcher.vpn.updateSettings({ mode: 'global' })); assert.equal(global.ok, true);
    await menu.locator('#vpn-bypass-sites').fill('https://MUSIC.YANDEX.RU/album/1\n*.yastatic.net\nmusic.yandex.ru');
    await menu.locator('#vpn-bypass-form button').click();
    await menu.waitForFunction(() => document.getElementById('vpn-bypass-sites').value === 'music.yandex.ru\nyastatic.net' && !document.getElementById('vpn').hasAttribute('aria-busy'));
    let status = await menu.evaluate(() => window.launcher.vpn.getStatus()); assert.deepEqual(status.state.settings.bypassSites, expected); assert.equal(status.state.settings.mode, 'global');
    await menu.locator('#vpn-bypass-sites').fill('MATCH,DIRECT'); await menu.locator('#vpn-bypass-form button').click();
    await menu.waitForFunction(() => !document.getElementById('vpn-error').hidden && !document.getElementById('vpn').hasAttribute('aria-busy'));
    status = await menu.evaluate(() => window.launcher.vpn.getStatus()); assert.deepEqual(status.state.settings.bypassSites, expected, 'invalid input must preserve saved exclusions');
    await menu.locator('#vpn-bypass-sites').fill(''); await menu.locator('#vpn-bypass-form button').click();
    await menu.waitForFunction(() => !document.getElementById('vpn').hasAttribute('aria-busy'));
    status = await menu.evaluate(() => window.launcher.vpn.getStatus()); assert.deepEqual(status.state.settings.bypassSites, []);
    await menu.locator('#vpn-bypass-sites').fill(expected.join('\n')); await menu.locator('#vpn-bypass-form button').click();
    await menu.waitForFunction(() => !document.getElementById('vpn').hasAttribute('aria-busy'));
    await app.close(); app = null;
    menu = await open();
    assert.equal(await menu.locator('#vpn-bypass-sites').inputValue(), expected.join('\n'));
    status = await menu.evaluate(() => window.launcher.vpn.getStatus()); assert.deepEqual(status.state.settings.bypassSites, expected); assert.equal(status.state.settings.mode, 'global');
    await menu.locator('#vpn-bypass-sites').scrollIntoViewIfNeeded();
    await menu.screenshot({ path: path.join(root, 'captures/vpn-bypass.png') });
    assert.deepEqual(errors, []);
    console.log('PACKAGED BYPASS UI PASS: URL normalization, deduplication, invalid-input preservation, clearing, saved global mode and persistence across a real Electron restart. No external website or live VPN connection changed.');
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
