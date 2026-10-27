'use strict';
// Layout and simultaneous operations use fixture managers. No real VPN, Zapret or UAC.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-quick-layout-'));
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
  const bootstrap = path.join(temp, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `
    global.quickFixture = { calls: [] };
    require(${JSON.stringify(path.join(root, 'src/main/vpn/manager.js'))}).VpnManager = class {
      constructor(options) { this.options = options; this.phase = 'disconnected'; }
      state() { return { phase: this.phase, activeId: 'fixture-profile', settings: {mode:'rule'}, favorites:[], proxies:[] }; }
      start() { quickFixture.calls.push('vpn'); this.phase='connecting'; this.options.onState(this.state()); return new Promise(resolve=>{ quickFixture.releaseVpn=()=>{this.phase='connected';this.options.onState(this.state());resolve();}; }); }
      async stop() { this.phase='disconnected'; this.options.onState(this.state()); }
      async close() {}
    };
    require(${JSON.stringify(path.join(root, 'src/main/zapret.js'))}).createZapret = options => {
      let phase='stopped';
      const manager = {
        state:()=>({phase,supported:true,batches:Array.from({length:40},(_,i)=>'general (strategy '+i+').bat'),lastBat:'general (strategy 0).bat',error:quickFixture.zapretError||''}),
        start(){quickFixture.calls.push('zapret');phase='starting';options.onChange(manager.state());return new Promise(resolve=>{quickFixture.releaseZapret=()=>{phase='running';options.onChange(manager.state());resolve();};});},
        async stop(){phase='stopped';options.onChange(manager.state());}, async close(){}
      }; quickFixture.refreshZapret=()=>options.onChange(manager.state()); return manager;
    };
    require(${JSON.stringify(path.join(root, 'src/main/main.js'))});
  `);
  let app; const errors = [];
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47831' } });
    app.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    const overlay = await app.firstWindow(); await overlay.waitForFunction(() => Boolean(window.host?.openQuickMenu));
    const opened = app.waitForEvent('window'); await overlay.evaluate(() => window.host.openQuickMenu()); const quick = await opened;
    await quick.locator('#quick-rest').waitFor();
    await quick.waitForFunction(() => innerHeight <= 470);
    // This gate measures layout and independent operations, not native focus.
    // Keep the fixture visible while the user can work in another desktop app.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/quick/'));
      win.removeAllListeners('blur'); win.emit('focus'); win.show();
    });
    await quick.waitForFunction(() => innerHeight-document.getElementById('quick-open').getBoundingClientRect().bottom<=26);
    const layout = await quick.evaluate(() => ({ height: innerHeight, bodyHeight: document.body.getBoundingClientRect().height, pageScroll: document.documentElement.scrollHeight - innerHeight, menuOverflow: document.getElementById('items').scrollHeight - document.getElementById('items').clientHeight, first: document.querySelector('#quick-vpn-toggle').getBoundingClientRect().top, last: document.querySelector('#quick-open').getBoundingClientRect().bottom }));
    assert.ok(Math.abs(layout.bodyHeight-layout.height)<1); assert.equal(layout.pageScroll, 0);
    assert.equal(layout.menuOverflow, 0, JSON.stringify(layout)); assert.ok(layout.first >= 0); assert.ok(layout.last < layout.height);
    assert.ok(layout.height-layout.last<=26,JSON.stringify(layout)); assert.ok(layout.height<620,JSON.stringify(layout));
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => { const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/quick/')); return {bounds:win.getBounds(),area:screen.getDisplayMatching(win.getBounds()).workArea}; });
    // Windows may add a few DIP of invisible non-client bounds around a frameless toolbar.
    assert.ok(bounds.bounds.height < 630, JSON.stringify({ bounds, layout }));
    assert.ok(bounds.bounds.y >= bounds.area.y - 8); assert.ok(bounds.bounds.y + bounds.bounds.height <= bounds.area.y + bounds.area.height + 8);
    await quick.locator('#quick-zapret-toggle').click();
    await quick.getByRole('button', { name: 'Zapret — подожди…', exact: true }).waitFor();
    assert.equal(await quick.locator('#quick-vpn-toggle').innerText(), 'Подключить VPN'); assert.equal(await quick.locator('#quick-vpn-toggle').isEnabled(), true);
    await quick.locator('#quick-vpn-toggle').click();
    await quick.getByRole('button', { name: 'VPN — подключение…', exact: true }).waitFor();
    assert.deepEqual(await app.evaluate(() => global.quickFixture.calls), ['zapret', 'vpn']);
    await app.evaluate(() => global.quickFixture.releaseZapret());
    await quick.getByRole('button', { name: 'Остановить Zapret', exact: true }).waitFor();
    assert.equal(await quick.locator('#quick-vpn-toggle').isDisabled(), true);
    await app.evaluate(() => global.quickFixture.releaseVpn());
    await quick.getByRole('button', { name: 'Отключить VPN', exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => { const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/quick/'));win.show();win.focus(); });
    await quick.getByText('Стратегии Zapret', { exact: true }).click();
    await quick.getByText('Избранные локации', { exact: true }).click();
    await quick.waitForFunction(() => {
      const root=document.getElementById('items'), lists=[...root.querySelectorAll(':scope > details[open] > .submenu')];
      return lists.length===2 && lists.every(list=>list.style.maxHeight) && root.scrollHeight===root.clientHeight;
    });
    const expandedLayout = await quick.evaluate(() => {
      const root=document.getElementById('items');
      return { overflow:root.scrollHeight-root.clientHeight,last:document.getElementById('quick-open').getBoundingClientRect().bottom,edge:root.getBoundingClientRect().bottom,scrollingLists:[...root.querySelectorAll(':scope > details[open] > .submenu')].filter(list=>list.scrollHeight>list.clientHeight).length };
    });
    assert.equal(expandedLayout.overflow, 0); assert.ok(expandedLayout.last <= expandedLayout.edge); assert.ok(expandedLayout.scrollingLists >= 1);
    await quick.waitForFunction(() => innerHeight-document.getElementById('quick-open').getBoundingClientRect().bottom<=26);
    assert.equal(await quick.evaluate(() => document.documentElement.scrollHeight === innerHeight && document.body.scrollTop === 0 && getComputedStyle(document.body).overflow === 'hidden'), true);
    await app.evaluate(() => { global.quickFixture.zapretError='Fixture Zapret error: ' + 'Long diagnostic path and strategy details. '.repeat(80); global.quickFixture.refreshZapret(); });
    assert.equal(Object.hasOwn(await quick.evaluate(()=>window.quickMenu.state()),'error'),false);
    assert.equal(await quick.locator('#error').count(),0); assert.doesNotMatch(await quick.locator('body').innerText(),/Fixture Zapret error/);
    await quick.screenshot({ path: path.join(root, 'captures/quick-menu-expanded.png'), timeout: 10000 });
    await quick.getByText('Стратегии Zapret', { exact: true }).click();
    await quick.getByText('Избранные локации', { exact: true }).click();
    await quick.waitForFunction(() => innerHeight<620 && innerHeight-document.getElementById('quick-open').getBoundingClientRect().bottom<=26);
    assert.ok(await quick.evaluate(()=>document.getElementById('items').scrollHeight===document.getElementById('items').clientHeight));
    const finalWidth=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/quick/')).getBounds().width);
    assert.ok(Math.abs(finalWidth-bounds.bounds.width)<=1,`Popup width drifted: ${bounds.bounds.width} -> ${finalWidth}`);
    await quick.screenshot({ path: path.join(root, 'captures/quick-menu-compact.png'), timeout: 10000 });
    await quick.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    console.log('QUICK LAYOUT UI PASS: measured compact height without blank tail/global scroll, grows/shrinks with capped submenus, work-area bounds, independent Zapret/VPN operations, no inline raw errors or console, no renderer errors. No real networking/UAC.');
  } catch (error) {
    if (app) for (const page of app.windows()) if (page.url().includes('/quick/')) console.error('Layout diagnostics', await page.evaluate(() => ({ height:innerHeight,body:document.body.getBoundingClientRect().height,root:document.getElementById('items').getBoundingClientRect().height,overflow:document.getElementById('items').scrollHeight-document.getElementById('items').clientHeight,last:document.getElementById('quick-open').getBoundingClientRect().bottom,submenus:[...document.querySelectorAll('#items > details[open] > .submenu')].map(item=>({height:item.getBoundingClientRect().height,max:item.style.maxHeight})) })));
    throw error;
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-quick-layout-')));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
