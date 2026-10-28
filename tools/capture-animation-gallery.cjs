'use strict';
// Record the existing renderer in an isolated packaged app. The neutral stage is
// a documentation fixture, not the user's desktop or installed app session.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const output = path.join(root, 'docs', 'animations', version);
const reactions = process.argv.includes('--reactions');
const python = process.env.CAPRI_PYTHON || 'python';
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-animation-gallery-'));
  let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru', scale: 1 }));
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'dist/win-unpacked/Capri.exe'), args: ['--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47834' } });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.getElementById('sprite')?.dataset.pose === 'original');
    await page.waitForTimeout(4800);
    await page.evaluate(async () => {
      const { Capri } = await import('./js/capri.js');
      const draw = Capri.prototype.drawFrame;
      Capri.prototype.drawFrame = function (...args) { window.galleryPet = this; return draw.apply(this, args); };
    });
    await page.waitForFunction(() => Boolean(window.galleryPet));
    await page.evaluate(() => {
      for (const rule of [
        'html,body{background:#3d3d3d!important}',
        '#chip,#mask,#fx,#ticker,#panel{display:none!important}',
        '#gallery-ledge{position:absolute;left:200px;top:440px;width:600px;height:234px;background:#222;border:1px solid #737373;z-index:0}',
        '#gallery-ledge::before{content:"";display:block;height:30px;border-bottom:1px solid #4f4f4f;background:#292929}',
        '#gallery-ledge[hidden]{display:none!important}',
      ]) document.styleSheets[0].insertRule(rule, document.styleSheets[0].cssRules.length);
      const c = galleryPet;
      c.setWindows = () => {}; c.behave = () => {};
      c.wander = c.possessWindows = false;
      c.view = { w: 960, h: 720 }; c.endAct(false); c.unpinWindow(); c.pointing = null;
      c.busy = c.hidden = c.stowed = c.dormant = false;
      c.root.hidden = false; c.root.style.visibility = ''; c.fx.items = [];
      const ledge = document.createElement('div'); ledge.id = 'gallery-ledge'; document.body.prepend(ledge);
    });
    fs.mkdirSync(output, { recursive: true });
    const clips = reactions ? [
      ['acknowledge', 'original'], ['shrug', 'original'], ['stretch', 'original'],
      ['unwind', 'seated'], ['settle', 'seated'],
    ] : [
      ['seated', 'seated'], ['music', 'musicSeated'], ['sleep', 'sleepLying'],
      ['gaze', 'gazeSeated'], ['thinking', 'thinking'], ['wave', 'wave'],
    ];
    for (const [name, expected] of clips) {
      await page.evaluate(name => {
        const c = galleryPet;
        c.endAct(false); c.wake(); c.setMusicPlaying(false); c.setMode('idle'); c.setStance('stand');
        c.pos = { x: 480, y: 610 }; c.facing = 1; c.p.alpha = 1;
        const seated = ['seated', 'music', 'gaze', 'unwind', 'settle'].includes(name);
        document.getElementById('gallery-ledge').hidden = !seated;
        if (seated) {
          const win = { id: -611, x: 200, y: 440, w: 600, h: 234, max: false };
          c.windows = { fg: win.id, wins: [win] };
          c.pos = c.seat(win, 280); c.setStance('sit', { perch: { id: win.id, dx: 280 } });
        }
        if (name === 'music') c.setMusicPlaying(true);
        if (name === 'sleep') { c.pos.y = 575; c.rest(); }
        if (name === 'thinking') c.setMode('alert');
        if (['gaze', 'wave', 'acknowledge', 'shrug', 'stretch', 'unwind', 'settle'].includes(name)) void c.perform(name);
        c.drawFrame();
      }, name);
      await page.waitForFunction(expected => document.getElementById('sprite').dataset.pose === expected, expected);
      const frames = path.join(temp, name); fs.mkdirSync(frames);
      const poses = new Set();
      for (let i = 0; i < 40; i++) {
        const started = Date.now();
        // Repeat a gesture only when its real exposure sheet has completed.
        if (['gaze', 'wave', 'acknowledge', 'shrug', 'stretch', 'unwind', 'settle'].includes(name)) await page.evaluate(name => { if (!galleryPet.act) void galleryPet.perform(name); }, name);
        poses.add(await page.locator('#sprite').getAttribute('data-pose'));
        await page.screenshot({ path: path.join(frames, String(i).padStart(3, '0') + '.png'), clip: { x: 0, y: 0, width: 960, height: 720 }, animations: 'allow' });
        await page.waitForTimeout(Math.max(1, 100 - (Date.now() - started)));
      }
      const encoded = spawnSync(python, [path.join(__dirname, 'encode-animation-gallery.py'), frames, path.join(output, name + '.gif')], { encoding: 'utf8', windowsHide: true });
      if (encoded.status !== 0) throw new Error(encoded.stderr || 'GIF encoding failed');
      console.log(JSON.stringify({ animation: name, frames: 40, poses: [...poses], bytes: fs.statSync(path.join(output, name + '.gif')).size }));
    }
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'capri-animation-gallery-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
