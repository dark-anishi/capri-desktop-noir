'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
function tone() {
  const samples = 16000 * 2, out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 16000) * 1000), 44 + i * 2);
  return out.toString('base64');
}
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-quick-ui-')); let app;
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru', musicVolume: .02 }));
  const errors = [];
  try {
    app = await _electron.launch({ executablePath: process.env.CAPRI_TEST_APP || require('electron'), args: process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47829' } });
    const overlay = await app.firstWindow(); overlay.on('pageerror', (e) => errors.push(e.message));
    // Route only the initial player URL to a local fixture before navigation starts.
    // This avoids overlapping loadURL promises and any dependency on the live site.
    await app.evaluate(({ BrowserWindow }) => {
      const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents), load = proto.loadURL;
      proto.loadURL = function(url, options) { return load.call(this, url === 'https://music.yandex.ru/' ? 'data:text/html,<body><audio id="fixture" loop></audio></body>' : url, options); };
    });
    await overlay.waitForTimeout(1500); await overlay.waitForFunction(() => document.getElementById('sprite').dataset.busy === 'false', null, { timeout: 45000 });
    const point = await overlay.evaluate(() => {
      const canvas = document.getElementById('sprite'), r = canvas.getBoundingClientRect();
      const outside = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, clientX: 1, clientY: 1 }); canvas.dispatchEvent(outside);
      if (outside.defaultPrevented) throw new Error('Middle click outside character was intercepted');
      for (let y = r.top + r.height * .35; y < r.top + r.height * .7; y += 4) for (let x = r.left + r.width * .5; x < r.left + r.width * .7; x += 4) {
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, clientX: x, clientY: y }); canvas.dispatchEvent(event);
        if (event.defaultPrevented) return { x, y };
      }
      throw new Error('No mascot hit point');
    });
    async function visible(expected) {
      for (let i = 0; i < 100; i++) {
        const actual = await app.evaluate(({ BrowserWindow }) => Boolean(BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/quick/'))?.isVisible()));
        if (actual === expected) return;
        await overlay.waitForTimeout(50);
      }
      throw new Error('Quick menu visibility did not become ' + expected);
    }
    await visible(true);
    const quick = app.windows().find((p) => p.url().includes('/quick/')); assert.ok(quick); quick.on('pageerror', (e) => errors.push(e.message));
    await quick.locator('#quick-rest').waitFor();
    assert.equal(await quick.locator('#quick-vpn-toggle').isDisabled(), true);
    await overlay.mouse.click(point.x, point.y, { button: 'middle' }); await visible(false);
    await overlay.mouse.click(point.x, point.y, { button: 'middle' }); await visible(true);
    assert.equal(app.windows().filter((p) => p.url().includes('/quick/')).length, 1);
    await quick.mouse.click(45, 20, { button: 'middle' }); await visible(false);
    await overlay.mouse.click(point.x, point.y, { button: 'middle' }); await visible(true);
    await quick.locator('#quick-rest').click();
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'sleepLying');
    await quick.locator('#quick-rest').filter({ hasText: 'Проснуться' }).waitFor();
    assert.equal(await overlay.locator('#capri .sleep-zzz').isVisible(), true);
    await overlay.locator('#capri').screenshot({ path: path.join(root, 'captures/noir-sleep-lying.png'), omitBackground: true });
    await quick.locator('#quick-rest').click(); await quick.locator('#quick-rest').filter({ hasText: 'Подремать' }).waitFor();
    await overlay.waitForFunction(() => document.getElementById('sprite').dataset.pose === 'original');
    await quick.locator('#quick-music-open').click(); await visible(false);
    let menu; for (let i = 0; i < 100; i++) { menu = app.windows().find((p) => p.url().includes('/launcher/')); if (menu) break; await overlay.waitForTimeout(50); }
    assert.ok(menu); menu.on('pageerror', (e) => errors.push(e.message));
    await menu.locator('#music:not([hidden])').waitFor();
    assert.equal(await menu.locator('#pin-window, #pet-rest').count(), 0);
    await app.evaluate(async ({ BrowserWindow }, wav) => {
      const owner = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/launcher/'));
      let contents; for (let i = 0; i < 100; i++) { contents = owner.contentView.children.find((v) => v.webContents)?.webContents; if (contents) break; await new Promise((r) => setTimeout(r, 30)); }
      if (!contents) throw new Error('Music view missing');
      global.quickPlayer = contents;
      await contents.executeJavaScript(`(async()=>{
        window.fixture = new Audio('data:audio/wav;base64,${wav}'); fixture.loop=true; window.nextCount=0; window.previousCount=0;
        navigator.mediaSession.setActionHandler('nexttrack',()=>window.nextCount++);
        navigator.mediaSession.setActionHandler('previoustrack',()=>window.previousCount++);
        navigator.mediaSession.setActionHandler('play',()=>fixture.play());
        navigator.mediaSession.setActionHandler('pause',()=>fixture.pause());
        await fixture.play();
      })()`, true);
    }, tone());
    await menu.evaluate(() => window.launcher.close()); await overlay.evaluate(() => window.host.openQuickMenu()); await visible(true);
    await quick.getByRole('button', { name: 'Пауза', exact: true }).waitFor();
    await quick.locator('#quick-music-toggle').click();
    await quick.getByRole('button', { name: 'Воспроизвести', exact: true }).waitFor();
    assert.equal(await app.evaluate(async () => global.quickPlayer.executeJavaScript('fixture.paused')), true);
    await quick.locator('#quick-music-toggle').click(); await quick.getByRole('button', { name: 'Пауза', exact: true }).waitFor();
    await quick.locator('#quick-music-next').click(); await quick.locator('#quick-music-prev').click();
    assert.deepEqual(await app.evaluate(async () => global.quickPlayer.executeJavaScript('[nextCount, previousCount]')), [1, 1]);
    await quick.locator('#quick-volume').evaluate((el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await quick.waitForFunction(() => document.getElementById('quick-volume').value === '30' && !document.getElementById('quick-volume').disabled);
    assert.equal(await app.evaluate(async () => global.quickPlayer.executeJavaScript('fixture.volume')), .3);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'config.json'))).musicVolume, .3);
    const rejected = await quick.evaluate(async () => { const result=[]; for (const [id,value] of [['anything'], ['quick-volume', 2]]) { try { await window.quickMenu.action(id,value); result.push(false); } catch { result.push(true); } } return result; });
    assert.deepEqual(rejected, [true, true]);
    await quick.screenshot({ path: path.join(root, 'captures/quick-menu.png') });
    await quick.keyboard.press('Escape'); await visible(false);
    await overlay.mouse.click(point.x, point.y, { button: 'right' }); await menu.locator('#apps:not([hidden])').waitFor();
    assert.deepEqual(errors, []);
    console.log('QUICK UI PASS: actual custom popup, middle-click toggle, live Sleep/Wake label, lying pose + Zzz, direct Music entry, real detached audio play/pause, Media Session next/previous, persisted volume, IPC rejection and Escape. Live VPN and Yandex account playback not exercised.');
  } catch (e) { if (app) for (const page of app.windows()) { if (page.url().includes('/quick/')) console.log('Quick diagnostics', await page.evaluate(() => ({ text:document.body.innerText }))); } throw e; }
  finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
