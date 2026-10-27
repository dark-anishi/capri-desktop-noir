'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-recents-ui-')), desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed:true, linked:true, muted:true, wander:false, possess:false, skin:'mono', lang:'ru' }));
  let app; const errors = [];
  const names = ['Game A', 'Game B', 'Editor', 'Browser', 'Never launched'];
  const sources = names.map((name) => { const file = path.join(desktop, name + '.url'); fs.writeFileSync(file, '[InternetShortcut]\r\nURL=https://example.invalid/\r\n'); return file; });
  async function start() {
    app = await _electron.launch({ executablePath:process.env.CAPRI_TEST_APP || require('electron'), args:process.env.CAPRI_TEST_APP ? ['--dev'] : [root, '--dev'], cwd:root, env:{...process.env,CAPRI_TEST_DATA:temp,CAPRI_PORT:'47829'} });
    app.on('window', (p) => p.on('pageerror', (e) => errors.push(e.message)));
    const overlay = await app.firstWindow();
    await overlay.waitForFunction(() => Boolean(window.host));
    await app.evaluate(({ app, shell }, desktop) => {
      app.setPath('desktop', desktop); global.recentsLaunchError = ''; global.recentsLaunchCalls = [];
      const stub = async (file) => { global.recentsLaunchCalls.push(file); return global.recentsLaunchError; };
      shell.openPath = stub; if (shell.openPath !== stub) throw new Error('Launch stub could not be installed');
    }, desktop);
    const opened = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openMenu()); const menu = await opened;
    await menu.locator('[data-category="recent-games"]').waitFor();
    return { overlay, menu };
  }
  try {
    let {overlay,menu} = await start();
    const custom = await menu.evaluate(() => window.launcher.addCategory('Личное')); assert.ok(custom.ok);
    const categories = ['games', 'games', custom.category.id, 'internet', 'games'];
    for (let i=0;i<sources.length;i++) assert.equal((await menu.evaluate(({file,category}) => window.launcher.importPaths([file],category),{file:sources[i],category:categories[i]})).results[0].ok,true);
    await menu.reload(); await menu.locator('[data-category="all"]').waitFor();
    const order = await menu.locator('.category > span').allTextContents();
    assert.deepEqual(order.slice(0,2),['Недавно запущенные игры','Недавно запущенные приложения']); assert.deepEqual(order.slice(-2),['Другое','Все приложения']);
    assert.equal(await menu.locator('.entry-launch').count(),0); assert.match(await menu.locator('#empty').innerText(),/последние запуски/);
    const ids = Object.fromEntries((await menu.evaluate(() => window.launcher.state())).state.entries.map((e)=>[e.name,e.id]));
    async function launch(name, category='games') {
      await menu.locator(`[data-category="${category}"]`).click();
      const previous = (await menu.evaluate(()=>window.launcher.state())).state.entries.find((e)=>e.name===name).lastLaunchedAt || 0;
      await menu.locator('.entry-launch').filter({hasText:name}).click();
      await menu.waitForFunction(async ({name,previous}) => { const s=await window.launcher.state(); return s.state.entries.find((e)=>e.name===name).lastLaunchedAt>previous && !document.body.hasAttribute('aria-busy'); },{name,previous},{polling:100});
      await overlay.evaluate(()=>window.host.openMenu());
      await menu.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
    }
    await launch('Game A'); await launch('Game B'); await launch('Game A');
    await menu.locator('[data-category="recent-games"]').click();
    assert.deepEqual(await menu.locator('.entry-launch strong').allTextContents(),['Game A','Game B']);
    await menu.locator('[data-category="recent-apps"]').click(); assert.equal(await menu.locator('.entry-launch').count(),0);
    await launch('Editor','all'); await launch('Browser','all');
    await menu.locator('[data-category="recent-apps"]').click(); assert.deepEqual(await menu.locator('.entry-launch strong').allTextContents(),['Browser','Editor']);
    await app.evaluate(()=>{global.recentsLaunchError='fixture launch failure';}); await menu.locator('[data-category="all"]').click();
    await menu.locator('.entry-launch').filter({hasText:'Never launched'}).click(); await menu.locator('#status').filter({hasText:'fixture launch failure'}).waitFor();
    assert.equal((await menu.evaluate(()=>window.launcher.state())).state.entries.find((e)=>e.name==='Never launched').lastLaunchedAt,undefined);
    await app.close(); app=null;
    ({overlay,menu}=await start());
    assert.deepEqual(await menu.locator('.entry-launch strong').allTextContents(),['Game A','Game B']);
    await menu.locator('[data-category="recent-apps"]').click(); assert.deepEqual(await menu.locator('.entry-launch strong').allTextContents(),['Browser','Editor']);
    assert.equal((await menu.evaluate((id)=>window.launcher.restore(id),ids['Game A'])).ok,true);
    await menu.reload(); await menu.locator('[data-category="recent-games"]').waitFor();
    assert.deepEqual(await menu.locator('.entry-launch strong').allTextContents(),['Game B']); assert.ok(fs.existsSync(sources[0]));
    await menu.screenshot({path:path.join(root,'captures/recent-apps.png')});
    assert.deepEqual(errors,[]);
    console.log('RECENTS UI PASS: tab order, empty history, success-only launch IPC recording (shell launch stubbed), game/app separation, newest-first deduplication, full app restart persistence and restore cleanup. No actual applications launched.');
  } finally { if(app) await app.close(); fs.rmSync(temp,{recursive:true,force:true}); }
})().catch((e)=>{console.error(e);process.exitCode=1;});
