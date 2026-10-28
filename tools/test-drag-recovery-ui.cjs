'use strict';
// Reproduce a skipped/cleared intro using real Electron/WebGL, then drag the
// same Capri instance. Only temporary data and synthetic window geometry.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-drag-recovery-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const bootstrap = path.join(temp, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `require(${JSON.stringify(path.join(root, 'src/main/windows.js'))}).startWindowWatch=({onUpdate})=>{onUpdate({fg:0,wins:[],gameMode:false});return{stop(){}};};require(${JSON.stringify(path.join(root, 'src/main/main.js'))});`);
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47839' } });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.host));
    const proof = await page.evaluate(async () => {
      const [{ Capri }, { FxLayer }, { loadPoseArt }] = await Promise.all([import('./js/capri.js'), import('./js/fx.js'), import('./js/pose-art.js')]);
      const image = async src => { const value = new Image(); value.src = src; await value.decode(); return value; };
      const [sprite, strip, poses] = await Promise.all([image('../../assets/skins/mono/capri-full.svg'), image('../../assets/capri/intro-face.webp'), loadPoseArt('mono', image)]);
      const actor = document.createElement('div'), canvas = document.createElement('canvas'), effects = document.createElement('canvas');
      actor.append(canvas); document.body.append(actor, effects);
      const fx = new FxLayer(effects, { intro: strip, skin: 'mono' }); fx.resize(1280, 900);
      const voice = new Proxy({}, { get: () => () => {} });
      const c = new Capri({ root: actor, canvas, image: sprite, poseImages: poses, fx, voice });
      c.loop = () => {}; c.behave = () => {}; c.nextNotice = Infinity; c.setScale(.8); c.setView(1280, 900);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const intro = c.intro({ x: 640, y: c.floor }, { still: true });
      const initiallyBusy = c.busy, item = fx.items.find(item => item.type === 'intro');
      fx.frame(item.born + item.life + 1000); // Exactly the skipped RAF regression.
      await Promise.race([intro, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Expired intro kept Capri busy')), 6000))]);
      const releasedAfterExpiry = !c.busy;
      c.drawFrame();
      const point = () => {
        for (let y = c.pos.y - 25; y > c.pos.y - 220; y -= 4) for (let x = c.pos.x - 35; x < c.pos.x + 35; x += 4) if (c.hit(x, y)) return { x, y };
        throw new Error('No solid rendered point for dragging');
      };
      const drag = (dx, release) => {
        const p = point(), start = { ...c.pos };
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: p.x, clientY: p.y, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: p.x + dx, clientY: p.y, bubbles: true }));
        const moved = c.dragging && c.pos.x === start.x + dx;
        if (release === 'lost') window.dispatchEvent(new MouseEvent('mousemove', { buttons: 0, clientX: p.x + dx, clientY: p.y, bubbles: true }));
        else window.dispatchEvent(new Event('blur'));
        return { moved, released: !c.dragging };
      };
      const afterExpiry = drag(70, 'lost');
      const cancelledIntro = c.intro({ x: c.pos.x, y: c.floor }, { still: true });
      fx.clear();
      await Promise.race([cancelledIntro, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Cleared intro kept Capri busy')), 6000))]);
      const releasedAfterClear = !c.busy;
      c.endAct(false); c.drawFrame();
      const afterClear = drag(45, 'blur');
      actor.remove(); effects.remove();
      return { initiallyBusy, releasedAfterExpiry, releasedAfterClear, afterExpiry, afterClear, glError: c.sprite.gl.getError() };
    });
    assert.deepEqual(proof, { initiallyBusy: true, releasedAfterExpiry: true, releasedAfterClear: true, afterExpiry: { moved: true, released: true }, afterClear: { moved: true, released: true }, glError: 0 });
    assert.deepEqual(errors, []);
    console.log('DRAG RECOVERY UI PASS:', JSON.stringify(proof));
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-drag-recovery-'))); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
