'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { LauncherStore } = require('../src/main/launcher-store');
const { ShortcutDrop, suggestCategory } = require('../src/main/shortcut-drop');
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-drop-'));
  try {
    const desktop = path.join(root, 'desktop'); fs.mkdirSync(desktop);
    const store = new LauncherStore(path.join(root, 'library'), [desktop]);
    const files = ['Roblox.lnk', 'Visual Studio Code.lnk', 'Firefox.url'].map((name) => { const p = path.join(desktop, name); fs.writeFileSync(p, 'shortcut fixture'); return p; });
    fn({ store, files, queue: new ShortcutDrop(store), root });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('mascot drop suggests each category, keeps originals until confirmation, and cancels without changes', () => fixture(({ store, files, queue }) => {
  const pending = queue.prepare(files);
  assert.deepEqual(pending.items.map((i) => i.category), ['games', 'work', 'internet']);
  assert.ok(pending.items.every((i) => !Object.hasOwn(i, 'file')));
  assert.ok(files.every(fs.existsSync)); assert.equal(store.list().entries.length, 0);
  queue.cancel(); assert.equal(queue.view(), null); assert.ok(files.every(fs.existsSync));
}));
test('confirmed drop uses chosen categories, durable store and existing restore; duplicate/stale confirmations fail', () => fixture(({ store, files, queue }) => {
  const pending = queue.prepare(files);
  const choices = pending.items.map((i) => ({ id: i.id, category: 'other' }));
  assert.ok(queue.commit(pending.id, choices).every((r) => r.ok));
  assert.ok(files.every((f) => !fs.existsSync(f))); assert.equal(queue.view(), null);
  assert.ok(store.list().entries.every((e) => e.category === 'other'));
  assert.throws(() => queue.commit(pending.id, choices));
  for (const e of store.list().entries) store.restore(e.id);
  assert.ok(files.every(fs.existsSync));
}));
test('drop rejects unsupported paths and invalid choices before any transfer, reports missing source on confirmation', () => fixture(({ store, files, queue, root }) => {
  const bad = path.join(root, 'application.exe'); fs.writeFileSync(bad, 'do not move');
  assert.throws(() => queue.prepare([files[0], bad])); assert.ok(fs.existsSync(files[0]));
  assert.throws(() => queue.prepare(['relative.lnk'])); assert.throws(() => queue.prepare([]));
  const old = queue.prepare(files), pending = queue.prepare(files);
  assert.throws(() => queue.commit(old.id, []));
  assert.throws(() => queue.commit(pending.id, pending.items.map((i) => ({ id: i.id, category: 'missing' }))));
  assert.throws(() => queue.commit(pending.id, pending.items.map(() => ({ id: pending.items[0].id, category: 'work' }))));
  assert.ok(files.every(fs.existsSync)); assert.equal(store.list().entries.length, 0);
  fs.unlinkSync(files[0]);
  const results = queue.commit(pending.id, pending.items.map((i) => ({ id: i.id, category: i.category })));
  assert.equal(results[0].ok, false); assert.ok(results.slice(1).every((r) => r.ok));
}));
test('suggestions honor existing library and remain valid when defaults have been removed', () => {
  const library = { categories: [{ id: 'custom', name: 'Мои игры' }], entries: [{ name: 'Roblox', category: 'custom' }] };
  assert.equal(suggestCategory('Roblox', library), 'custom');
  assert.equal(suggestCategory('Firefox', library), 'custom');
});
