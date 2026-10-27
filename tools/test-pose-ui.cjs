'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), executablePath = process.env.CAPRI_TEST_APP || require('electron');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-pose-ui-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const errors = [];
  try {
    app = await _electron.launch({ executablePath, args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    const page = await app.firstWindow(); page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /boot failed|shader|Skin:/.test(m.text())) errors.push(m.text()); });
    await page.waitForFunction(() => document.querySelector('#sprite')?.dataset.pose === 'original');
    await page.evaluate(async () => {
      const [{ Capri }, { Player }, { loadPoseArt }] = await Promise.all([import('./js/capri.js'), import('./js/acting.js'), import('./js/pose-art.js')]);
      const load = (url) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      const image = await load('../../assets/skins/mono/capri-full.svg'), poses = await loadPoseArt('mono', load);
      const root = document.createElement('div'); root.id = 'pose-test'; root.style.position = 'fixed'; root.style.zIndex = 9999;
      const canvas = document.createElement('canvas'); root.append(canvas); document.body.append(root);
      const dummy = new Proxy({}, { get: () => () => {} });
      const c = new Capri({ root, canvas, image, poseImages: poses, fx: dummy, voice: dummy });
      c.loop = () => {}; c.wander = false; c.nextMove = c.nextTwitch = c.nextGaze = c.nextShed = Infinity;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      Object.assign(c.p, { boil: 0, sparkle: 0, grade: 0, misreg: [0, 0] });
      c.debug = { boil: 0, sparkle: 0, head: 0, hair: 0, mane: 0 }; c.setScale(1);
      c.windows = { fg: 1, wins: [{ id: 1, x: 350, y: 380, w: 700, h: 350, max: false }] };
      c.pos = c.seat(c.windows.wins[0], 250); c.setStance('sit', { perch: { id: 1, dx: 250 } });
      c.base = new Player('sit', { at: 0 }); c.drawFrame(0);
      window.poseTest = c;
    });
    assert.equal(await page.locator('#pose-test canvas').getAttribute('data-pose'), 'seated');
    const proof = await page.evaluate(() => {
      const c = window.poseTest, gl = c.sprite.gl;
      const pixels = (t) => { c.drawFrame(t); const p = new Uint8Array(c.canvas.width * c.canvas.height * 4); gl.readPixels(0, 0, c.canvas.width, c.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
      const first = pixels(0), second = pixels(1200); let changed = 0, clear = 0, solid = 0;
      // WebGL rows are bottom-up: restrict the comparison to the dangling legs.
      const legRows = Math.round((420 + 56 - 244) * devicePixelRatio);
      for (let y = 0; y < c.canvas.height; y++) for (let x = 0; x < c.canvas.width; x++) {
        const i = (y * c.canvas.width + x) * 4;
        if (!second[i + 3]) clear++; else solid++;
        if (y < legRows && Math.abs(first[i + 3] - second[i + 3]) > 30) changed++;
      }
      const before = { ...c.pos }; c.setWindows({ fg: 1, wins: [{ id: 1, x: 410, y: 410, w: 700, h: 350, max: false }] });
      const ride = { dx: c.pos.x - before.x, dy: c.pos.y - before.y };
      c.drawFrame(1200);
      const bodyHit = c.hit(c.pos.x, c.pos.y - (418 - 210));
      const emptyHit = c.hit(c.pos.x - 270, c.pos.y - 100);
      return { changed, clear, solid, ride, bodyHit, emptyHit, glError: gl.getError() };
    });
    assert.ok(proof.changed > 100, 'leg silhouettes must actually move on the GPU');
    assert.ok(proof.clear > proof.solid, 'transparent background must remain click-through');
    assert.deepEqual(proof.ride, { dx: 60, dy: 30 }); assert.equal(proof.bodyHit, true); assert.equal(proof.emptyHit, false); assert.equal(proof.glError, 0);
    const pinned = await page.evaluate(async () => {
      const c = window.poseTest; c.preparePin(1); await c.pinWindow(true);
      const anchor = { ...c.pos }; c.wander = true; c.wanderStep(); c.goToWork();
      await c.teleport({ x: 50, y: 50 });
      const stayed = c.pos.x === anchor.x && c.pos.y === anchor.y && c.stance === 'sit';
      const win = c.windows.wins[0];
      c.setWindows({ fg: 2, wins: [{ id: 2, x: win.x - 20, y: win.y - 60, w: 700, h: 300, max: false }, win] });
      const hiddenWhenCovered = c.pinOccluded && c.root.style.visibility === 'hidden' && !c.hit(c.pos.x, c.pos.y - 200);
      c.setWindows({ fg: 1, wins: [win] });
      const restored = !c.pinOccluded && c.pinned.id === 1;
      c.setMode('sleep'); c.endAct(false); c.drawFrame(5000);
      c.sleptAt = 0; c.behave(90000); await c.doze(); c.drawFrame(6000);
      return { stayed, hiddenWhenCovered, restored, sleeping: c.sprite.poseName, legs: [c.p.kickL, c.p.kickR], dormant: c.dormant };
    });
    assert.equal(pinned.stayed, true); assert.equal(pinned.hiddenWhenCovered, true); assert.equal(pinned.restored, true);
    assert.equal(pinned.sleeping, 'sleepSeated'); assert.deepEqual(pinned.legs, [0, 0]); assert.equal(pinned.dormant, false);
    await page.locator('#pose-test canvas').screenshot({ path: path.join(root, 'captures/noir-sleep-seated.png'), omitBackground: true });
    await page.evaluate(() => { const c = window.poseTest; c.setMusicPlaying(true); c.drawFrame(6500); });
    assert.equal(await page.locator('#pose-test canvas').getAttribute('data-pose'), 'musicSeated');
    await page.locator('#pose-test canvas').screenshot({ path: path.join(root, 'captures/noir-music-seated.png'), omitBackground: true });
    const paused = await page.evaluate(() => { const c = window.poseTest; c.setMusicPlaying(false); c.unpinWindow(); c.wander = false; c.drawFrame(); return { mode: c.mode, pose: c.sprite.poseName, pinned: c.petState().pinned }; });
    assert.deepEqual(paused, { mode: 'idle', pose: 'seated', pinned: false });
    fs.mkdirSync(path.join(root, 'captures'), { recursive: true });
    await page.locator('#pose-test canvas').screenshot({ path: path.join(root, 'captures/noir-seated.png'), omitBackground: true });
    if (process.env.CAPRI_RECORD_POSES === '1') {
      const base64 = await page.evaluate(async () => {
        const c = window.poseTest, out = document.createElement('canvas'); out.width = 640; out.height = 480;
        const ctx = out.getContext('2d'), stream = out.captureStream(24), chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const stopped = new Promise((r) => { recorder.onstop = r; });
        recorder.start(); const start = performance.now();
        await new Promise((resolve) => {
          const frame = () => {
            const elapsed = performance.now() - start; c.drawFrame(elapsed);
            ctx.fillStyle = '#393939'; ctx.fillRect(0, 0, 640, 480);
            ctx.fillStyle = '#111'; ctx.fillRect(24, 230, 592, 230); ctx.strokeStyle = '#929292'; ctx.strokeRect(24.5, 230.5, 591, 229);
            ctx.fillStyle = '#aaa'; ctx.font = '12px monospace'; ctx.fillText('CAPRI / NOIR', 42, 254);
            ctx.drawImage(c.canvas, 150, 0, 352 * .8, 532 * .8);
            if (elapsed < 3600) requestAnimationFrame(frame); else resolve();
          }; frame();
        });
        recorder.stop(); await stopped; stream.getTracks().forEach((t) => t.stop());
        const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(binary);
      });
      fs.writeFileSync(path.join(root, 'captures/noir-window-seat.webm'), Buffer.from(base64, 'base64'));
    }
    await page.evaluate(() => { const c = window.poseTest; c.setStance('stand'); c.setMode('alert'); c.drawFrame(); });
    assert.equal(await page.locator('#pose-test canvas').getAttribute('data-pose'), 'thinking');
    await page.locator('#pose-test canvas').screenshot({ path: path.join(root, 'captures/noir-thinking.png'), omitBackground: true });
    await page.evaluate(() => { const c = window.poseTest; c.setMode('idle'); c.perform('wave'); c.drawFrame(); });
    assert.equal(await page.locator('#pose-test canvas').getAttribute('data-pose'), 'wave');
    await page.locator('#pose-test canvas').screenshot({ path: path.join(root, 'captures/noir-wave.png'), omitBackground: true });
    await page.evaluate(() => { const c = window.poseTest; c.endAct(false); c.setStance('sit', { perch: { id: 1, dx: 250 } }); c.drawFrame(); c.setWindows({ fg: 0, wins: [] }); });
    const falling = await page.evaluate(() => window.poseTest.stance); assert.equal(falling, 'fall');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.evaluate(() => { const c = window.poseTest; c.setStance('sit', { perch: { id: 1, dx: 250 } }); c.drawFrame(performance.now() + 1000); return [c.p.kickL, c.p.kickR]; });
    assert.deepEqual(reduced, [0, 0]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const manualSleep = await page.evaluate(() => {
      const c = window.poseTest; c.endAct(false); c.setStance('stand'); c.setMode('work'); c.setMusicPlaying(true);
      const available = c.petState().canRest; c.rest(); c.setMusicPlaying(false); c.setMusicPlaying(true); c.setMode('work'); c.goToWork(); c.drawFrame();
      const held = c.mode === 'sleep' && c.manualRest && c.sprite.poseName === 'sleepLying';
      c.setMode('alert'); const alertWoke = c.mode === 'alert' && !c.manualRest; c.setMusicPlaying(false); c.setMode('idle');
      return { available, held, alertWoke };
    });
    assert.deepEqual(manualSleep, { available: true, held: true, alertWoke: true });
    const interruptedSleep = await page.evaluate(async () => {
      const c = window.poseTest; c.setStance('stand'); c.setMode('sleep'); c.drawFrame();
      const lying = c.sprite.poseName, zzz = !c.zzz.hidden; await c.doze();
      c.setMusicPlaying(true);
      return { lying, zzz, mode: c.mode, dormant: c.dormant, hidden: c.hidden, busy: c.busy };
    });
    assert.deepEqual(interruptedSleep, { lying: 'sleepLying', zzz: true, mode: 'idle', dormant: false, hidden: false, busy: false });
    await page.evaluate(async () => { const c = window.poseTest; const i = new Image(); i.src = '../../assets/capri/capri-full.png'; await i.decode(); c.setArtwork(i, {}); c.setStance('stand'); c.drawFrame(); });
    assert.equal(await page.locator('#pose-test canvas').getAttribute('data-pose'), 'original');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/renderer/')).webContents.send('codex:event', { hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: 'pose-check', message: 'Pose acceptance check' }));
    await page.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'thinking', null, { timeout: 18000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/renderer/')).webContents.send('capri:command', { name: 'act', act: 'celebrate' }));
    // Reduced motion skips the victory act by design; enable it for the completion pose check.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/renderer/')).webContents.send('capri:command', { name: 'act', act: 'celebrate' }));
    await page.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'wave');
    assert.deepEqual(errors, []);
    console.log('POSE UI PASS: generated textures, independently moving legs (GPU pixels), ledge anchor/window motion, alpha hit testing, alert/wave situations, window-close fall, reduced motion and original-skin fallback.');
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
