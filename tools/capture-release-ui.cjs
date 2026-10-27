'use strict';
// Capture current, unmodified 0.6.11 UI with an isolated library and session.
// The VPN demo stays disconnected: DNS port1053 may belong to the user's VPN.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), version = '0.6.11';
const output = path.join(root, 'docs', 'screenshots', version);
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-release-ui-'));
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  let app; const errors = [], captures = [];
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'dist', 'win-unpacked', 'Capri.exe'), args: ['--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47832', PUBLIC: path.join(temp, 'Public') } });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    const overlay = await app.firstWindow();
    await overlay.waitForFunction(() => document.documentElement.dataset.skin === 'mono');
    const fixtures = await app.evaluate(({ app, shell }, temp) => {
      const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
      const requirePackaged = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(), 'package.json'));
      const { LauncherStore } = requirePackaged('./src/main/launcher-store.js');
      const desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop); app.setPath('desktop', desktop);
      const store = new LauncherStore(path.join(temp, 'launcher'), [desktop]);
      const windir = process.env.WINDIR || 'C:\\Windows';
      const entries = [
        ['Блокнот', path.join(windir, 'System32', 'notepad.exe')],
        ['Проводник', path.join(windir, 'explorer.exe')],
        ['Калькулятор', path.join(windir, 'System32', 'calc.exe')],
        ['PowerShell', path.join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')],
        ['Capri', process.execPath],
      ];
      for (const [name, target] of entries) {
        if (!fs.existsSync(target)) throw new Error('Missing system fixture: ' + name);
        const source = path.join(desktop, name + '.lnk');
        if (!shell.writeShortcutLink(source, { target, icon: target, iconIndex: 0 })) throw new Error('Could not write fixture: ' + name);
        const { entry } = store.importOne(source, name === 'Capri' ? 'other' : 'work'); store.recordLaunch(entry.id);
      }
      for (const name of ['Projects', 'Documents', 'Music']) { const folder = path.join(temp, name); fs.mkdirSync(folder); store.importFolder(folder); }
      return { entries: store.list().entries.length, folders: store.list().folders.length, packagedRoot: app.getAppPath() };
    }, temp);
    assert.deepEqual({ entries: fixtures.entries, folders: fixtures.folders }, { entries: 5, folders: 3 });
    const popup = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openMenu()); const menu = await popup;
    menu.on('pageerror', e => errors.push(e.message)); await menu.locator('.category').first().waitFor();
    await menu.evaluate(async () => { await document.fonts.ready; });
    fs.mkdirSync(output, { recursive: true });
    const shot = async (name, page = menu) => {
      await page.waitForTimeout(350);
      const url = page.url();
      const png = await app.evaluate(async ({ BrowserWindow }, url) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url);
        if (!win) throw new Error('Capture window disappeared');
        return (await win.capturePage()).toPNG().toString('base64');
      }, url);
      const file = path.join(output, name + '.png'); fs.writeFileSync(file, Buffer.from(png, 'base64'));
      captures.push(path.relative(root, file).replaceAll('\\', '/'));
    };
    await menu.locator('.category[data-category="recent-apps"]').click(); await menu.locator('.entry-launch').nth(4).waitFor();
    await menu.waitForFunction(() => Array.from(document.querySelectorAll('.entry-launch img')).every(i => i.complete && i.naturalWidth > 0));
    await shot('apps');
    await menu.locator('.entry-launch').filter({ hasText: 'Блокнот' }).click({ button: 'right' }); await menu.locator('#shortcut-menu').waitFor(); await shot('apps-context'); await menu.keyboard.press('Escape');
    await menu.locator('[data-tab="folders"]').click(); await menu.locator('#folder-entries .entry').nth(2).waitFor(); await shot('folders');
    await menu.locator('[data-tab="skins"]').click(); await menu.waitForFunction(() => Array.from(document.querySelectorAll('.skin-preview img')).every(i => i.complete && i.naturalWidth > 0)); await shot('skins');
    const fixture = path.join(temp, 'Демо — локальный профиль.yaml');
    fs.writeFileSync(fixture, 'proxies:\n  - name: Demo HTTP (localhost)\n    type: http\n    server: 127.0.0.1\n    port: 9\n  - name: Demo SOCKS5 (localhost)\n    type: socks5\n    server: 127.0.0.1\n    port: 9\nproxy-groups:\n  - name: CAPRI DEMO\n    type: select\n    proxies: [DIRECT, Demo HTTP (localhost), Demo SOCKS5 (localhost)]\nrules:\n  - MATCH,DIRECT\n');
    await menu.locator('[data-tab="vpn"]').click();
    await app.evaluate(({ dialog }, file) => { dialog.__captureOpen = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture);
    try { const result = await menu.evaluate(() => window.launcher.vpn.importFile()); assert.equal(result.ok, true, result.error); }
    finally { await app.evaluate(({ dialog }) => { dialog.showOpenDialog = dialog.__captureOpen; delete dialog.__captureOpen; }); }
    await menu.waitForFunction(() => document.querySelector('#vpn-profile option')?.textContent.includes('Демо') && !document.getElementById('vpn').hasAttribute('aria-busy'));
    const vpn = await menu.evaluate(() => window.launcher.vpn.getStatus()); assert.equal(vpn.state.phase, 'disconnected'); assert.equal(vpn.state.settings.tun.enable, false);
    await shot('vpn');
    await menu.locator('[data-tab="music"]').click();
    const deadline = Date.now() + 65000; let music;
    do {
      await menu.waitForTimeout(1800);
      music = await app.evaluate(async ({ webContents }) => {
        const player = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://music.yandex.ru/'));
        if (!player) return { found: false };
        let text = ''; try { text = await player.executeJavaScript('document.body?.innerText?.slice(0,300) || ""'); } catch { }
        return { found: true, url: player.getURL(), loading: player.isLoading(), text };
      });
      if (music.found && !music.loading && music.text.length > 30) break;
      const state = await menu.locator('#music-state').textContent(); if (/не загрузилась|Плеер остановился/.test(state)) break;
    } while (Date.now() < deadline);
    await menu.waitForTimeout(2000); await shot('music');
    await menu.locator('[data-tab="apps"]').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/launcher/')).hide());
    const quickPopup = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openQuickMenu()); const quick = await quickPopup;
    await quick.locator('#quick-rest').waitFor(); await quick.evaluate(async () => { await document.fonts.ready; }); await shot('quick-menu', quick);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ version, capturedAt: new Date().toISOString(), fixtures, vpn: { phase: vpn.state.phase, tun: vpn.state.settings.tun.enable, profile: vpn.state.profiles[0]?.name }, music, captures }, null, 2));
  } finally {
    if (app) await app.close();
    const resolved = path.resolve(temp); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
