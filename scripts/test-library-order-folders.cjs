'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { LauncherStore } = require('../src/main/launcher-store');

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-folders-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const desktop = path.join(temp, 'Desktop'), root = path.join(temp, 'library');
  fs.mkdirSync(desktop);
  return { temp, desktop, root, store: new LauncherStore(root, [desktop]) };
}

test('application order persists, category moves and launch history remain intact', (t) => {
  const { temp, root, desktop, store } = fixture(t);
  const entries = ['A', 'B', 'C'].map((name) => {
    const file = path.join(temp, name + '.url'); fs.writeFileSync(file, '[InternetShortcut]\nURL=https://example.invalid/');
    return store.importOne(file, 'games').entry;
  });
  store.recordLaunch(entries[1].id); store.recordLaunch(entries[0].id);
  const history = store.list().entries.map((item) => [item.id, item.lastLaunchedAt]);
  store.reorder(entries[2].id, entries[0].id);
  assert.deepEqual(store.list().entries.map((item) => item.name), ['C', 'A', 'B']);
  store.move(entries[0].id, 'work');
  const restarted = new LauncherStore(root, [desktop]);
  assert.deepEqual(restarted.list().entries.map((item) => item.name), ['C', 'A', 'B']);
  assert.equal(restarted.entry(entries[0].id).category, 'work');
  for (const [id, timestamp] of history) assert.equal(restarted.entry(id).lastLaunchedAt, timestamp);
  const before = restarted.list();
  assert.throws(() => restarted.reorder(entries[0].id, 'missing'));
  assert.throws(() => restarted.reorder(entries[0].id, null, '__proto__'));
  assert.deepEqual(restarted.list(), before);
});

test('folder references and folder shortcuts never move or delete source contents', (t) => {
  const { temp, root, desktop, store } = fixture(t);
  const folder = path.join(desktop, 'Documents'); fs.mkdirSync(folder);
  const content = path.join(folder, 'important.txt'); fs.writeFileSync(content, 'keep this');
  const entry = store.importFolder(folder).entry;
  assert.equal(store.folderPath(entry), fs.realpathSync(folder));
  assert.throws(() => store.importFolder(folder), /уже добавлена/);
  const other = path.join(temp, 'Other'); fs.mkdirSync(other);
  const shortcut = path.join(desktop, 'My folder.lnk'); fs.writeFileSync(shortcut, 'shortcut fixture');
  const linked = store.importFolder(shortcut, () => ({ target: other, args: '/do-not-execute' })).entry;
  assert.equal(linked.name, 'My folder');
  store.reorder(linked.id, entry.id, 'folders');
  const restarted = new LauncherStore(root, [desktop]);
  assert.deepEqual(restarted.list().folders.map((item) => item.name), ['My folder', 'Documents']);
  restarted.removeFolder(entry.id); restarted.removeFolder(linked.id);
  assert.equal(fs.readFileSync(content, 'utf8'), 'keep this');
  assert.equal(fs.readFileSync(shortcut, 'utf8'), 'shortcut fixture');
  assert.deepEqual(fs.readdirSync(store.shortcuts), []);
  assert.throws(() => restarted.importFolder(shortcut, () => ({ target: content })), /не к папке/);
  assert.throws(() => restarted.importFolder(content), /Нужна папка/);
  assert.throws(() => restarted.importFolder(shortcut, () => ({ target: 'relative' })), /путь к папке/);
});

test('old libraries gain an empty folder collection without changing existing data', (t) => {
  const { root, desktop, store } = fixture(t);
  const old = store.list(); delete old.folders;
  fs.writeFileSync(store.file, JSON.stringify(old));
  const reopened = new LauncherStore(root, [desktop]);
  assert.deepEqual(reopened.list(), { ...old, folders: [] });
});
