'use strict';
// Fresh release screenshots from the packaged renderer. The gray stage and window
// edge are capture-only scenery; character, animation, speech and Zzz are Capri's.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const version = '0.6.11';
const output = path.join(root, 'docs', 'screenshots', version);
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-release-poses-'));
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru', scale: 1 }));
  let app; const errors = [];
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'dist', 'win-unpacked', 'Capri.exe'), args: ['--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47832' } });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    const page = (await app.windows()).find(p => p.url().includes('/renderer/')) || await app.firstWindow();
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => document.getElementById('sprite')?.dataset.pose === 'original');
    await page.waitForTimeout(4800); // finish the real startup intro before staging poses
    await page.evaluate(async () => {
      const [{ Capri }, { Panel }] = await Promise.all([import('./js/capri.js'), import('./js/panel.js')]);
      const draw = Capri.prototype.drawFrame, anchor = Panel.prototype.setAnchor;
      Capri.prototype.drawFrame = function (...args) { window.releasePet = this; return draw.apply(this, args); };
      Panel.prototype.setAnchor = function (...args) { window.releasePanel = this; return anchor.apply(this, args); };
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/')).webContents.send('capri:command', { name: 'pose', hush: true, still: true, scale: 1, at: { x: 480, y: 610 }, stance: 'stand' }));
    await page.waitForFunction(() => window.releasePet && window.releasePanel);
    await page.evaluate(css => { for (const rule of css.split('}').filter(Boolean)) document.styleSheets[0].insertRule(rule + '}', document.styleSheets[0].cssRules.length); }, `html,body{background:#3d3d3d!important} #chip,#mask,#fx,#ticker{display:none!important} #capture-ledge{position:absolute;left:200px;top:440px;width:600px;height:234px;background:#222;border:1px solid #737373;z-index:0;} #capture-ledge::before{content:'';display:block;height:30px;border-bottom:1px solid #4f4f4f;background:#292929;} #capture-ledge[hidden]{display:none!important}`);
    await page.evaluate(() => {
      const c = window.releasePet, p = window.releasePanel;
      c.setWindows = () => {}; // the capture stage never follows the user's desktop
      c.wander = c.possessWindows = false; c.nextMove = c.nextGaze = c.nextTwitch = c.nextShed = c.nextNotice = Infinity;
      c.view = { w: 960, h: 720 }; c.endAct(false); c.unpinWindow(); c.pointing = null;
      c.busy = c.hidden = c.stowed = c.dormant = false; c.root.hidden = false; c.root.style.visibility = '';
      c.p.alpha = 1; c.fx.items = []; p.hide(); p.setTicker(null); p.resume();
      const ledge = document.createElement('div'); ledge.id = 'capture-ledge'; ledge.hidden = true; document.body.prepend(ledge);
    });
    fs.mkdirSync(output, { recursive: true });
    const captures = [];
    const capture = async (name, expected) => {
      await page.waitForFunction(value => document.getElementById('sprite').dataset.pose === value, expected);
      await page.waitForTimeout(420); // several actual GPU animation frames, not an unrendered bitmap
      const state = await page.evaluate(() => ({ pose: releasePet.sprite.poseName || 'original', mode: releasePet.mode, stance: releasePet.stance, zzz: !releasePet.zzz.hidden, side: document.getElementById('panel').dataset.side, asset: releasePet.sprite.poseName || 'capri-full.svg' }));
      const file = path.join(output, `pet-${name}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 960, height: 720 }, animations: 'allow' });
      captures.push({ file: path.relative(root, file).replaceAll('\\', '/'), ...state });
    };
    await page.evaluate(() => { const c = releasePet; c.wake(); c.setMusicPlaying(false); c.setStance('stand'); c.pos = { x: 480, y: 610 }; c.facing = 1; c.drawFrame(); });
    await capture('standing', 'original');
    await page.evaluate(async () => {
      const c = releasePet; const win = { id: -611, x: 200, y: 440, w: 600, h: 234, max: false };
      c.windows = { fg: win.id, wins: [win] }; c.pos = c.seat(win, 220); c.setStance('sit', { perch: { id: win.id, dx: 220 } }); c.drawFrame();
      document.getElementById('capture-ledge').hidden = false;
      const { LINES } = await import('./js/lines.js'); releasePanel.say({ kind: 'idle', line: LINES.ru.idle[2], hold: null, face: 'grin' });
    });
    await page.waitForTimeout(1250); // finish the actual speech decoder
    await capture('seated', 'seated');
    await page.evaluate(() => {
      const c = releasePet; releasePanel.hide(); c.endAct(false); c.setStance('stand'); c.pos = { x: 480, y: 575 }; document.getElementById('capture-ledge').hidden = true; c.rest(); c.drawFrame();
    });
    await capture('sleep', 'sleepLying');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ version, capturedAt: new Date().toISOString(), executable: 'dist/win-unpacked/Capri.exe', captures }, null, 2));
  } finally {
    if (app) await app.close();
    const resolved = path.resolve(temp); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
