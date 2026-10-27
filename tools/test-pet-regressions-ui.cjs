'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-pet-regressions-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const errors = [];
  try {
    app = await _electron.launch({ executablePath: process.env.CAPRI_TEST_APP || require('electron'), args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: process.env.CAPRI_TEST_PORT || '47830' } });
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => document.querySelector('#sprite')?.dataset.pose === 'original');
    const proof = await page.evaluate(async () => {
      const [{ Capri }, { Panel }, { FxLayer }, { loadPoseArt }] = await Promise.all([import('./js/capri.js'), import('./js/panel.js'), import('./js/fx.js'), import('./js/pose-art.js')]);
      const load = url => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      const [image, intro, poses] = await Promise.all([load('../../assets/skins/mono/capri-full.svg'), load('../../assets/capri/intro-face.webp'), loadPoseArt('mono', load)]);
      const actor = document.createElement('div'), canvas = document.createElement('canvas'); actor.append(canvas); document.body.append(actor);
      const dummy = new Proxy({}, { get: () => () => {} });
      const c = new Capri({ root: actor, canvas, image, poseImages: poses, fx: dummy, voice: dummy });
      c.loop = () => {}; c.wander = false; c.setScale(1);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      c.pos = { x: 600, y: 700 }; c.setStance('stand'); c.busy = false; c.hidden = false;
      const rest = c.rest(); const head = c.head();
      c.notice(head.x, head.y); c.attend(); c.setMusicPlaying(true); c.goToWork(); c.setMode('idle'); c.drawFrame();
      const asleep = { mode: c.mode, manual: c.manualRest, pose: c.sprite.poseName, zzz: !c.zzz.hidden };
      c.wake(); const explicitWake = c.mode === 'idle' && !c.manualRest;
      c.rest(); c.setMode('alert'); const alertWake = c.mode === 'alert' && !c.manualRest;
      const el = document.getElementById('panel').cloneNode(true), ticker = document.getElementById('ticker').cloneNode(true); el.id = 'regression-panel'; ticker.id = 'regression-ticker'; document.body.append(el, ticker);
      const panel = new Panel({ panel: el, ticker, labels: { state: {} } }); panel.skin = 'mono';
      panel.say({ kind: 'idle', line: 'Я сижу на окне. Сообщение должно оставаться сбоку.', hold: null });
      const layouts = [];
      for (const width of [1280, 1920]) for (const x of [180, width - 180]) {
        const body = { left: x - 132, right: x + 132 };
        panel.setAnchor({ x, y: 80, top: 12, seated: true, body }, { w: width, h: 1080 });
        const r = el.getBoundingClientRect(); layouts.push({ side: el.dataset.side, avoidsBody: r.right <= body.left || r.left >= body.right, visible: r.left >= 14 && r.right <= width - 14 && r.top >= 14, below: el.dataset.below });
      }
      panel.setAnchor({ x: 600, y: 300, top: 240 }, { w: 1920, h: 1080 }); const standingSide = el.dataset.side;
      const fx = new FxLayer(document.createElement('canvas'), { intro, skin: 'mono' });
      const data = fx.strip.getContext('2d').getImageData(0, 0, fx.strip.width, fx.strip.height).data;
      let chromatic = 0, bright = 0, ink = 0;
      for (let i = 0; i < data.length; i += 4) { if (!data[i + 3]) continue; if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) chromatic++; if (data[i] > 225) bright++; if (data[i] < 35) ink++; }
      fx.resize(800, 600); fx.intro({ to: { x: 400, y: 500, size: 100 } });
      const introItem = fx.items.find(item => item.type === 'intro');
      fx.draw(introItem, 0.3, 0, introItem.born + 1000);
      const rendered = fx.ctx.getImageData(0, 0, fx.canvas.width, fx.canvas.height).data;
      let introChromatic = 0, introVisible = 0;
      for (let i = 0; i < rendered.length; i += 4) if (rendered[i + 3]) { introVisible++; if (Math.abs(rendered[i] - rendered[i + 1]) > 1 || Math.abs(rendered[i] - rendered[i + 2]) > 1) introChromatic++; }
      fx.items = [];
      const monoRed = fx.colors.red; fx.setSkin('classic'); const channelsReset = fx.channels === null; const classicRestored = fx.strip === intro && fx.colors.red === '#ff2152'; fx.setSkin('mono');
      const cached = fx.strip === fx.monoStrip;
      panel.hide(); actor.remove(); el.remove(); ticker.remove();
      return { rest, asleep, explicitWake, alertWake, layouts, standingSide, chromatic, introChromatic, introVisible, channelsReset, bright, ink, monoRed, classicRestored, cached };
    });
    assert.equal(proof.rest, true); assert.deepEqual(proof.asleep, { mode: 'sleep', manual: true, pose: 'sleepLying', zzz: true });
    assert.equal(proof.explicitWake, true); assert.equal(proof.alertWake, true);
    for (const layout of proof.layouts) { assert.equal(layout.avoidsBody, true); assert.equal(layout.visible, true); assert.equal(layout.below, 'false'); assert.ok(['left','right'].includes(layout.side)); }
    assert.equal(proof.standingSide, ''); assert.equal(proof.chromatic, 0); assert.equal(proof.introChromatic, 0); assert.ok(proof.introVisible > 10000); assert.equal(proof.channelsReset, true); assert.ok(proof.bright > 10000); assert.ok(proof.ink > 10000); assert.equal(proof.monoRed, '#ffffff'); assert.equal(proof.classicRestored, true); assert.equal(proof.cached, true);
    assert.deepEqual(errors, []);
    console.log('PET REGRESSIONS PASS:', JSON.stringify(proof));
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(err => { console.error(err); process.exitCode = 1; });
