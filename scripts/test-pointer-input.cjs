'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

// Exercise the production pointer binding without loading WebGL or the render loop.
function fixture() {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/js/capri.js'), 'utf8');
  const method = source.slice(source.indexOf('  bindPointer() {'), source.indexOf('  // Let go of her:'));
  class Surface extends EventTarget {
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture() { this.capture = null; }
  }
  const window = new Surface(), canvas = new Surface();
  const bind = vm.runInNewContext(`({${method}}).bindPointer`, { window, Math, SPRITE: { height: 420 }, clamp: (x, a, b) => Math.max(a, Math.min(b, x)), tween() {}, ease: { out() {} } });
  const counts = { click: 0, menu: 0, drop: 0 };
  const c = { canvas, pos: { x: 300, y: 500 }, view: { w: 1200 }, floor: 800, scale: 1, p: {}, hit: () => true, unpinWindow() {}, endAct() {}, setStance() {}, place() {}, notice() {}, preparePin() {}, onClick() { counts.click++; }, onQuickMenu() { counts.menu++; }, drop() { counts.drop++; } };
  bind.call(c);
  const emit = (target, type, patch = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, buttons: 1, clientX: 300, clientY: 400, pointerId: 1, pointerType: 'mouse', ...patch });
    target.dispatchEvent(event);
  };
  return { c, canvas, window, counts, emit };
}

test('pointer-only input clicks and drags even without compatibility mouse events', () => {
  const f = fixture();
  f.emit(f.canvas, 'pointerdown');
  assert.equal(f.c.pointerHeld, true);
  assert.equal(f.canvas.capture, 1);
  f.emit(f.window, 'pointerup', { buttons: 0 });
  assert.equal(f.counts.click, 1);
  f.emit(f.canvas, 'pointerdown');
  f.emit(f.window, 'pointermove', { clientX: 340 });
  assert.equal(f.c.dragging, true); assert.equal(f.c.pos.x, 340);
  f.emit(f.window, 'pointerup', { buttons: 0 });
  assert.equal(f.counts.drop, 1); assert.equal(f.c.pointerHeld, false);
});

test('middle pointer input opens once despite compatibility mouse events', () => {
  const f = fixture();
  f.emit(f.canvas, 'pointerdown', { button: 1, buttons: 4 });
  f.emit(f.canvas, 'mousedown', { button: 1, buttons: 4 });
  f.emit(f.window, 'pointerup', { button: 1, buttons: 0 });
  assert.equal(f.counts.menu, 1);
});

test('capture loss, cancellation, blur and missing release never leave a held press', () => {
  for (const type of ['lostpointercapture', 'pointercancel', 'blur', 'pointermove']) {
    const f = fixture();
    f.emit(f.canvas, 'pointerdown'); f.emit(f.window, 'pointermove', { clientX: 340 });
    f.emit(type === 'lostpointercapture' ? f.canvas : f.window, type, { buttons: 0 });
    assert.equal(f.c.pointerHeld, false, type); assert.equal(f.c.dragging, false, type);
    assert.equal(f.counts.click, 0, type);
    f.emit(f.canvas, 'pointerdown'); f.emit(f.window, 'pointerup', { buttons: 0 });
    assert.equal(f.counts.click, 1, type);
  }
});

test('a press stays interactive before the drag threshold, even if the animated silhouette moves away', () => {
  const f = fixture();
  f.emit(f.canvas, 'mousedown');
  f.c.hit = () => false;
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/js/app.js'), 'utf8');
  const body = source.slice(source.indexOf('  const refreshHit = () => {'), source.indexOf('  // Her biochip:'));
  let interactive;
  const refresh = vm.runInNewContext(`${body}; refreshHit`, {
    capri: f.c, mouse: { x: 300, y: 400 }, panel: { rect: () => null },
    onChip: () => false, document: { body: { style: {} } }, setInteractive: on => { interactive = on; },
  });
  refresh(); assert.equal(interactive, true, 'do not switch the native window to click-through in the middle of a press');
  f.emit(f.window, 'mouseup', { buttons: 0 }); refresh(); assert.equal(interactive, false);
});
