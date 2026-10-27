'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const moduleFile = path.resolve(__dirname, '../src/launcher/library-views.js');
const viewsModule = () => import('data:text/javascript;base64,' + fs.readFileSync(moduleFile).toString('base64'));
const library = { categories: [{ id: 'work', name: 'Работа' }, { id: 'games', name: 'Игры' }, { id: 'internet', name: 'Интернет' }, { id: 'other', name: 'Другое' }, { id: 'custom', name: 'Мои' }], entries: [
  { id: 'oldGame', category: 'games', lastLaunchedAt: 10 }, { id: 'newGame', category: 'games', lastLaunchedAt: 40 },
  { id: 'oldApp', category: 'work', lastLaunchedAt: 20 }, { id: 'newApp', category: 'custom', lastLaunchedAt: 30 }, { id: 'unopened', category: 'internet' },
] };
test('recent views lead, Other and All remain last even with custom categories', async () => {
  const { categoryViews } = await viewsModule(), result = categoryViews(library);
  assert.deepEqual(result.map((c) => c.id), ['recent-games', 'recent-apps', 'work', 'games', 'internet', 'custom', 'other', 'all']);
  assert.equal(result[0].virtual, true); assert.equal(result[1].virtual, true); assert.equal(result.at(-1).virtual, true);
});
test('history separates games and apps, orders newest first, omits never-launched entries and preserves the library', async () => {
  const { viewEntries } = await viewsModule(), before = JSON.stringify(library);
  assert.deepEqual(viewEntries(library, 'recent-games').map((e) => e.id), ['newGame', 'oldGame']);
  assert.deepEqual(viewEntries(library, 'recent-apps').map((e) => e.id), ['newApp', 'oldApp']);
  assert.equal(viewEntries(library, 'all').length, 5); assert.equal(JSON.stringify(library), before);
  const renamed = { categories: [{ id: 'customGames', name: 'Игры' }], entries: [{ id: 'game', category: 'customGames', lastLaunchedAt: 1 }] };
  assert.equal(viewEntries(renamed, 'recent-games').length, 1);
});
test('recent views never become import destinations; imports use an actual category', async () => {
  const { importCategory } = await viewsModule();
  assert.equal(importCategory(library, 'recent-games'), 'games'); assert.equal(importCategory(library, 'recent-apps'), 'work');
  assert.equal(importCategory(library, 'all'), 'work'); assert.equal(importCategory(library, 'custom'), 'custom');
  assert.equal(importCategory({ categories: [], entries: [] }, 'recent-games'), undefined);
});
