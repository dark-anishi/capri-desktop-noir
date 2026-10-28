'use strict';
// Real Electron visibility/audio/IPC with a controlled watcher. No real game,
// subscriptions, elevated helpers or user's installed Capri are touched.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-game-ui-')); let app;
  const file = path.join(temp, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ welcomed: true, linked: true, muted: false, volume: .35, visible: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const bootstrap = path.join(temp, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `
    const {globalShortcut}=require('electron'); const register=globalShortcut.register.bind(globalShortcut);
    globalShortcut.register=(key,fn)=>{if(key==='Control+Alt+C')global.gameHotkey=fn;return register(key,fn);};
    require(${JSON.stringify(path.join(root, 'src/main/windows.js'))}).startWindowWatch = ({onUpdate}) => {
      global.gameFixture = (active,gameDisplay=null) => onUpdate({fg:active?99:0,wins:[],gameMode:active,gameDisplay}); return {stop(){}};
    };
    require(${JSON.stringify(path.join(root, 'src/main/main.js'))});
  `);
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47837' } });
    let page = await app.firstWindow();
    await page.waitForFunction(() => document.getElementById('sprite')?.dataset.pose === 'original');
    await page.waitForTimeout(4800);
    const capturePet = async () => {
      await page.evaluate(async () => { const { Capri } = await import('./js/capri.js'); const draw = Capri.prototype.drawFrame; Capri.prototype.drawFrame = function (...args) { window.gameTestPet = this; return draw.apply(this, args); }; });
      await page.waitForFunction(() => Boolean(window.gameTestPet));
    };
    await capturePet();
    await page.evaluate(() => gameTestPet.rest());
    const opened = app.waitForEvent('window'); await page.evaluate(() => window.host.openQuickMenu()); const quick = await opened;
    await quick.locator('#quick-rest').waitFor();
    const snapshot = () => app.evaluate(({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/'));
      const quick = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/quick/'));
      return { visible: overlay.isVisible(), muted: overlay.webContents.isAudioMuted(), quickVisible: Boolean(quick?.isVisible()), focused: overlay.isFocused() };
    });
    const originalConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
    await app.evaluate(() => global.gameFixture(true));
    assert.deepEqual(await snapshot(), { visible: false, muted: true, quickVisible: false, focused: false });
    await page.waitForFunction(() => gameTestPet.gameMode === true);
    assert.equal(await page.evaluate(() => gameTestPet.manualRest), true);
    assert.equal(await page.evaluate(() => window.host.getConfig().then(cfg => cfg.gameMode)), true);
    await page.evaluate(() => window.host.openQuickMenu());
    assert.equal((await snapshot()).quickVisible, false);
    await app.evaluate(() => global.gameHotkey());
    await page.waitForFunction(() => gameTestPet.gameMode === false && gameTestPet.gameQuiet === true);
    assert.equal((await snapshot()).visible, true); assert.equal((await snapshot()).muted, true);
    await app.evaluate(() => global.gameFixture(true));
    assert.equal((await snapshot()).visible, true, 'repeated watcher ticks must not undo manual reveal');
    await app.evaluate(() => global.gameHotkey());
    assert.equal((await snapshot()).visible, false);
    await app.evaluate(() => global.gameFixture(true));
    await app.evaluate(() => global.gameFixture(false));
    await page.waitForFunction(() => gameTestPet.gameMode === false);
    assert.deepEqual(await snapshot(), { visible: true, muted: false, quickVisible: false, focused: false });
    assert.equal(await page.evaluate(() => gameTestPet.manualRest), true);
    for (const [key,value] of Object.entries(originalConfig)) assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8'))[key], value, 'game mode must preserve preference '+key);
    await app.evaluate(() => global.gameFixture(true));
    await page.reload(); await page.waitForFunction(() => Boolean(window.host));
    await capturePet();
    await page.waitForFunction(() => gameTestPet.gameMode === true);
    assert.equal((await snapshot()).visible, false); assert.equal((await snapshot()).muted, true);
    await page.evaluate(() => window.host.setConfig({ muted: true, volume: .2 }));
    await app.evaluate(() => global.gameFixture(false));
    await page.waitForFunction(() => gameTestPet.gameMode === false);
    const saved = await page.evaluate(() => window.host.getConfig());
    assert.equal(saved.muted, true); assert.equal(saved.volume, .2); assert.equal(saved.visible, true);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')), 'gameMode'), false);
    await app.evaluate(({screen}) => { const b=screen.getPrimaryDisplay().bounds;global.gameFixture(true,{x:b.x+b.width+100,y:b.y,width:b.width,height:b.height}); });
    await page.waitForFunction(() => gameTestPet.gameMode === false && gameTestPet.gameQuiet === true);
    assert.equal((await snapshot()).visible, true, 'a game on another monitor must not hide Capri');
    assert.equal((await snapshot()).muted, true);
    await app.evaluate(() => global.gameFixture(false));
    console.log('GAME MODE UI PASS: real Electron hides/restores overlay without focus, mutes WebContents, closes and blocks quick menu, keeps manual rest/preferences, and remains hidden and quiet across renderer reload. Watcher snapshots are fixtures; no real game or networking.');
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-game-ui-'))); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
