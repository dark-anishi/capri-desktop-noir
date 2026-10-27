'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const { LauncherStore } = require('../src/main/launcher-store');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-library-ui-'));
  const desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const store = new LauncherStore(path.join(temp, 'launcher'), [desktop]);
  const entries = ['A', 'B', 'C'].map((name) => {
    const file = path.join(temp, name + '.url'); fs.writeFileSync(file, '[InternetShortcut]\r\nURL=https://example.invalid/\r\n');
    return store.importOne(file, 'games').entry;
  });
  store.recordLaunch(entries[1].id); store.recordLaunch(entries[0].id);
  const folder = path.join(desktop, 'Documents'), secondFolder = path.join(temp, 'Photos');
  fs.mkdirSync(folder); fs.mkdirSync(secondFolder); fs.writeFileSync(path.join(folder, 'safe.txt'), 'untouched');
  const shortcut = path.join(desktop, 'My Photos.lnk');
  let app; const errors = [];
  async function start() {
    app = await _electron.launch({ executablePath: process.env.CAPRI_TEST_APP || require('electron'), args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47831' } });
    app.on('window', (page) => page.on('pageerror', (e) => errors.push(e.message)));
    const overlay = await app.firstWindow(); await overlay.waitForFunction(() => Boolean(window.host));
    await app.evaluate(({ app, shell, dialog }, { desktop, folder }) => {
      app.setPath('desktop', desktop); global.folderOpenCalls = [];
      shell.openPath = async (file) => { global.folderOpenCalls.push(file); return ''; };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, { desktop, folder });
    const opened = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openMenu()); const menu = await opened;
    await menu.locator('[data-category="games"]').waitFor();
    return { overlay, menu };
  }
  async function drop(page, selector, type, id, right = false) {
    await page.locator(selector).evaluate((element, { type, id, right }) => {
      const rect = element.getBoundingClientRect(), data = new DataTransfer(); data.setData(type, id);
      element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + (right ? rect.width - 2 : 2), clientY: rect.top + 10 }));
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + (right ? rect.width - 2 : 2), clientY: rect.top + 10 }));
    }, { type, id, right });
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
  }
  const captions = (menu, parent = '#entries') => menu.locator(`${parent} .entry-launch strong`).allTextContents();
  try {
    let { overlay, menu } = await start();
    await menu.locator('[data-category="games"]').click();
    await drop(menu, `#entries [data-id="${entries[0].id}"]`, 'application/x-capri-id', entries[2].id);
    assert.deepEqual(await captions(menu), ['C', 'A', 'B']);
    await menu.locator('[data-category="recent-games"]').click();
    assert.deepEqual(await captions(menu), ['A', 'B']);
    await drop(menu, `#entries [data-id="${entries[0].id}"]`, 'application/x-capri-id', entries[1].id);
    assert.deepEqual(await captions(menu), ['A', 'B']);
    await drop(menu, '[data-category="work"]', 'application/x-capri-id', entries[2].id);
    await menu.locator('[data-category="work"]').click(); assert.deepEqual(await captions(menu), ['C']);
    await menu.locator('[data-tab="folders"]').click();
    await menu.locator('#add-folders').click();
    await menu.waitForFunction(() => document.querySelectorAll('#folder-entries .entry').length === 1);
    await app.evaluate(({ shell }, { shortcut, secondFolder }) => {
      if (!shell.writeShortcutLink(shortcut, { target: secondFolder })) throw new Error('Cannot create fixture folder shortcut');
    }, { shortcut, secondFolder });
    await menu.evaluate(() => { const input = document.createElement('input'); input.id = 'fixture-file'; input.type = 'file'; input.hidden = true; document.body.append(input); });
    await menu.locator('#fixture-file').setInputFiles(shortcut);
    await menu.locator('#fixture-file').evaluate((input) => {
      const data = new DataTransfer(); data.items.add(input.files[0]);
      document.querySelector('.folder-library').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await menu.waitForFunction(() => document.querySelectorAll('#folder-entries .entry').length === 2 && !document.body.hasAttribute('aria-busy'));
    assert.deepEqual(await captions(menu, '#folder-entries'), ['Documents', 'My Photos']);
    const folders = (await menu.evaluate(() => window.launcher.state())).state.folders;
    assert.ok(folders.every((item) => item.icon.startsWith('data:image/')));
    assert.ok(folders.every((item) => !('source' in item) && !('target' in item)));
    await drop(menu, `#folder-entries [data-id="${folders[0].id}"]`, 'application/x-capri-folder-id', folders[1].id);
    assert.deepEqual(await captions(menu, '#folder-entries'), ['My Photos', 'Documents']);
    await menu.locator('#folder-entries .entry-launch').filter({ hasText: 'My Photos' }).click();
    await menu.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.deepEqual(await app.evaluate(() => global.folderOpenCalls), [secondFolder]);
    await overlay.evaluate(() => window.host.openMenu());
    await menu.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    await app.close(); app = null;
    ({ overlay, menu } = await start());
    await menu.locator('[data-category="all"]').click(); assert.deepEqual(await captions(menu), ['C', 'A', 'B']);
    await menu.locator('[data-tab="folders"]').click(); assert.deepEqual(await captions(menu, '#folder-entries'), ['My Photos', 'Documents']);
    await menu.locator('#folder-entries .entry').filter({ hasText: 'Documents' }).click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Убрать из меню' }).click();
    await menu.waitForFunction(() => document.querySelectorAll('#folder-entries .entry').length === 1);
    assert.equal(fs.readFileSync(path.join(folder, 'safe.txt'), 'utf8'), 'untouched'); assert.ok(fs.existsSync(shortcut));
    await menu.screenshot({ path: path.join(root, 'captures/folders.png') });
    assert.deepEqual(errors, []);
    console.log('LIBRARY FOLDERS UI PASS: application drag reorder/category moves/recent chronology, directory chooser and real .lnk drop, native icons, folder reorder/open/remove, no source deletion, restart persistence, no renderer errors. Explorer opens stubbed; fixtures isolated.');
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
