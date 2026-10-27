'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const moduleFile = path.resolve(__dirname, '../src/renderer/js/pose-art.js');
const artModule = () => import('data:text/javascript;base64,' + fs.readFileSync(moduleFile).toString('base64'));
test('drawn NOIR poses follow ledges, approval waits and completion, and yield to interaction', async () => {
  const { choosePoseArt } = await artModule();
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'work' }), 'seated');
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'sleep' }), 'sleepSeated');
  assert.equal(choosePoseArt({ stance: 'stand', mode: 'sleep' }), 'sleepLying');
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'idle', act: 'gaze' }), 'gazeSeated');
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'idle', act: 'uplink' }), 'gazeSeated');
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'idle', musicPlaying: true }), 'musicSeated');
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'work', musicPlaying: true }), 'seated');
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'alert', musicPlaying: true }), 'seated');
  assert.equal(choosePoseArt({ stance: 'sit', mode: 'idle', act: 'talk' }), 'seated');
  assert.equal(choosePoseArt({ stance: 'stand', mode: 'alert' }), 'thinking');
  assert.equal(choosePoseArt({ stance: 'stand', mode: 'idle', act: 'victory' }), 'wave');
  assert.equal(choosePoseArt({ stance: 'stand', mode: 'idle', act: 'wave' }), 'wave');
  for (const patch of [{ pointing: true }, { dragging: true }, { hidden: true }, { busy: true }, { stance: 'fall' }, { stance: 'peek' }, { act: 'zap' }]) assert.equal(choosePoseArt({ stance: 'sit', mode: 'work', ...patch }), null);
});
test('generated pose PNGs are present with alpha and seat registration preserves the window anchor', async () => {
  const { NOIR_POSES, loadPoseArt } = await artModule();
  assert.deepEqual(await loadPoseArt('original', () => { throw new Error('must not load NOIR art'); }), {});
  assert.equal(NOIR_POSES.seated.scale * 915, 232);
  for (const art of Object.values(NOIR_POSES)) {
    const data = fs.readFileSync(path.resolve(__dirname, '../assets/skins/mono/poses', art.file));
    assert.equal(data.subarray(1, 4).toString(), 'PNG'); assert.equal(data[25], 6, 'RGBA source required');
    assert.ok(data.readUInt32BE(16) >= 900 && data.readUInt32BE(20) >= 1000);
  }
});
