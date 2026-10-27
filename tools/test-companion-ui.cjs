'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), executablePath = process.env.CAPRI_TEST_APP || require('electron');
function tone() {
  const samples = 16000 * 2, out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 16000) * 1000), 44 + i * 2);
  return out.toString('base64');
}
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-companion-ui-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const errors = [];
  try {
    app = await _electron.launch({ executablePath, args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    const overlay = await app.firstWindow(); overlay.on('pageerror', (e) => errors.push(e.message));
    // Route only the initial player URL to a local fixture before navigation starts.
    // This avoids overlapping loadURL promises and any dependency on the live site.
    await app.evaluate(({ BrowserWindow }) => {
      const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents), load = proto.loadURL;
      proto.loadURL = function(url, options) { return load.call(this, url === 'https://music.yandex.ru/' ? 'data:text/html,<body><audio id="fixture" loop></audio></body>' : url, options); };
    });
    async function quickView() {
      const visible = await app.evaluate(({ BrowserWindow }) => Boolean(BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/quick/'))?.isVisible()));
      if (!visible) await overlay.evaluate(() => window.host.openQuickMenu());
      let page;
      for (let i = 0; i < 100; i++) { page = app.windows().find((p) => p.url().includes('/quick/')); if (page) break; await overlay.waitForTimeout(50); }
      if (!page) throw new Error('Quick window not created');
      await page.locator('#quick-rest').waitFor(); return page;
    }
    async function quickItem(id) {
      const page = await quickView(), button = page.locator('#' + id); const label = await button.textContent(); await button.click(); return label;
    }
    async function quickState(id) {
      const page = await quickView();
      return page.locator('#' + id).evaluate((item) => ({ label: item.textContent, checked: item.getAttribute('aria-pressed') === 'true', enabled: !item.disabled }));
    }

    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'original');
    const ownerId = await app.evaluate(async ({ BrowserWindow }) => {
      const win = new BrowserWindow({ width: 700, height: 330, x: 320, y: 370, alwaysOnTop: true, title: 'Capri companion acceptance', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      await win.loadURL('data:text/html,<body style="background:%23262626;color:white">Capri companion test window</body>'); win.show(); win.focus(); global.companionOwner = win;
      const h = win.getNativeWindowHandle(); return Number(h.length >= 8 ? h.readBigUInt64LE() : h.readUInt32LE());
    });
    await overlay.waitForFunction(async (id) => (await window.host.windowsNow())?.wins.some((w) => w.id === id), ownerId, { timeout: 20000 });
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.busy === 'false', null, { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/renderer/')).webContents.send('capri:command', { name: 'act', act: 'sit', pile: 0 }));
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'seated' && document.getElementById('sprite').dataset.busy === 'false', null, { timeout: 20000 });
    await app.evaluate(() => global.companionOwner.setAlwaysOnTop(false));
    const popup = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openMenu()); let menu = await popup;
    assert.equal(await menu.locator('#pin-window, #pet-rest').count(), 0);
    await quickItem('quick-pin');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pinned === 'true' && document.getElementById('sprite').dataset.busy === 'false' && document.getElementById('sprite').dataset.pose === 'seated');
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/renderer/')).webContents;
      wc.send('capri:command', { name: 'act', act: 'endAct', args: [false] });
      wc.send('capri:command', { name: 'act', act: 'gaze', args: [{ big: false }] });
    });
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'gazeSeated');
    await overlay.locator('#capri').screenshot({ path: path.join(root, 'captures/noir-gaze-seated.png'), omitBackground: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/renderer/')).webContents.send('capri:command', { name: 'act', act: 'endAct', args: [false] }));
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'seated');
    const before = await overlay.locator('#capri').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
    await app.evaluate(() => { const w = global.companionOwner, [x, y] = w.getPosition(); w.setPosition(x + 60, y + 20); });
    await overlay.waitForFunction((x) => Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('capri')).transform).m41 - x - 60) < 3, before, { timeout: 8000 });
    await overlay.evaluate(() => window.host.openMenu());
    assert.equal((await quickState('quick-pin')).checked, true);
    await quickItem('quick-rest');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'sleepSeated');
    await overlay.evaluate(() => window.host.openMenu());
    await overlay.waitForTimeout(250);
    assert.equal(await overlay.locator('#sprite').getAttribute('data-pose'), 'sleepSeated', 'opening the menu must not wake the character');
    await menu.screenshot({ path: path.join(root, 'captures/companion-controls.png') });
    assert.equal((await quickState('quick-rest')).label, 'Проснуться'); await quickItem('quick-rest');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'seated');
    await overlay.evaluate(() => window.host.openMenu()); await menu.locator('[data-tab="music"]').click();
    await app.evaluate(async ({ BrowserWindow }, wav) => {
      const owner = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/'));
      let player; for (let i = 0; i < 100; i++) { player = owner.contentView.children.find((v) => v.webContents)?.webContents; if (player) break; await new Promise((r) => setTimeout(r, 30)); }
      if (!player) throw new Error('Music view was not created');
      // The initial navigation already loaded the fixture.
      global.companionPlayer = player;
      await player.executeJavaScript(`(()=>{const a=document.getElementById('fixture');a.src='data:audio/wav;base64,${wav}';a.volume=.001;return a.play()})()`, true);
    }, tone());
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'musicSeated', null, { timeout: 10000 });
    await menu.evaluate(() => window.launcher.close());
    await overlay.waitForTimeout(400); assert.equal(await overlay.locator('#sprite').getAttribute('data-pose'), 'musicSeated');
    await quickItem('quick-music-toggle');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'seated', null, { timeout: 10000 });
    await quickItem('quick-music-toggle');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'musicSeated', null, { timeout: 10000 });
    assert.equal((await quickState('quick-rest')).enabled, true, 'manual sleep stays available while music plays');
    await quickItem('quick-rest');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'sleepSeated');
    await app.evaluate(async () => global.companionPlayer.executeJavaScript("document.getElementById('fixture').pause(); document.getElementById('fixture').play()", true));
    await overlay.waitForTimeout(600);
    assert.equal(await overlay.locator('#sprite').getAttribute('data-pose'), 'sleepSeated', 'music events must not undo manual rest');
    assert.equal((await quickState('quick-rest')).label, 'Проснуться'); await quickItem('quick-rest');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'musicSeated', null, { timeout: 10000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/')).destroy());
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'seated', null, { timeout: 10000 });
    const reopened = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openMenu()); menu = await reopened;
    await quickItem('quick-pin');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pinned === 'false');
    await overlay.evaluate(() => window.host.openMenu()); await quickItem('quick-pin');
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pinned === 'true');
    const invalid = await menu.evaluate(() => window.launcher.pinWindow('not-a-boolean')); assert.equal(invalid.ok, false);
    await app.evaluate(() => global.companionOwner.destroy());
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pinned === 'false');
    assert.deepEqual(errors, []);
    console.log('COMPANION UI PASS: actual menu pin/rest/wake IPC, native window following and closure, real HTML audio play/pause, playback while menu hidden, automatic wake, and player-destruction cleanup. Yandex account/playback not exercised.');
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
