'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const net = require('node:net');
const executablePath = process.env.CAPRI_TEST_APP || require('electron');
const launchArgs = process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'];

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-ui-'));
  const desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, lang: 'ru', skin: 'mono' }));
  const errors = [];
  let application, occupied;
  try {
    application = await _electron.launch({ executablePath, args: launchArgs, cwd: root,
      env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    application.on('window', (page) => page.on('pageerror', (err) => errors.push(err.message)));
    const overlay = await application.firstWindow();
    overlay.on('pageerror', (err) => errors.push(err.message));
    overlay.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await overlay.waitForFunction(() => document.documentElement.dataset.skin === 'mono');
    const source = path.join(desktop, 'Тест Capri.lnk');
    const expectedIcon = await application.evaluate(({ app, shell, nativeImage }, { desktop, source, root }) => {
      app.setPath('desktop', desktop);
      const icon = root + '/assets/icons/capri-mono.ico';
      if (!shell.writeShortcutLink(source, { target: process.execPath, args: `"${root}" --dev`, description: 'Capri launch test', icon, iconIndex: 0 })) throw new Error('Could not create test shortcut');
      return nativeImage.createFromPath(icon).resize({ width: 48, height: 48 }).toDataURL();
    }, { desktop, source, root });
    const popup = application.waitForEvent('window');
    await overlay.evaluate(() => window.host.openMenu());
    const menu = await popup;
    menu.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await menu.locator('.category').first().waitFor();
    await application.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/'));
      const rect = win.getBounds(), area = screen.getDisplayMatching(rect).workArea;
      // Windows includes a few DIP of invisible resize borders in outer bounds.
      if (Math.abs(rect.width - Math.min(1065, area.width)) > 10 || Math.abs(rect.height - Math.min(930, area.height)) > 10) throw new Error('Menu size mismatch: ' + JSON.stringify({ rect, area }));
      if (Math.abs(rect.x - (area.x + (area.width - rect.width) / 2)) > 4 || Math.abs(rect.y - (area.y + (area.height - rect.height) / 2)) > 4) throw new Error('Menu is not centered: ' + JSON.stringify({ rect, area }));
    });
    await menu.locator('#add-category').click();
    await menu.locator('#category-name').fill('Тестовая');
    await menu.locator('#category-form button[type="submit"]').click();
    await menu.locator('#category-title').filter({ hasText: 'Тестовая' }).waitFor();
    await menu.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'test-file'; input.hidden = true; document.body.append(input); });
    await menu.locator('#test-file').setInputFiles(source);
    await menu.evaluate(() => {
      const data = new DataTransfer(); data.items.add(document.getElementById('test-file').files[0]);
      document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await menu.locator('.entry-launch').waitFor();
    const firstState = await menu.evaluate(() => window.launcher.state());
    assert.equal(firstState.state.entries[0].icon, expectedIcon, 'custom .lnk icon must be used');
    assert.equal(fs.existsSync(source), false, 'desktop shortcut should be moved');
    assert.equal(await menu.locator('.entry-controls, .restore, .entry select').count(), 0, 'tiles must only contain an icon and label');
    await menu.locator('.entry-launch').click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Переместить в категорию…', exact: true }).click();
    await menu.getByRole('menuitem', { name: 'Игры', exact: true }).click();
    await menu.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    await menu.locator('.category').filter({ hasText: 'Игры' }).click();
    await menu.locator('.entry-launch').waitFor();
    await menu.locator('.entry-launch').click();
    await application.evaluate(async ({ BrowserWindow }) => {
      const menu = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/'));
      const deadline = Date.now() + 5000;
      while (menu.isVisible() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 30));
      if (menu.isVisible()) throw new Error('Application launch did not hide the menu');
    });
    await overlay.evaluate(() => window.host.openMenu());
    await menu.locator('.entry-launch').click({ button: 'right' });
    await menu.keyboard.press('Escape');
    assert.equal(await menu.locator('#shortcut-menu').isHidden(), true, 'Escape must close the context menu');
    await menu.locator('.entry-launch').click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Вернуть на рабочий стол', exact: true }).click();
    await menu.waitForFunction(() => document.querySelectorAll('.entry').length === 0);
    assert.equal(fs.existsSync(source), true, 'restore should return the shortcut');
    assert.equal(await menu.locator('footer').isHidden(), true, 'restoring a shortcut must be silent');
    assert.equal((await menu.locator('body').textContent()).includes('Ярлык снова на рабочем столе'), false);
    const urlSource = path.join(desktop, 'Тест игры.url');
    fs.writeFileSync(urlSource, `[InternetShortcut]\nURL=steam://rungameid/0\nIconFile=${path.join(root, 'assets/icons/capri-mono.ico')}\nIconIndex=0\n`);
    const urlResult = await menu.evaluate(async ({ file }) => {
      const result = await window.launcher.importPaths([file], 'games');
      return result.state.entries[0];
    }, { file: urlSource });
    assert.equal(urlResult.icon, expectedIcon, 'Steam .url must use IconFile instead of a globe');
    await menu.evaluate((id) => window.launcher.restore(id), urlResult.id);
    await menu.locator('[data-tab="skins"]').click();
    await menu.locator('[data-skin="classic"]').click();
    await overlay.waitForFunction(() => document.documentElement.dataset.skin === 'classic');
    await menu.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    await menu.locator('[data-skin="mono"]').click();
    await overlay.waitForFunction(() => document.documentElement.dataset.skin === 'mono');
    fs.mkdirSync(path.join(root, 'captures'), { recursive: true });
    await menu.screenshot({ path: path.join(root, 'captures/skins.png') });
    await menu.locator('[data-tab="apps"]').click();
    // Populate visual QA with copies of actual app shortcuts, never moving the user's originals.
    const previewDir = path.join(temp, 'preview'); fs.mkdirSync(previewDir);
    const userDesktop = path.join(os.homedir(), 'Desktop');
    const previewNames = ['Blender', 'Cyberpunk 2077', "Baldur's Gate 3", 'Battlefield™ 6', 'Яндекс Музыка', 'Roblox Player', 'Roblox Studio'];
    const previewFiles = [];
    for (const name of fs.readdirSync(userDesktop).filter((name) => previewNames.includes(path.parse(name).name) && /\.(lnk|url)$/i.test(name))) {
      const file = path.join(previewDir, name); fs.copyFileSync(path.join(userDesktop, name), file); previewFiles.push(file);
    }
    await menu.evaluate((files) => window.launcher.importPaths(files, 'games'), previewFiles);
    await overlay.evaluate(() => window.host.openMenu());
    await menu.waitForFunction((count) => document.querySelectorAll('.entry').length === count, previewFiles.length);
    if (previewFiles.length) {
      await menu.locator('.entry-launch').first().waitFor();
      const layout = await menu.locator('.entry-launch').first().evaluate((button) => ({ image: button.querySelector('img').getBoundingClientRect().bottom, label: button.querySelector('strong').getBoundingClientRect().top }));
      assert.ok(layout.label >= layout.image, 'labels must sit below icons');
    }
    await menu.screenshot({ path: path.join(root, 'captures/launcher.png') });
    if (previewFiles.length) {
      await menu.locator('.entry-launch').first().click({ button: 'right' });
      await menu.screenshot({ path: path.join(root, 'captures/launcher-context.png') });
      await menu.keyboard.press('Escape');
    }
    await menu.locator('#minimize').click();
    await application.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/'));
      const deadline = Date.now() + 3000;
      while (!win.isMinimized() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 40));
      if (!win.isMinimized() || !win.isMinimizable()) throw new Error('Launcher minimization failed');
    });
    await overlay.evaluate(() => window.host.openMenu());
    await menu.locator('[data-tab="vpn"]').click();
    await menu.waitForFunction(() => !document.getElementById('vpn').hasAttribute('aria-busy'));
    const initialVpn = await menu.evaluate(() => window.launcher.vpn.getStatus());
    assert.equal(initialVpn.ok, true); assert.equal(initialVpn.state.phase, 'disconnected');
    const invalidVpn = await menu.evaluate(() => window.launcher.vpn.updateSettings({ executable: 'evil.exe' }));
    assert.equal(invalidVpn.ok, false);
    const fixture = path.join(temp, 'vpn-fixture.yaml');
    fs.writeFileSync(fixture, 'proxies:\n - name: Fixture\n   type: ss\n   server: 127.0.0.1\n   port: 9\n   cipher: aes-128-gcm\n   password: test-secret-never-render\n - name: Other\n   type: socks5\n   server: 127.0.0.1\n   port: 9\nproxy-groups:\n - name: CAPRI\n   type: select\n   proxies: [DIRECT, Fixture, Other]\nrules: ["MATCH,CAPRI"]\n');
    await application.evaluate(({ dialog }, file) => { dialog.__originalForTest = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture);
    await menu.locator('#vpn-import-file').click();
    await menu.waitForFunction(() => document.querySelectorAll('#vpn-profile option[value]:not([value=""])').length > 0 && !document.getElementById('vpn').hasAttribute('aria-busy'));
    await application.evaluate(({ dialog }) => { dialog.showOpenDialog = dialog.__originalForTest; delete dialog.__originalForTest; });
    assert.ok(!fs.readFileSync(path.join(temp, 'vpn/profiles.dat')).includes(Buffer.from('test-secret-never-render')), 'real DPAPI storage must not contain plaintext credentials');
    await menu.getByText('Сайты без VPN', { exact: true }).click();
    await menu.locator('#vpn-bypass-sites').fill('https://EXAMPLE.com/page\n*.example.com');
    await menu.locator('#vpn-bypass-form button[type="submit"]').click();
    await menu.waitForFunction(() => document.getElementById('vpn-bypass-sites').value === 'example.com' && !document.getElementById('vpn').hasAttribute('aria-busy'));
    const invalidBypass = await menu.evaluate(() => window.launcher.vpn.updateSettings({ bypassSites: ['MATCH,DIRECT'] }));
    assert.equal(invalidBypass.ok, false, 'rule injection must be rejected by IPC manager validation');
    await menu.getByText('Сайты без VPN', { exact: true }).click();
    occupied = net.createServer();
    await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const vpnPort = occupied.address().port;
    await menu.evaluate((proxyPort) => window.launcher.vpn.updateSettings({ proxyPort }), vpnPort);
    await menu.locator('#vpn-connect').click();
    await menu.waitForFunction(() => document.getElementById('vpn-phase').dataset.phase === 'connected', null, { timeout: 30000 });
    const publicVpn = await menu.evaluate(() => window.launcher.vpn.getStatus());
    const selectedPort = publicVpn.state.settings.proxyPort;
    assert.notEqual(selectedPort, vpnPort, 'busy port must be replaced');
    await menu.waitForFunction((port) => document.getElementById('vpn-port').value === String(port) && document.getElementById('vpn-address').textContent === '127.0.0.1:' + port, selectedPort);
    assert.ok(occupied.listening, 'other application listener must remain open');
    assert.ok(!JSON.stringify(publicVpn).includes('test-secret-never-render'));
    assert.ok(!Object.hasOwn(publicVpn.state, 'secret') && !Object.hasOwn(publicVpn.state, 'endpoint'));
    await menu.locator('.vpn-group select[aria-label="CAPRI"]').selectOption('Fixture');
    await menu.waitForFunction(() => document.querySelector('.vpn-group select[aria-label="CAPRI"]').value === 'Fixture' && !document.querySelector('.vpn-group select[aria-label="CAPRI"]').parentElement.querySelector('.vpn-favorite').disabled && !document.getElementById('vpn').hasAttribute('aria-busy'));
    await menu.locator('.vpn-group').filter({ has: menu.locator('select[aria-label="CAPRI"]') }).locator('.vpn-favorite').click();
    await menu.waitForFunction(() => document.querySelector('.vpn-group select[aria-label="CAPRI"]').parentElement.querySelector('.vpn-favorite').getAttribute('aria-pressed') === 'true');
    await menu.waitForFunction(() => !document.getElementById('vpn').hasAttribute('aria-busy'));
    await menu.locator('.vpn-group').filter({ has: menu.locator('select[aria-label="CAPRI"]') }).locator('.vpn-favorite').click();
    await menu.waitForFunction(() => document.querySelector('.vpn-group select[aria-label="CAPRI"]').parentElement.querySelector('.vpn-favorite').getAttribute('aria-pressed') === 'false' && !document.getElementById('vpn').hasAttribute('aria-busy'));
    await menu.locator('.vpn-group').filter({ has: menu.locator('select[aria-label="CAPRI"]') }).locator('.vpn-favorite').click();
    await menu.waitForFunction(() => document.querySelector('.vpn-group select[aria-label="CAPRI"]').parentElement.querySelector('.vpn-favorite').getAttribute('aria-pressed') === 'true');
    await menu.locator('.vpn-favorites-filter').click();
    assert.equal(await menu.locator('.vpn-group select[aria-label="CAPRI"] option[value="Other"]').count(), 0);
    assert.equal(await menu.locator('.vpn-group select[aria-label="CAPRI"] optgroup[label="Избранные"] option[value="Fixture"]').count(), 1);
    assert.equal(await menu.locator('#vpn-servers > p').count(), 0, 'server text dump must be absent');
    await menu.locator('.vpn-favorites-filter').click();
    assert.equal(await menu.locator('.vpn-group select[aria-label="CAPRI"] option[value="Other"]').count(), 1);
    await menu.screenshot({ path: path.join(root, 'captures/vpn.png') });
    await menu.locator('#vpn-connect').click();
    await menu.waitForFunction(() => document.getElementById('vpn-phase').dataset.phase === 'disconnected');
    await menu.locator('[data-tab="music"]').click();
    await menu.waitForFunction(() => document.getElementById('music-loading').hidden, null, { timeout: 60000 });
    const musicInfo = await application.evaluate(async ({ webContents, BrowserWindow }) => {
      const player = webContents.getAllWebContents().find((c) => c.getURL().startsWith('https://music.yandex.ru/'));
      if (!player) throw new Error('Embedded music view missing');
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline && !await player.executeJavaScript('document.body.innerText.length > 100')) await new Promise((r) => setTimeout(r, 200));
      await new Promise((r) => setTimeout(r, 1500)); // let the site's entrance animation settle before visual QA
      const details = await player.executeJavaScript('({title:document.title,url:location.href,filter:getComputedStyle(document.documentElement).filter,hasHostBridge:typeof window.host,hasNode:typeof require,text:document.body.innerText.slice(0,160)})');
      const menu = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/'));
      const child = menu.contentView.children.find((c) => c.webContents?.id === player.id);
      if (!child || !child.getVisible()) throw new Error('Music view state: ' + JSON.stringify({ children: menu.contentView.children.map((c) => ({ id: c.webContents?.id, visible: c.getVisible() })), player: player.id, host: await menu.webContents.executeJavaScript('({tab:document.querySelector("[data-tab].active")?.dataset.tab,loading:document.getElementById("music-loading").hidden,status:document.getElementById("status").textContent})') }));
      details.bounds = child.getBounds();
      details.screenshot = (await player.capturePage()).toPNG().toString('base64');
      // A persistent cookie verifies that authentication has a disk-backed session.
      await player.session.cookies.set({ url: 'https://music.yandex.ru', name: 'capri_test_session', value: 'retained', expirationDate: Math.floor(Date.now() / 1000) + 600 });
      await player.session.cookies.flushStore();
      return details;
    });
    fs.writeFileSync(path.join(root, 'captures/music-embedded.png'), Buffer.from(musicInfo.screenshot, 'base64'));
    delete musicInfo.screenshot;
    assert.equal(musicInfo.filter, 'grayscale(1)');
    assert.ok(musicInfo.text.length > 50, 'the real player must render content');
    assert.equal(musicInfo.hasHostBridge, 'undefined');
    assert.equal(musicInfo.hasNode, 'undefined');
    assert.ok(musicInfo.bounds.height > 100 && musicInfo.bounds.y > 120);
    const beforeExpand = await menu.evaluate(() => innerWidth);
    await menu.locator('#music-expand').click();
    await menu.waitForFunction((width) => innerWidth !== width, beforeExpand);
    await menu.locator('[data-tab="apps"]').click();
    await menu.waitForTimeout(100);
    await application.evaluate(({ BrowserWindow }) => {
      const menu = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/'));
      if (menu.contentView.children.some((c) => c.webContents && c.getVisible())) throw new Error('Music view covers another tab');
    });
    await menu.locator('[data-tab="music"]').click();
    console.log('Embedded player:', JSON.stringify(musicInfo));
    assert.deepEqual(errors, [], 'renderer errors');
    await application.close();
    application = await _electron.launch({ executablePath, args: launchArgs, cwd: root,
      env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    await application.firstWindow();
    const cookies = await application.evaluate(async ({ session }) => session.fromPartition('persist:capri-yandex-music').cookies.get({ name: 'capri_test_session' }));
    assert.equal(cookies[0]?.value, 'retained', 'music login session must survive an app restart');
    const reopened = application.waitForEvent('window');
    await (await application.firstWindow()).evaluate(() => window.host.openMenu());
    const reopenedMenu = await reopened;
    await reopenedMenu.locator('[data-tab="vpn"]').click();
    const reloadedVpn = await reopenedMenu.evaluate(() => window.launcher.vpn.getStatus());
    assert.deepEqual(reloadedVpn.state.favorites, ['Fixture'], 'favorites must survive a real app restart');
    assert.deepEqual(reloadedVpn.state.settings.bypassSites, ['example.com'], 'site exceptions must survive a real app restart');
    console.log('UI passed: launcher, context menus, icons, minimize/restore, VPN IPC, real DPAPI profile import, real unprivileged core start/stop, skins and isolated music. Administrator TUN NOT exercised.');
  } finally {
    if (application) await application.close();
    if (occupied) await new Promise((resolve) => occupied.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
