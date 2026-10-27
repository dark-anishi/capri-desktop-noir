'use strict';
// Code-native SVG color filters preserve every source pixel's position and alpha.
// This keeps the animation rig and all expression crops aligned with the original assets.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets/capri');
const target = path.join(root, 'assets/skins/mono');
// Remap the character's red hair/clothes and green accents to pale silver and white.
// Blue-heavy outlines stay dark. The low end of the curve protects black details.
const palette = `<feColorMatrix type="matrix" values="1.55 1 0 0 0  1.55 1 0 0 0  1.55 1 0 0 0  0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues="0 0.025 0.1 0.6 0.95 1 1"/><feFuncG type="table" tableValues="0 0.025 0.1 0.6 0.95 1 1"/><feFuncB type="table" tableValues="0 0.025 0.1 0.6 0.95 1 1"/></feComponentTransfer>`;
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(source).filter((f) => f.endsWith('.png'))) {
  const bytes = fs.readFileSync(path.join(source, name));
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><filter id="mono" color-interpolation-filters="sRGB">${palette}</filter></defs><image width="${w}" height="${h}" filter="url(#mono)" href="data:image/png;base64,${bytes.toString('base64')}"/></svg>`;
  fs.writeFileSync(path.join(target, name.replace('.png', '.svg')), svg);
}
fs.writeFileSync(path.join(target, 'skin.json'), JSON.stringify({ id: 'mono', name: 'NOIR', source: 'capri', filter: 'silver-white palette', preserves: ['geometry', 'alpha', 'animation rig'] }, null, 2));
console.log('Monochrome character assets built.');
