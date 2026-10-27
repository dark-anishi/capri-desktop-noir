'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_CATEGORIES = [
  { id: 'work', name: 'Работа' }, { id: 'games', name: 'Игры' },
  { id: 'internet', name: 'Интернет' }, { id: 'other', name: 'Другое' },
];
const EXTENSIONS = new Set(['.lnk', '.url']);

// Shortcut files live in our own folder. Executables and application data are never moved.
class LauncherStore {
  constructor(root, desktopDirs) {
    this.root = path.resolve(root);
    this.desktopDirs = desktopDirs.filter(Boolean).map((p) => path.resolve(p));
    this.file = path.join(this.root, 'library.json');
    this.shortcuts = path.join(this.root, 'shortcuts');
    fs.mkdirSync(this.shortcuts, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(this.state.categories) || !Array.isArray(this.state.entries)) throw new Error('Повреждена библиотека ярлыков. Файлы сохранены в папке Capri.');
    } else {
      this.state = { categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), entries: [] };
    }
    // Older libraries contain only applications. Folders are references, never managed files.
    if (this.state.folders !== undefined && !Array.isArray(this.state.folders)) throw new Error('Повреждён список папок.');
    this.state.folders ||= [];
  }

  save(next) {
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(next, null, 2));
    fs.renameSync(temp, this.file);
    this.state = next;
  }

  list() { return structuredClone(this.state); }

  recordLaunch(id) {
    this.entry(id);
    const latest = this.state.entries.reduce((max, e) => Number.isFinite(e.lastLaunchedAt) ? Math.max(max, e.lastLaunchedAt) : max, 0);
    const lastLaunchedAt = Math.max(Date.now(), latest + 1);
    this.save({ ...this.state, entries: this.state.entries.map((e) => e.id === id ? { ...e, lastLaunchedAt } : e) });
  }

  entry(id) {
    const entry = this.state.entries.find((e) => e.id === id);
    if (!entry) throw new Error('Ярлык не найден.');
    return entry;
  }

  entryPath(entry) {
    if (!/^[a-f0-9-]+\.(lnk|url)$/i.test(entry.file)) throw new Error('Неверное имя файла ярлыка.');
    return path.join(this.shortcuts, entry.file);
  }

  category(id) {
    if (!this.state.categories.some((c) => c.id === id)) throw new Error('Категория не найдена.');
  }

  addCategory(name) {
    name = String(name || '').trim().slice(0, 40);
    if (!name) throw new Error('Введи название категории.');
    if (this.state.categories.some((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Такая категория уже есть.');
    const category = { id: randomUUID(), name };
    this.save({ ...this.state, categories: [...this.state.categories, category] });
    return category;
  }

  removeCategory(id) {
    this.category(id);
    if (this.state.categories.length === 1) throw new Error('Оставь хотя бы одну категорию.');
    if (this.state.entries.some((e) => e.category === id)) throw new Error('Сначала перенеси ярлыки в другую категорию.');
    this.save({ ...this.state, categories: this.state.categories.filter((c) => c.id !== id) });
  }

  move(id, category) {
    this.entry(id);
    this.category(category);
    this.save({ ...this.state, entries: this.state.entries.map((e) => e.id === id ? { ...e, category } : e) });
  }

  reorder(id, beforeId, collection = 'entries') {
    if (!['entries', 'folders'].includes(collection) || typeof id !== 'string' || (beforeId !== null && typeof beforeId !== 'string')) throw new Error('Некорректный порядок ярлыков.');
    const items = this.state[collection];
    const entry = items.find((item) => item.id === id);
    if (!entry || (beforeId !== null && !items.some((item) => item.id === beforeId))) throw new Error('Ярлык не найден.');
    if (id === beforeId) return;
    const next = items.filter((item) => item.id !== id);
    next.splice(beforeId === null ? next.length : next.findIndex((item) => item.id === beforeId), 0, entry);
    this.save({ ...this.state, [collection]: next });
  }

  folder(id) {
    const entry = this.state.folders.find((item) => item.id === id);
    if (!entry) throw new Error('Папка не найдена.');
    return entry;
  }

  folderPath(entry) {
    if (typeof entry.target !== 'string' || !path.isAbsolute(entry.target) || !fs.statSync(entry.target).isDirectory()) throw new Error('Папка больше недоступна.');
    return entry.target;
  }

  importFolder(source, resolveShortcut) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('Перетащи папку или её ярлык из Проводника.');
    source = path.resolve(source);
    const stat = fs.lstatSync(source);
    let target = source;
    if (stat.isFile() && path.extname(source).toLowerCase() === '.lnk') {
      const details = resolveShortcut(source);
      target = details?.target;
      if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('В ярлыке не указан путь к папке.');
    } else if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Нужна папка или ярлык .lnk, который открывает папку.');
    target = fs.realpathSync(target);
    if (!fs.statSync(target).isDirectory()) throw new Error('Этот ярлык ведёт не к папке.');
    if (this.state.folders.some((item) => item.target.toLowerCase() === target.toLowerCase())) throw new Error('Эта папка уже добавлена.');
    const name = stat.isFile() ? path.basename(source, path.extname(source)) : path.basename(source) || source;
    const entry = { id: randomUUID(), name, source, target };
    this.save({ ...this.state, folders: [...this.state.folders, entry] });
    return { entry };
  }

  removeFolder(id) {
    this.folder(id);
    this.save({ ...this.state, folders: this.state.folders.filter((item) => item.id !== id) });
  }

  importOne(source, category) {
    this.category(category);
    if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('Перетащи файл ярлыка из Проводника.');
    source = path.resolve(source);
    const ext = path.extname(source).toLowerCase();
    if (!EXTENSIONS.has(ext)) throw new Error('Поддерживаются ярлыки .lnk и .url. Сначала создай ярлык приложения.');
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Нужен обычный файл ярлыка.');
    const realSource = fs.realpathSync(source);
    if (realSource.toLowerCase().startsWith(fs.realpathSync(this.root).toLowerCase() + path.sep)) throw new Error('Этот ярлык уже хранится у Capri.');
    if (this.state.entries.some((e) => e.source.toLowerCase() === source.toLowerCase())) throw new Error('Этот ярлык уже добавлен.');
    const id = randomUUID();
    const entry = { id, name: path.basename(source, path.extname(source)), category, source, file: id + ext, desktop: false };
    const dest = this.entryPath(entry);
    fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
    // Commit a durable copy before touching the desktop. A failed save leaves the source intact.
    try { this.save({ ...this.state, entries: [...this.state.entries, entry] }); }
    catch (err) { fs.unlinkSync(dest); throw err; }
    let warning = '';
    const fromDesktop = this.desktopDirs.some((dir) => {
      try { return fs.realpathSync(dir).toLowerCase() === path.dirname(realSource).toLowerCase(); }
      catch { return false; }
    });
    if (fromDesktop) {
      // Keep the origin in metadata first, so a restart can still restore a moved shortcut.
      this.save({ ...this.state, entries: this.state.entries.map((e) => e.id === id ? { ...e, desktop: true } : e) });
      try {
        if (!fs.readFileSync(source).equals(fs.readFileSync(dest))) throw new Error('Ярлык изменился во время переноса.');
        fs.unlinkSync(source);
      } catch (err) { warning = `Ярлык добавлен, но остался на рабочем столе: ${err.message}`; }
    }
    return { entry: this.entry(id), warning };
  }

  restore(id) {
    const entry = this.entry(id);
    const stored = this.entryPath(entry);
    let dest = entry.desktop ? entry.source : path.join(this.desktopDirs[0], entry.name + path.extname(entry.file));
    const copy = () => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) {
        if (!fs.readFileSync(dest).equals(fs.readFileSync(stored))) { const collision = new Error('На рабочем столе уже есть другой ярлык с таким именем. Переименуй его и повтори.'); collision.code = 'EEXIST'; throw collision; }
      } else fs.copyFileSync(stored, dest, fs.constants.COPYFILE_EXCL);
    };
    try { copy(); }
    catch (err) {
      if (!['EPERM', 'EACCES', 'EROFS', 'EEXIST'].includes(err.code) || path.dirname(dest).toLowerCase() === this.desktopDirs[0].toLowerCase()) throw err;
      // Public Desktop is protected. A personal desktop shortcut launches the same app.
      dest = path.join(this.desktopDirs[0], entry.name + path.extname(entry.file));
      if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(fs.readFileSync(stored))) {
        let suffix = 2;
        do { dest = path.join(this.desktopDirs[0], `${entry.name} (${suffix++})${path.extname(entry.file)}`); } while (fs.existsSync(dest));
      }
      copy();
    }
    this.save({ ...this.state, entries: this.state.entries.filter((e) => e.id !== id) });
    try { fs.unlinkSync(stored); } catch { /* the restored desktop copy is already committed */ }
    return dest;
  }
}

module.exports = { LauncherStore };
