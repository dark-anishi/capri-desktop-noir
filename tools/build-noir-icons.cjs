'use strict';
// Export the existing editable NOIR vector art, keeping its exact filter and alpha.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await win.loadURL('data:text/html,<body></body>');
 const svg='data:image/svg+xml;base64,'+fs.readFileSync(path.resolve('assets/skins/mono/capri-face.svg')).toString('base64');
 const sizes=[16,24,32,48,64,128,256,512];
 const encoded=await win.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify(svg)};await image.decode();const out={};for(const size of ${JSON.stringify(sizes)}){const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,size,size);out[size]=c.toDataURL('image/png').split(',')[1];}return out;})()`);
 const images=new Map(sizes.map(size=>[size,Buffer.from(encoded[size],'base64')]));
 fs.writeFileSync(path.resolve('assets/icons/capri-mono.png'),images.get(512));
 fs.writeFileSync(path.resolve('assets/icons/tray-mono.png'),images.get(32));
 const frames=sizes.filter(size=>size<=256),header=Buffer.alloc(6+frames.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
 let offset=header.length;
 frames.forEach((size,i)=>{const at=6+i*16,png=images.get(size);header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;});
 fs.writeFileSync(path.resolve('assets/icons/capri-mono.ico'),Buffer.concat([header,...frames.map(size=>images.get(size))]));
 console.log('NOIR icons exported from current capri-face.svg: PNG 512, tray 32, ICO 16–256.');win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
