'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  for (const name of ['capri-full', 'capri-face']) {
    const file = path.resolve('assets/skins/mono/' + name + '.svg');
    const url = 'data:image/svg+xml;base64,' + fs.readFileSync(file).toString('base64');
    const png = await win.webContents.executeJavaScript(`(async()=>{const im=new Image();im.src=${JSON.stringify(url)};await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);return c.toDataURL('image/png').split(',')[1]})()`);
    fs.mkdirSync(path.resolve('captures'), { recursive: true });
    fs.writeFileSync(path.resolve('captures/noir-reference-' + name + '.png'), Buffer.from(png, 'base64'));
  }
  win.destroy(); app.quit();
}).catch((err) => { console.error(err.message); app.exit(1); });
