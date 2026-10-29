'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { createOverlayInput } = require('../src/main/overlay-input');
function fixture() {
  const overlay = new EventEmitter(), webContents = new EventEmitter(), calls = [];
  let tick, visible = true, blocked = false, stopped = false;
  let bounds = { x: -1920, y: 0, width: 1920, height: 1040 }, callback;
  const delayed = new Map(); let nextId = 0, invalidates = 0, recovered = 0;
  Object.assign(webContents, { isDestroyed: () => false });
  webContents.invalidate = () => { invalidates++; };
  Object.assign(overlay, { webContents, isDestroyed: () => false, isVisible: () => visible, setIgnoreMouseEvents: (ignore, options) => calls.push({ ignore, options }) });
  Object.assign(overlay, { getBounds: () => ({ ...bounds }), setBounds: b => { bounds = b; }, hookWindowMessage: (_message, fn) => { callback = fn; }, unhookWindowMessage: () => { callback = null; } });
  overlay.hide = () => { visible = false; overlay.emit('hide'); };
  overlay.showInactive = () => { visible = true; overlay.emit('show'); };
  const input = createOverlayInput({ overlay, platform: 'win32', onRecover: () => { recovered++; }, blocked: () => blocked, timers: { setInterval(fn) { tick = fn; return 1; }, clearInterval() { stopped = true; }, setTimeout(fn) { const id=++nextId; delayed.set(id,fn); return id; }, clearTimeout(id) { delayed.delete(id); } } });
  return { overlay, input, calls, tick: () => tick(), visible: value => { visible = value; }, blocked: value => { blocked = value; }, stopped: () => stopped, power: () => { const w=Buffer.alloc(8);w.writeUInt32LE(0x8013);callback(w); }, flush: () => { const callbacks=[...delayed.values()];delayed.clear();callbacks.forEach(fn=>fn()); }, invalidates: () => invalidates, recovered: () => recovered, pending: () => delayed.size, hooked: () => Boolean(callback) };
}
test('unchanged desired state is reapplied, recovering an independently changed native input flag', () => {
  const f = fixture(); f.input.setInteractive(true);
  f.overlay.setIgnoreMouseEvents(true, { forward: false }); // External HWND drift; renderer still caches true.
  f.tick(); assert.equal(f.calls.at(-1).ignore, false);
  assert.equal(f.calls.at(-1).options.forward, false);
  const count = f.calls.length; f.tick(); assert.equal(f.calls.length, count + 1);
  f.input.close();
});
test('display power notifications rebuild the surface without suspend, display migration, or focus changes', () => {
  const f = fixture(), bounds = f.overlay.getBounds();
  f.input.setInteractive(true); f.power(); f.power();
  assert.equal(f.pending(), 2, 'coalesce repeated off/on/dim notifications');
  f.flush(); assert.deepEqual(f.overlay.getBounds(), bounds);
  assert.equal(f.invalidates(), 2); assert.equal(f.recovered(), 2);
  f.blocked(true); f.power(); f.flush(); assert.equal(f.recovered(), 2);
  f.blocked(false); f.overlay.emit('show'); assert.equal(f.recovered(), 3);
  f.power(); f.input.close(); assert.equal(f.pending(), 0); assert.equal(f.hooked(), false);
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
