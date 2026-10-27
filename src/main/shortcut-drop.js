'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const RULES = [
  ['games', /roblox|steam|epic|minecraft|valorant|genshin|battle[ .-]?net|игр/iu],
  ['work', /code|studio|office|word|excel|powerpoint|photoshop|blender|figma|notion|obsidian|работ/iu],
  ['internet', /chrome|firefox|edge|opera|browser|браузер|telegram|discord|whatsapp|яндекс|yandex/iu],
];
function suggestCategory(name, library) {
  const previous = library.entries.find((e) => e.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const id = previous?.category || RULES.find(([, re]) => re.test(name))?.[0] || 'other';
  return library.categories.find((c) => c.id === id)?.id || library.categories[0]?.id;
}
// Paths stay in main. Preparing or cancelling a drop never modifies a file.
class ShortcutDrop {
  constructor(store) { this.store = store; this.pending = null; }
  prepare(files) {
    if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error('Перетащи от 1 до 100 ярлыков .lnk или .url.');
    const library = this.store.list();
    const items = [...new Set(files)].map((file) => {
      if (typeof file !== 'string' || file.length > 32767 || !path.isAbsolute(file) || !/\.(lnk|url)$/i.test(file)) throw new Error('Нужны файлы ярлыков .lnk или .url. Приложения и папки не переносятся.');
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Нужен обычный файл ярлыка.');
      const name = path.basename(file, path.extname(file));
      return { id: randomUUID(), name, category: suggestCategory(name, library), file };
    });
    this.pending = { id: randomUUID(), items };
    return this.view();
  }
  view() { return this.pending ? { id: this.pending.id, items: this.pending.items.map(({ file, ...item }) => item) } : null; }
  cancel() { this.pending = null; }
  commit(id, choices) {
    const pending = this.pending;
    if (!pending || id !== pending.id) throw new Error('Этот перенос уже закрыт. Перетащи ярлык ещё раз.');
    if (!Array.isArray(choices) || choices.length !== pending.items.length || choices.some((c) => !c || typeof c.id !== 'string' || typeof c.category !== 'string') || new Set(choices.map((c) => c.id)).size !== choices.length) throw new Error('Некорректный выбор категорий.');
    const selected = pending.items.map((item) => {
      const choice = choices.find((c) => c.id === item.id);
      if (!choice) throw new Error('Выбери категорию для каждого ярлыка.');
      this.store.category(choice.category); return { ...item, category: choice.category };
    });
    this.pending = null; // Consume before any import; duplicate clicks cannot import twice.
    return selected.map((item) => {
      try { return { ok: true, ...this.store.importOne(item.file, item.category) }; }
      catch (err) { return { ok: false, name: item.name, error: err.message }; }
    });
  }
}
module.exports = { ShortcutDrop, suggestCategory };
