'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const base = path.resolve(__dirname, '../src/renderer/js');
const uri = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
async function loadFx() {
  const util = uri(fs.readFileSync(path.join(base, 'util.js'), 'utf8'));
  const previous = { matchMedia: global.matchMedia, requestAnimationFrame: global.requestAnimationFrame };
  global.matchMedia = () => ({ matches: false }); global.requestAnimationFrame = () => 1;
  try {
    const { FxLayer } = await import(uri(fs.readFileSync(path.join(base, 'fx.js'), 'utf8').replace("'./util.js'", JSON.stringify(util))));
    const fx = new FxLayer({ width: 800, height: 600, getContext: () => ({ clearRect() {} }) });
    fx.strip = { width: 400, height: 400 }; fx.size = { w: 800, h: 600 }; fx.channels = [];
    return { fx, restore: () => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete global[name]; else global[name] = value; } } };
  } catch (error) { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete global[name]; else global[name] = value; } throw error; }
}

test('intro completion resolves when a delayed RAF skips directly beyond the last animation frame', async () => {
  const { fx, restore } = await loadFx();
  try {
    let landed = false;
    const intro = fx.intro({ to: { x: 400, y: 500, size: 100 } }).then(() => { landed = true; });
    const item = fx.items.find(item => item.type === 'intro');
    fx.frame(item.born + item.life + 1000);
    await Promise.resolve();
    assert.equal(landed, true, 'expired intro must settle its promise instead of keeping Capri busy forever');
    await intro; assert.equal(fx.items.length, 0);
  } finally { restore(); }
});

test('clearing game-time effects settles intro and cut-in waiters without replay or duplicate completion', async () => {
  const { fx, restore } = await loadFx();
  try {
    let landed = 0, finished = 0; fx.cutins.grin = {};
    const intro = fx.intro({ to: { x: 400, y: 500, size: 100 } }).then(() => { landed++; });
    const cutin = fx.cutin(100, 100).then(() => { finished++; });
    fx.clear(); await Promise.all([intro, cutin]); fx.clear();
    assert.equal(landed, 1); assert.equal(finished, 1); assert.equal(fx.items.length, 0);
  } finally { restore(); }
});
