'use strict';
// Run with Electron after Alt+Print captures Capri's active window. Read the
// Windows image clipboard directly: no JPEG intermediate or image rescaling.
const electron = require('electron');
if (typeof electron === 'string') {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [__filename, ...process.argv.slice(2)], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}
const { app, clipboard, nativeImage } = electron;
const fs = require('node:fs'), path = require('node:path');
app.whenReady().then(async () => {
  const name = process.argv[2];
  if (!/^(apps|apps-context|folders|music|skins|vpn)\.png$/.test(name || '')) throw new Error('Choose a documented Capri screenshot name.');
  const items = await clipboard.read();
  const item = items.find(item => item.types.includes('image/png'));
  if (!item) throw new Error('The clipboard does not contain a PNG screenshot.');
  const png = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
  const image = nativeImage.createFromBuffer(png), { width, height } = image.getSize();
  if (image.isEmpty() || width < 1000 || height < 800 || Math.abs(width / height - 1072 / 936) > .04) throw new Error(`Clipboard is not the expected Capri window (${width}x${height}).`);
  const destination = path.join(__dirname, '..', 'docs', 'screenshots', '0.6.11', name);
  fs.writeFileSync(destination, png);
  console.log(JSON.stringify({ file: name, width, height, bytes: fs.statSync(destination).size }));
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
