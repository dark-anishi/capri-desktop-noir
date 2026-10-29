const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require(process.env.CAPRI_PLAYWRIGHT_PATH);
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'capri-volume-live-'));let app;
 try{
  const boot=path.join(tmp,'boot.cjs');
  fs.writeFileSync(boot,`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(tmp)});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(path.resolve('src/music-preload.js'))}}});w.loadURL('https://music.yandex.ru/');});`);
  app=await _electron.launch({executablePath:require('electron'),args:[boot]});const page=await app.firstWindow();
  await page.waitForFunction(()=>Boolean(document.querySelector('input[type=range][aria-label*="громк" i]')),{},{timeout:25000});
  const result=await page.evaluate(async()=>{
   await window.__capriMusicControl('volume',.27);await new Promise(r=>setTimeout(r,600));
   const afterMenu=window.__capriMusicVolume();
   document.querySelector('button[aria-label="Выключить звук"]')?.click();await new Promise(r=>setTimeout(r,100));
   document.querySelector('button[aria-label="Включить звук"]')?.click();await new Promise(r=>setTimeout(r,300));
   const afterRender=window.__capriMusicVolume();
   const slider=document.querySelector('input[type=range][aria-label*="громк" i]');
   const min=Number(slider.min||0),max=Number(slider.max||100);
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,String(min+.63*(max-min)));
   slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,600));return{afterMenu,afterRender,afterPlayer:window.__capriMusicVolume()};
  });
  require('node:assert/strict').deepEqual(result,{afterMenu:.27,afterRender:.27,afterPlayer:.63});console.log('PUBLIC YANDEX SLIDER PASS',result);
 }finally{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1});
