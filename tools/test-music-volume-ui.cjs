'use strict';
// Isolated Electron fixture using the real music preload and manager. HTTPS
// is served locally by protocol interception; no account, network or playback.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-volume-ui-')); let app;
  try {
    const boot = path.join(temp, 'boot.cjs');
    fs.writeFileSync(boot, `const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(temp)});app.whenReady().then(()=>{
      session.fromPartition('persist:capri-yandex-music').protocol.handle('https',()=>new Response('<input type="range" aria-label="Управление громкостью" min="0" max="1" step="0.000001" value="0.7"><input type="range" aria-label="Управление таймкодом" value="42"><audio></audio><script>const slider=document.querySelector("input"),audio=document.querySelector("audio");slider.addEventListener("input",()=>{audio.volume=Number(slider.value)**2});audio.addEventListener("volumechange",()=>{slider.value=Math.sqrt(audio.volume)});</script>',{headers:{'content-type':'text/html; charset=utf-8'}}));
      global.savedVolumes=[];global.states=[];global.hostWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      hostWindow.loadURL('data:text/html,<title>Capri volume test</title>');
      global.music=require(${JSON.stringify(path.join(root,'src/main/music.js'))}).createMusic({window:hostWindow,initialVolume:.7,onVolume:v=>savedVolumes.push(v),onState:s=>states.push(s)});
      music.layout(true);
    });`);
    app = await _electron.launch({ executablePath: require('electron'), args: [boot], cwd: root });
    await app.evaluate(async ({ webContents }) => {
      const end=Date.now()+40000;
      while(!global.music?.state().ready || !webContents.getAllWebContents().some(w=>w.getURL().startsWith('https://music.yandex.ru'))) {
        if(Date.now()>end) throw new Error('Yandex guest page did not load');await new Promise(r=>setTimeout(r,100));
      }
      global.player=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://music.yandex.ru'));
      while(!await player.executeJavaScript(`Boolean(document.querySelector('input[type="range"][aria-label*="громк" i],input[type="range"][aria-label*="volume" i]'))`)) {
        if(Date.now()>end) throw new Error('Public Yandex volume slider missing');await new Promise(r=>setTimeout(r,100));
      }
    });
    const duringLoading = await app.evaluate(async () => {
      music.layout(false); // Command from quick menu while the music tab is hidden.
      const original=player.isLoadingMainFrame;
      player.isLoadingMainFrame=()=>true;
      const command=music.control('volume',.31);
      const fast=await Promise.race([command.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),800))]);
      player.isLoadingMainFrame=original;player.emit('did-stop-loading');await command;
      return fast;
    });
    assert.equal(duringLoading,true,'a usable player must not wait for did-stop-loading to change volume');
    await app.evaluate(() => music.control('volume', .27));
    await new Promise(resolve => setTimeout(resolve, 800)); // Let player volumechange and the 300ms poll run.
    assert.equal(await app.evaluate(() => player.executeJavaScript('window.__capriMusicVolume()')), .27);
    assert.equal(await app.evaluate(() => music.state().volume), .27);
    await app.evaluate(() => player.executeJavaScript(`(() => {
      const slider=document.querySelector('input[type="range"][aria-label*="громк" i],input[type="range"][aria-label*="volume" i]');
      const min=Number(slider.min||0),max=Number(slider.max||100);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,String(min+.63*(max-min)));
      slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));
    })()`));
    await app.evaluate(async () => { const end=Date.now()+3000;while(Math.abs(music.state().volume-.63)>.0001){if(Date.now()>end)throw new Error('Player volume did not reach menu state');await new Promise(r=>setTimeout(r,30));} });
    const result = await app.evaluate(() => ({ volume: music.state().volume, saved: savedVolumes, notifications: states.length }));
    assert.ok(result.saved.includes(.27) && result.saved.includes(.63));
    for (const value of [.25, .07]) {
      await app.evaluate((_electron, value) => music.control('volume', value), value);
      await app.evaluate(() => player.executeJavaScript(`document.querySelector('audio').dispatchEvent(new Event('playing',{bubbles:true}))`));
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert.equal(await app.evaluate(() => music.state().volume), value, 'menu value must stay stable through repeated polls and playback events');
      const gain = await app.evaluate(() => player.executeJavaScript(`document.querySelector('audio').volume`));
      assert.ok(Math.abs(gain - value ** 2) < .000001, 'let the player own its nonlinear gain scale');
    }
    for (const value of [0, 1]) {
      await app.evaluate((_electron, value) => music.control('volume', value), value);
      assert.equal(await app.evaluate(() => player.executeJavaScript('window.__capriMusicVolume()')), value);
    }
    await app.evaluate(() => new Promise(resolve => { player.once('did-finish-load', resolve); player.reload(); }));
    assert.equal(await app.evaluate(() => player.executeJavaScript('window.__capriMusicVolume()')), 1, 'reload reapplies the shared volume');
    const timeoutProof = await app.evaluate(async () => {
      const frame=player.mainFrame, execute=frame.executeJavaScript;
      let delayedScript;
      frame.executeJavaScript=function(code,...args) {
        if(code.includes('__capriMusicControl')) { delayedScript=code;return new Promise(()=>{}); }
        return execute.call(this,code,...args);
      };
      const start=Date.now();let message='';
      try { await music.control('volume',.44); } catch(error) { message=error.message; }
      finally { frame.executeJavaScript=execute; }
      const elapsed=Date.now()-start;
      const lateResult=await frame.executeJavaScript(delayedScript);
      return {message,elapsed,lateResult,volume:music.state().volume};
    });
    assert.match(timeoutProof.message,/2,5/);
    assert.ok(timeoutProof.elapsed>=2400 && timeoutProof.elapsed<4000);
    assert.equal(timeoutProof.lateResult,false,'expired volume command cannot apply after the renderer recovers');
    assert.equal(timeoutProof.volume,1);
    await app.evaluate(() => music.close());
    console.log('MUSIC VOLUME UI PASS: real preload/manager, fixture slider -> main/menu state and persistence; menu command -> slider; resources closed. No real playback/account test.');
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode=1; });
