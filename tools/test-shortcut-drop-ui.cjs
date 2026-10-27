'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-drop-ui-')); let app;
  const desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const errors = [];
  try {
    app = await _electron.launch({ executablePath: process.env.CAPRI_TEST_APP || require('electron'), args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    const overlay = await app.firstWindow(); overlay.on('pageerror', (e) => errors.push(e.message));
    await overlay.waitForTimeout(1500);
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.busy === 'false', null, { timeout: 45000 });
    const sources = [path.join(desktop, 'Roblox.lnk'), path.join(desktop, 'Firefox.url')];
    await app.evaluate(({ app, shell }, { desktop, sources }) => {
      app.setPath('desktop', desktop);
      if (!shell.writeShortcutLink(sources[0], { target: process.execPath, icon: process.execPath, iconIndex: 0 })) throw new Error('Cannot create fixture');

    }, { desktop, sources });
    fs.writeFileSync(sources[1], '[InternetShortcut]\r\nURL=https://example.com\r\n');
    await overlay.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'test-files'; input.hidden = true; document.body.append(input); });
    await overlay.locator('#test-files').setInputFiles(sources);
    async function drop(outside = false) {
      return overlay.evaluate((outside) => {
        const dt = new DataTransfer(); for (const f of document.getElementById('test-files').files) dt.items.add(f);
        const sprite = document.getElementById('sprite'), r = sprite.getBoundingClientRect();
        let point = outside ? { x: 1, y: 1 } : null;
        if (!point) {
          for (let y = r.top; y < r.bottom && !point; y += 4) for (let x = r.left; x < r.right; x += 4) {
            window.dispatchEvent(new DragEvent('dragover', { cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
            if (document.getElementById('capri').classList.contains('shortcut-hover')) { point = { x, y }; break; }
          }
        }
        if (!point) throw new Error('No visible mascot drop target: ' + JSON.stringify({rect:r.toJSON(), types:[...dt.types], pose:sprite.dataset.pose, root:document.getElementById('capri').outerHTML.slice(0,350)}));
        window.dispatchEvent(new DragEvent('drop', { cancelable: true, dataTransfer: dt, clientX: point.x, clientY: point.y }));
        return point;
      }, outside);
    }
    await drop(true); await overlay.waitForTimeout(150);
    assert.equal(app.windows().length, 1, 'outside silhouette does not open import');
    console.log('drop target', await drop());
    let menu; for (let i = 0; i < 100; i++) { menu = app.windows().find((p) => p !== overlay); if (menu) break; await overlay.waitForTimeout(100); }
    assert.ok(menu, 'Drop must open launcher');
    menu.on('pageerror', (e) => errors.push(e.message));
    await menu.locator('#drop-assistant:not([hidden])').waitFor();
    assert.deepEqual(await menu.locator('#drop-items select').evaluateAll((xs) => xs.map((x) => x.value)), ['games', 'internet']);
    assert.ok(sources.every(fs.existsSync), 'drop alone must not move shortcuts');
    let state = await menu.evaluate(() => window.launcher.state());
    assert.equal(state.state.entries.length, 0); assert.ok(state.pendingDrop.items.every((i) => !i.file && !i.source));
    await menu.screenshot({ path: path.join(root, 'captures/drop-assistant.png') });
    await menu.locator('#drop-cancel').click(); await menu.locator('#drop-assistant').waitFor({ state: 'hidden' });
    assert.ok(sources.every(fs.existsSync));
    await menu.evaluate(() => window.launcher.close()); await drop();
    await menu.locator('#drop-assistant:not([hidden])').waitFor();
    await menu.locator('#drop-items select').first().selectOption('work');
    const pendingId = (await menu.evaluate(() => window.launcher.state())).pendingDrop.id;
    await menu.locator('#drop-confirm').click(); await menu.locator('#drop-assistant').waitFor({ state: 'hidden' });
    await menu.locator('.entry-launch').first().waitFor();
    state = await menu.evaluate(() => window.launcher.state());
    assert.equal(state.state.entries.length, 2); assert.equal(state.pendingDrop, null);
    assert.equal(state.state.entries.find((e) => e.name === 'Roblox').category, 'work');
    assert.ok(state.state.entries.find((e) => e.name === 'Roblox').icon.startsWith('data:image/'));
    assert.ok(sources.every((f) => !fs.existsSync(f)));
    const duplicate = await menu.evaluate((id) => window.launcher.confirmDrop(id, []), pendingId); assert.equal(duplicate.ok, false);
    for (const e of state.state.entries) assert.equal((await menu.evaluate((id) => window.launcher.restore(id), e.id)).ok, true);
    assert.ok(sources.every(fs.existsSync));
    // Closing the menu is another cancellation and cannot transfer files on a later reopen.
    await menu.evaluate(() => window.launcher.close()); await drop();
    await menu.locator('#drop-assistant:not([hidden])').waitFor(); await menu.locator('#close').click();
    await overlay.evaluate(() => window.host.openMenu()); await menu.locator('#drop-assistant').waitFor({ state: 'hidden' });
    assert.ok(sources.every(fs.existsSync)); assert.deepEqual(errors, []);
    console.log('DROP UI PASS: real Electron File paths, silhouette hit testing, multi-file category suggestions, cancellation/close, selected category, durable desktop transfer, icons, restore and duplicate confirmation. DragEvents injected; physical Explorer OLE gesture not exercised.');
  } catch (e) {
    if (app) { const m = app.windows().find((p) => p.url().includes('/launcher/')); if (m) console.log('failure diagnostics', await m.evaluate(async () => ({ status: document.getElementById('status').textContent, busy: document.body.getAttribute('aria-busy'), state: await window.launcher.state() }))); }
    throw e;
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
