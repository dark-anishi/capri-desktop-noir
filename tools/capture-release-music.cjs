'use strict';
// Opens a fresh guest session for an OS-level capture of Capri's native child
// WebContentsView. No user profile/account is read and the UI is not replaced.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-music-capture-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'dist/win-unpacked/Capri.exe'), args: ['--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47830' } });
    const overlay = await app.firstWindow(); await overlay.waitForFunction(() => Boolean(window.host));
    const opened = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openMenu()); const menu = await opened;
    await menu.locator('[data-tab="music"]').click();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/launcher/'));
      win.setTitle('Capri 0.6.11 — Screenshot Music');
    });
    await menu.waitForTimeout(12000);
    console.log('READY: capture only the window titled Capri 0.6.11 — Screenshot Music; send newline to close.');
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
      process.stdin.once('end', resolve);
      process.stdin.resume();
    });
  } finally {
    if (app) await app.close();
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'capri-music-capture-')) throw new Error('Unexpected capture temp path');
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
