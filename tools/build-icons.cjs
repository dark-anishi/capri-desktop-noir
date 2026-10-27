'use strict';
// Run with Electron: electron tools/build-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const dir = path.join(__dirname, '../assets/icons');
  const image = nativeImage.createFromPath(path.join(dir, 'capri-mono.png'));
  if (image.isEmpty()) throw new Error('The generated monochrome icon is missing.');
  fs.writeFileSync(path.join(dir, 'tray-mono.png'), image.resize({ width: 32, height: 32 }).toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => image.resize({ width: size, height: size }).toPNG());
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((bytes, i) => {
    const p = 6 + i * 16;
    header[p] = sizes[i] % 256; header[p + 1] = sizes[i] % 256;
    header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(bytes.length, p + 8); header.writeUInt32LE(offset, p + 12);
    offset += bytes.length;
  });
  fs.writeFileSync(path.join(dir, 'capri-mono.ico'), Buffer.concat([header, ...images]));
  console.log('Monochrome Windows and tray icons built.');
  app.quit();
});
