'use strict';
// Actual Electron renderer + IPC, fixture manager launcher. Never executes Zapret or UAC.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-zapret-ui-')); let app;
  const folder = path.join(temp, 'Zapret & (fixture)'), errors = [];
  fs.mkdirSync(path.join(folder, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'bin', 'winws.exe'), 'NOT EXECUTABLE: UI FIXTURE');
  for (const bat of ['general.bat', 'general (ALT2).bat']) fs.writeFileSync(path.join(folder, bat), '@rem fixture bin\\winws.exe');
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const bootstrap = path.join(temp, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `
    const zapretModule = require(${JSON.stringify(path.join(root, 'src/main/zapret.js'))});
    const original = zapretModule.createZapret;
    global.zapretTest = { calls: [], pickers: 0, cancel: false, fail: false };
    zapretModule.createZapret = (options) => {
      const manager = original({ ...options, dialog: { async showOpenDialog() {
        global.zapretTest.pickers++; return global.zapretTest.cancel ? { canceled:true } : { filePaths:[${JSON.stringify(folder)}] };
      } }, launcher(_app, spec, exit) {
        global.zapretTest.calls.push(['start', spec.batch]);
        return { started: global.zapretTest.fail ? Promise.reject(new Error('UAC cancelled fixture')) : Promise.resolve(), async stop() { global.zapretTest.calls.push(['stop']); exit(''); } };
      } });
      global.zapretTest.manager = manager; return manager;
    };
    require(${JSON.stringify(path.join(root, 'src/main/main.js'))});
  `);
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47832' } });
    const overlay = await app.firstWindow(); overlay.on('pageerror', (e) => errors.push(e.message));
    await overlay.waitForFunction(() => Boolean(window.host?.openQuickMenu));
    await overlay.evaluate(() => window.host.openQuickMenu());
    let quick;
    for (let i = 0; i < 100; i++) { quick = app.windows().find((p) => p.url().includes('/quick/')); if (quick) break; await overlay.waitForTimeout(50); }
    assert.ok(quick); quick.on('pageerror', (e) => errors.push(e.message));
    await quick.locator('#quick-zapret-toggle').waitFor();
    await quick.locator('#quick-zapret-toggle').click();
    await quick.waitForFunction(() => document.querySelector('#quick-zapret-folder') && !document.querySelector('#quick-zapret-toggle').disabled);
    assert.deepEqual(await app.evaluate(() => [global.zapretTest.pickers, global.zapretTest.calls.length]), [1, 0]);
    await quick.getByText('Стратегии Zapret', { exact: true }).click();
    await quick.locator('[id="quick-zapret-batch:0"]').click();
    await quick.getByRole('button', { name: 'Остановить Zapret', exact: true }).waitFor();
    assert.equal(await quick.locator('#quick-zapret-folder').isDisabled(), true);
    assert.equal(await app.evaluate(() => global.zapretTest.manager.state().runningBat), 'general (ALT2).bat');
    await quick.locator('#quick-zapret-toggle').click();
    await quick.getByRole('button', { name: 'Запустить Zapret', exact: true }).waitFor();
    await quick.locator('#quick-zapret-toggle').click();
    await quick.getByRole('button', { name: 'Остановить Zapret', exact: true }).waitFor();
    assert.deepEqual(await app.evaluate(() => global.zapretTest.calls), [['start', 'general (ALT2).bat'], ['stop'], ['start', 'general (ALT2).bat']]);
    await quick.locator('#quick-zapret-toggle').click();
    await quick.getByRole('button', { name: 'Запустить Zapret', exact: true }).waitFor();
    await app.evaluate(() => { global.zapretTest.fail = true; });
    await quick.locator('#quick-zapret-toggle').click();
    for (let i = 0; i < 100; i++) {
      if ((await app.evaluate(() => global.zapretTest.manager.state().error)).includes('UAC cancelled fixture')) break;
      await overlay.waitForTimeout(50);
    }
    assert.match(await app.evaluate(() => global.zapretTest.manager.state().error), /UAC cancelled fixture/);
    assert.equal(await quick.locator('#error').count(), 0);
    assert.equal(await app.evaluate(() => global.zapretTest.manager.state().lastBat), 'general (ALT2).bat');
    const rejected = await quick.evaluate(async () => {
      const result = [];
      for (const args of [['quick-zapret-batch:0', 'C:\\evil.bat'], ['quick-zapret-batch:9999'], ['quick-zapret-toggle', 'whoami']]) {
        try { await window.quickMenu.action(...args); result.push(false); } catch { result.push(true); }
      }
      return result;
    });
    assert.deepEqual(rejected, [true, true, true]);
    const count = await app.evaluate(() => global.zapretTest.calls.length);
    fs.renameSync(folder, folder + '-moved');
    await app.evaluate(() => { global.zapretTest.cancel = true; global.zapretTest.fail = false; });
    await quick.locator('#quick-zapret-toggle').click();
    await quick.waitForFunction(() => !document.querySelector('#quick-zapret-toggle').disabled);
    assert.deepEqual(await app.evaluate(() => [global.zapretTest.pickers, global.zapretTest.calls.length]), [2, count]);
    assert.deepEqual(errors, []);
    console.log('ZAPRET UI PASS: real quick menu + IPC, folder first use, explicit strategy, stop/start last successful selection, cancelled UAC error, invalid arguments denied, missing folder + picker cancellation. Launcher mocked: no real Zapret/UAC/network changes.');
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-zapret-ui-')));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
