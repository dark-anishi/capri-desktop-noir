'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {_electron}=require(process.env.CAPRI_PLAYWRIGHT_PATH||'playwright');const root=path.resolve(__dirname,'..');
(async()=>{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'capri-pointer-'));let app;
fs.writeFileSync(path.join(temp,'config.json'),JSON.stringify({welcomed:true,linked:true,muted:true,wander:false,possess:false,skin:'mono',lang:'ru'}));
try{
 app=await _electron.launch({executablePath:process.env.CAPRI_TEST_APP||require('electron'),args:process.env.CAPRI_TEST_APP?['--dev']:[root,'--dev'],cwd:root,env:{...process.env,CAPRI_TEST_DATA:temp,CAPRI_PORT:'47829'}});
 const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('#sprite')?.dataset.pose==='original');
 const proof=await page.evaluate(async()=>{
  const [{Capri},{loadPoseArt}]=await Promise.all([import('./js/capri.js'),import('./js/pose-art.js')]);
  const load=(url)=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});
  const image=await load('../../assets/skins/mono/capri-full.svg'),poses=await loadPoseArt('mono',load);
  const root=document.createElement('div');root.style.cssText='position:fixed;left:0;top:0;width:max-content';const canvas=document.createElement('canvas');root.append(canvas);document.body.append(root);
  const dummy=new Proxy({},{get:()=>()=>{}}),c=new Capri({root,canvas,image,poseImages:poses,fx:dummy,voice:dummy});c.loop=()=>{};
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));c.pos={x:700,y:700};c.setScale(.8);c.setMode('alert');c.debug={boil:0,head:0,mane:0,hair:0};c.drawFrame();
  let middle=0,left=0;c.onQuickMenu=()=>middle++;c.onClick=()=>left++;
  const cases=[];
  for(const [tilt,sx,sy] of [[0,1,1],[35,.7,1.2],[90,1,1],[-20,-.8,.85]]){
   c.tilt=tilt;c.sx=sx;c.sy=sy;c.place();
   const style=getComputedStyle(canvas),matrix=new DOMMatrix(style.transform),[ox,oy]=style.transformOrigin.split(' ').map(parseFloat),r=root.getBoundingClientRect();
   let samples=0,misses=0,point=null;
   for(let y=40;y<410;y+=6)for(let x=15;x<225;x+=6){if(c.alphaMap[(y*240+x)*4+3]<240)continue;
    const p=matrix.transformPoint(new DOMPoint((x+56)*c.scale-ox,(y+56)*c.scale-oy));const px=r.left+ox+p.x,py=r.top+oy+p.y;samples++;
    point||={x:px,y:py}; if(!c.hit(px,py))misses++;
   }
   if(point){canvas.dispatchEvent(new MouseEvent('mousedown',{button:1,clientX:point.x,clientY:point.y,cancelable:true,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:point.x,clientY:point.y,bubbles:true}));window.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));}
   cases.push({tilt,sx,sy,samples,misses});
  }
  c.tilt=0;c.sx=c.sy=1;c.place();
  const style=getComputedStyle(canvas),matrix=new DOMMatrix(style.transform),[ox,oy]=style.transformOrigin.split(' ').map(parseFloat),rect=root.getBoundingClientRect();
  let clickPoint;
  for(let y=100;y<250&&!clickPoint;y++)for(let x=30;x<200;x++)if(c.alphaMap[(y*240+x)*4+3]>240){const q=matrix.transformPoint(new DOMPoint((x+56)*c.scale-ox,(y+56)*c.scale-oy));clickPoint={x:rect.left+ox+q.x,y:rect.top+oy+q.y};break;}
  canvas.dispatchEvent(new MouseEvent('mousedown',{button:0,buttons:1,clientX:clickPoint.x,clientY:clickPoint.y,bubbles:true}));
  window.dispatchEvent(new MouseEvent('mousemove',{buttons:1,clientX:clickPoint.x+30,clientY:clickPoint.y+5,bubbles:true}));
  const draggingBefore=c.dragging;
  window.dispatchEvent(new MouseEvent('mouseup',{button:1,buttons:1,bubbles:true}));const middleDidNotRelease=c.dragging;
  window.dispatchEvent(new MouseEvent('mousemove',{buttons:0,clientX:clickPoint.x+30,clientY:clickPoint.y+5,bubbles:true}));
  return{cases,middle,left,draggingBefore,middleDidNotRelease,recovered:!c.dragging};
 });
 console.log('POINTER PROOF',JSON.stringify(proof));assert.ok(proof.cases.every(c=>c.misses===0),'painted sprite points must remain clickable under CSS rotation and stretch'); assert.equal(proof.middle,4); assert.equal(proof.left,4); assert.equal(proof.draggingBefore,true); assert.equal(proof.middleDidNotRelease,true); assert.equal(proof.recovered,true);
}finally{if(app)await app.close();fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
