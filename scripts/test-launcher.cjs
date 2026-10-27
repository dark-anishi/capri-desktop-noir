'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LauncherStore } = require('../src/main/launcher-store');
const { readUrlIcon } = require('../src/main/shortcut-icons');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-launcher-'));
  const desktop = path.join(root, 'desktop'); fs.mkdirSync(desktop);
  const storeRoot = path.join(root, 'library');
  try { return run({ root, desktop, store: new LauncherStore(storeRoot, [desktop]), storeRoot }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('desktop shortcuts move into persistent categories, then restore byte for byte', () => fixture(({ desktop, store, storeRoot }) => {
  const source = path.join(desktop, 'Музыка.lnk'); const bytes = Buffer.from('shortcut contents'); fs.writeFileSync(source, bytes);
  const category = store.addCategory('Моё');
  const { entry } = store.importOne(source, category.id);
  assert.equal(fs.existsSync(source), false);
  assert.deepEqual(fs.readFileSync(store.entryPath(entry)), bytes);
  const reloaded = new LauncherStore(storeRoot, [desktop]);
  assert.equal(reloaded.list().entries[0].category, category.id);
  assert.throws(() => reloaded.removeCategory(category.id));
  reloaded.move(entry.id, 'games');
  reloaded.removeCategory(category.id);
  assert.equal(reloaded.list().entries[0].category, 'games');
  assert.equal(reloaded.restore(entry.id), source);
  assert.deepEqual(fs.readFileSync(source), bytes);
  assert.equal(reloaded.list().entries.length, 0);
}));
test('non-desktop imports are copied; only shortcuts are accepted', () => fixture(({ root, desktop, store }) => {
  const source = path.join(root, 'Browser.url'); fs.writeFileSync(source, '[InternetShortcut]\nURL=https://example.com');
  const { entry } = store.importOne(source, 'internet');
  assert.equal(fs.existsSync(source), true);
  assert.throws(() => store.importOne(source, 'internet'));
  store.restore(entry.id);
  assert.equal(fs.existsSync(path.join(desktop, 'Browser.url')), true);
  const exe = path.join(desktop, 'Program.exe'); fs.writeFileSync(exe, 'executable');
  assert.throws(() => store.importOne(exe, 'work'));
  assert.equal(fs.existsSync(exe), true);
}));
test('failed persistence and restore collisions never destroy source data', () => fixture(({ desktop, store }) => {
  const source = path.join(desktop, 'App.lnk'); fs.writeFileSync(source, 'original');
  const save = store.save.bind(store);
  store.save = () => { throw new Error('disk full'); };
  assert.throws(() => store.importOne(source, 'work'));
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  store.save = save;
  const { entry } = store.importOne(source, 'work');
  fs.writeFileSync(source, 'different shortcut');
  assert.throws(() => store.restore(entry.id));
  assert.equal(fs.readFileSync(source, 'utf8'), 'different shortcut');
  assert.equal(fs.readFileSync(store.entryPath(entry), 'utf8'), 'original');
  assert.equal(store.list().entries.length, 1);
}));

test('Steam URL icon metadata supports Unicode, UTF-16 and original relative icon paths', () => fixture(({ root }) => {
  const source = path.join(root, 'game.url');
  const original = path.join(root, 'Desktop/game.url');
  fs.writeFileSync(source, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[InternetShortcut]\r\nIconFile=icons/игра.ico\r\nIconIndex=-12\r\nURL=steam://rungameid/123', 'utf16le')]));
  assert.deepEqual(readUrlIcon(source, original), { icon: path.join(root, 'Desktop/icons/игра.ico'), iconIndex: -12 });
}));

test('protected Public Desktop returns to personal Desktop without losing the library copy', () => fixture(({ root, desktop }) => {
  const shared = path.join(root, 'PublicDesktop'); fs.mkdirSync(shared);
  const store = new LauncherStore(path.join(root, 'shared-library'), [desktop, shared]);
  const source = path.join(shared, 'VirtualBox.lnk'); fs.writeFileSync(source, 'owned shortcut');
  const { entry } = store.importOne(source, 'work');
  const copy = fs.copyFileSync;
  fs.copyFileSync = (from, to, ...rest) => { if (path.dirname(to) === shared) { const err = new Error('protected public desktop'); err.code = 'EPERM'; throw err; } return copy(from, to, ...rest); };
  try { const dest = store.restore(entry.id); assert.equal(dest, path.join(desktop, 'VirtualBox.lnk')); assert.equal(fs.readFileSync(dest, 'utf8'), 'owned shortcut'); assert.equal(store.list().entries.length, 0); }
  finally { fs.copyFileSync = copy; }
}));

test('launch history upgrades old entries without changing shortcuts, persists, and keeps repeated launches ordered', () => fixture(({ desktop, store, storeRoot }) => {
  const first = path.join(desktop, 'Game A.lnk'), second = path.join(desktop, 'Game B.lnk');
  fs.writeFileSync(first, 'A'); fs.writeFileSync(second, 'B');
  const a = store.importOne(first, 'games').entry, b = store.importOne(second, 'games').entry;
  assert.equal(store.entry(a.id).lastLaunchedAt, undefined);
  const now = Date.now; Date.now = () => 100;
  try { store.recordLaunch(a.id); store.recordLaunch(b.id); store.recordLaunch(a.id); } finally { Date.now = now; }
  const reloaded = new LauncherStore(storeRoot, [desktop]);
  assert.ok(reloaded.entry(a.id).lastLaunchedAt > reloaded.entry(b.id).lastLaunchedAt);
  assert.equal(fs.readFileSync(reloaded.entryPath(a), 'utf8'), 'A');
  const before = fs.readFileSync(reloaded.file); assert.throws(() => reloaded.recordLaunch('missing')); assert.ok(fs.readFileSync(reloaded.file).equals(before));
  reloaded.restore(a.id); assert.equal(reloaded.list().entries.length, 1);
}));
