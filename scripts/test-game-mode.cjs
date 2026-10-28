'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGameActivity, createGameMode, sameDisplay } = require('../src/main/game-mode');

test('foreground games and true fullscreen are quiet; desktop, launchers and normal maximized apps are not', () => {
  for (const activity of [
    { fullscreen: true }, { exclusive: true }, { gamePath: true },
    { executable: 'RobloxPlayerBeta.exe' }, { executable: 'DOTA2.EXE' },
    { executable: 'unlisted-game.exe', windowClass: 'UnityWndClass' },
    { executable: 'unlisted-game.exe', windowClass: 'UnrealWindow' },
    { executable: 'javaw.exe', windowClass: 'GLFW30' },
  ]) assert.equal(isGameActivity(activity), true, JSON.stringify(activity));
  for (const activity of [
    null, {}, { own: true, fullscreen: true, exclusive: true },
    { executable: 'chrome.exe', fullscreen: false }, { executable: 'steam.exe' },
    { executable: 'Discord.exe' }, { executable: 'Unity.exe', windowClass: 'UnityWndClass' },
    { executable: 'UnrealEditor.exe', windowClass: 'UnrealWindow' },
    { executable: 'javaw.exe', windowClass: 'SunAwtFrame' },
  ]) assert.equal(isGameActivity(activity), false, JSON.stringify(activity));
});

function fixture(initialMuted = false) {
  let destroyed = false, muted = initialMuted, visible = true;
  const calls = [], states = [];
  const overlay = {
    isDestroyed: () => destroyed,
    webContents: { isDestroyed: () => destroyed, isAudioMuted: () => muted, setAudioMuted(value) { muted = value; calls.push(['mute', value]); } },
    setIgnoreMouseEvents(value, options) { calls.push(['ignore', value, options]); },
    hide() { visible = false; calls.push(['hide']); },
    showInactive() { visible = true; calls.push(['showInactive']); },
  };
  const controller = createGameMode({ overlay, onChange: state => states.push(state), hideQuick: () => calls.push(['hideQuick']) });
  return { controller, calls, states, muted: () => muted, visible: () => visible, destroy: () => { destroyed = true; } };
}

test('game entry immediately hides mascot and menu, mutes audio, and restores without focus or repeated transitions', () => {
  const f = fixture();
  f.controller.update(true);
  assert.equal(f.controller.active, true); assert.equal(f.muted(), true); assert.equal(f.visible(), false);
  assert.ok(f.calls.some(c => c[0] === 'hideQuick'));
  assert.deepEqual(f.calls.find(c => c[0] === 'ignore'), ['ignore', true, { forward: true }]);
  const count = f.calls.length; f.controller.update(true); assert.equal(f.calls.length, count);
  f.controller.update(false);
  assert.equal(f.muted(), false); assert.equal(f.visible(), true); assert.deepEqual(f.states, [true, false]);
  assert.equal(f.calls.filter(c => c[0] === 'showInactive').length, 1);
});

test('reload remains quiet and a pre-existing main-process mute survives game exit', () => {
  const f = fixture(true); f.controller.update(true); f.controller.sync();
  assert.equal(f.muted(), true); assert.equal(f.visible(), false);
  f.controller.update(false); assert.equal(f.muted(), true);
  f.destroy(); const count = f.calls.length; f.controller.update(true); f.controller.sync(); assert.equal(f.calls.length, count);
});

test('other monitor stays visible and silent; CtrlAltC override survives repeated snapshots', () => {
  const display = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.equal(sameDisplay(display, { x: 0, y: 0, width: 2560, height: 1440 }), false);
  assert.equal(sameDisplay(display, { ...display }), true);
  const f = fixture();
  f.controller.update(true, { covered: false });
  assert.equal(f.visible(), true); assert.equal(f.muted(), true); assert.equal(f.controller.active, false);
  f.controller.update(true, { covered: true }); assert.equal(f.visible(), false);
  assert.equal(f.controller.toggleReveal(), true); assert.equal(f.visible(), true); assert.equal(f.muted(), true);
  f.controller.update(true, { covered: true }); assert.equal(f.visible(), true);
  f.controller.sync(); assert.equal(f.visible(), true);
  f.controller.toggleReveal(); assert.equal(f.visible(), false);
  f.controller.update(false); assert.equal(f.visible(), true); assert.equal(f.muted(), false);
  f.controller.update(true); assert.equal(f.visible(), false, 'old reveal must not leak into next game session');
});
