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
      actor.className = 'capri'; actor.style.zIndex = '10000'; canvas.className = 'capri__sprite'; effects.style.pointerEvents = 'none';
      actor.append(canvas); document.body.append(actor, effects);
      const fx = new FxLayer(effects, { intro: strip, skin: 'mono' }); fx.resize(1280, 900);
      const voice = new Proxy({}, { get: () => () => {} });
      const c = new Capri({ root: actor, canvas, image: sprite, poseImages: poses, fx, voice });
      c.loop = () => {}; c.behave = () => {}; c.nextNotice = Infinity; c.setScale(.8); c.setView(innerWidth, innerHeight);
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
      // Leave the same WebGL character for real Chromium input below.
      c.endAct(false); c.setStance('stand'); c.pos = { x: innerWidth / 2, y: c.floor }; c.drawFrame();
      window.dragFixture = { c, canvas, actor, effects, point, clicks: 0, menus: 0, events: [] };
      c.onClick = () => dragFixture.clicks++; c.onQuickMenu = () => dragFixture.menus++;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'lostpointercapture']) canvas.addEventListener(type, () => dragFixture.events.push(type));
      return { initiallyBusy, releasedAfterExpiry, releasedAfterClear, afterExpiry, afterClear, glError: c.sprite.gl.getError() };
    });
    assert.deepEqual(proof, { initiallyBusy: true, releasedAfterExpiry: true, releasedAfterClear: true, afterExpiry: { moved: true, released: true }, afterClear: { moved: true, released: true }, glError: 0 });
    assert.deepEqual(errors, []);
    console.log('DRAG RECOVERY UI PASS:', JSON.stringify(proof));
    const nativeInput = async (type, point, extra = {}) => app.evaluate(({ BrowserWindow }, event) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/'));
      win.webContents.sendInputEvent(event);
    }, { type, x: Math.round(point.x), y: Math.round(point.y), ...extra });
    for (let i = 0; i < 12; i++) {
      const p = await page.evaluate(() => { dragFixture.c.endAct(false); dragFixture.c.drawFrame(); const p = dragFixture.point(); if (document.elementFromPoint(p.x, p.y) !== dragFixture.canvas) throw new Error('Fixture canvas is not the actual hit target'); return p; });
      await nativeInput('mouseMove', p);
      await nativeInput('mouseDown', p, { button: 'left', clickCount: 1 });
      await page.waitForFunction(() => dragFixture.c.pointerHeld);
      const moved = { x: p.x + 40, y: p.y - 15 };
      await nativeInput('mouseMove', moved, { modifiers: ['leftButtonDown'] });
      await page.waitForFunction(() => dragFixture.c.dragging);
      await nativeInput('mouseUp', moved, { button: 'left', clickCount: 1 });
      await page.waitForFunction(() => !dragFixture.c.pointerHeld && !dragFixture.c.dragging);
      await page.evaluate(() => { dragFixture.c.setStance('stand'); dragFixture.c.pos.y = dragFixture.c.floor; dragFixture.c.drawFrame(); });
      const click = await page.evaluate(() => dragFixture.point());
      await nativeInput('mouseMove', click);
      await nativeInput('mouseDown', click, { button: 'left', clickCount: 1 });
      await nativeInput('mouseUp', click, { button: 'left', clickCount: 1 });
      await page.waitForFunction(count => dragFixture.clicks === count, i + 1);
      await nativeInput('mouseDown', click, { button: 'middle', clickCount: 1 });
      await nativeInput('mouseUp', click, { button: 'middle', clickCount: 1 });
      await page.waitForFunction(count => dragFixture.menus === count && !dragFixture.c.pointerHeld, i + 1);
    }
    const nativeProof = await page.evaluate(() => ({ clicks: dragFixture.clicks, menus: dragFixture.menus, pointerDowns: dragFixture.events.filter(type => type === 'pointerdown').length, captured: dragFixture.events.includes('lostpointercapture') }));
    assert.deepEqual(nativeProof, { clicks: 12, menus: 12, pointerDowns: 36, captured: true });
    assert.deepEqual(errors, []);
    console.log('CHROMIUM POINTER INPUT PASS:', JSON.stringify(nativeProof));
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-drag-recovery-'))); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
