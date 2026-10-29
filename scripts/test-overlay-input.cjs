'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { createOverlayInput } = require('../src/main/overlay-input');
function fixture() {
  const overlay = new EventEmitter(), webContents = new EventEmitter(), calls = [];
  let tick, visible = true, blocked = false, stopped = false;
  Object.assign(webContents, { isDestroyed: () => false });
  Object.assign(overlay, { webContents, isDestroyed: () => false, isVisible: () => visible, setIgnoreMouseEvents: (ignore, options) => calls.push({ ignore, options }) });
  const input = createOverlayInput({ overlay, blocked: () => blocked, timers: { setInterval(fn) { tick = fn; return 1; }, clearInterval() { stopped = true; } } });
  return { overlay, input, calls, tick: () => tick(), visible: value => { visible = value; }, blocked: value => { blocked = value; }, stopped: () => stopped };
}
test('unchanged desired state is reapplied, recovering an independently changed native input flag', () => {
  const f = fixture(); f.input.setInteractive(true);
  f.overlay.setIgnoreMouseEvents(true, { forward: false }); // External HWND drift; renderer still caches true.
  f.tick(); assert.equal(f.calls.at(-1).ignore, false);
  assert.equal(f.calls.at(-1).options.forward, false);
  const count = f.calls.length; f.tick(); assert.equal(f.calls.length, count + 1);
  f.input.close();
});
test('show/move/resize reapply and reload starts safe instead of reusing old interactive state', () => {
  const f = fixture(); f.input.setInteractive(true);
  for (const event of ['show', 'resize', 'move']) { f.overlay.emit(event); assert.equal(f.calls.at(-1).ignore, false); }
  f.overlay.webContents.emit('did-start-loading'); assert.equal(f.calls.at(-1).ignore, true);
  f.input.close();
});
test('game suppression wins, hidden windows stay idle, and destruction releases resources', () => {
  const f = fixture(); f.input.setInteractive(true); f.blocked(true); f.tick(); assert.equal(f.calls.at(-1).ignore, true);
  f.blocked(false); f.tick(); assert.equal(f.calls.at(-1).ignore, false);
  f.visible(false); const count = f.calls.length; f.tick(); assert.equal(f.calls.length, count);
  f.overlay.emit('closed'); assert.equal(f.stopped(), true); f.tick(); assert.equal(f.calls.length, count);
  assert.equal(f.overlay.listenerCount('show'), 0); assert.equal(f.overlay.webContents.listenerCount('did-start-loading'), 0);
});
test('closed cleanup never reads BrowserWindow.webContents after the native window is destroyed', () => {
  const f = fixture();
  const contents = f.overlay.webContents;
  Object.defineProperty(f.overlay, 'webContents', { get() { throw new TypeError('Object has been destroyed'); } });
  assert.doesNotThrow(() => f.overlay.emit('closed'));
  assert.doesNotThrow(() => f.input.close());
  assert.doesNotThrow(() => f.tick());
  assert.equal(f.stopped(), true);
  assert.equal(contents.listenerCount('did-start-loading'), 0);
});
