import { createVpnUI } from './vpn.js';
import { RECENT_GAMES, RECENT_APPS, isRecent, categoryViews, viewEntries, importCategory } from './library-views.js';
const api = window.launcher;
const vpnUI = createVpnUI(api.vpn);
const $ = (id) => document.getElementById(id);
let library = { categories: [], entries: [], folders: [] };
let activeCategory = RECENT_GAMES;
let busy = false;
let activeTab = 'apps';
let layoutFrame = 0;
let menuAnchor = null;
let pendingDrop = null;
function musicLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    const rect = $('music-surface').getBoundingClientRect();
    api.musicLayout(activeTab === 'music', activeTab === 'music' ? { x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 } : null)
      .then((result) => { if (!result.ok) status(result.error, true); }).catch((err) => status(err.message, true));
  });
}

function status(message, error = false) {
  $('status').textContent = error ? message : '';
  document.querySelector('footer').hidden = !error;
  document.querySelector('footer').classList.toggle('error', error);
}
function tab(name) {
  closeContext();
  if (!['apps', 'folders', 'music', 'vpn', 'skins'].includes(name)) name = 'apps';
  activeTab = name;
  document.querySelectorAll('.page').forEach((page) => { page.hidden = page.id !== name; page.classList.toggle('active', page.id === name); });
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  musicLayout();
  if (name === 'vpn') vpnUI.open();
}

function closeContext(restoreFocus = false) {
  $('shortcut-menu').hidden = true;
  if (restoreFocus && menuAnchor?.isConnected) menuAnchor.focus();
}

function contextMenu(event, build) {
  event.preventDefault(); event.stopPropagation();
  const menu = $('shortcut-menu');
  menuAnchor = event.currentTarget.querySelector?.('.entry-launch') || event.currentTarget;
  menu.replaceChildren();
  const item = (label, action, { checked = false, disabled = false } = {}) => {
    const button = document.createElement('button');
    button.type = 'button'; button.setAttribute('role', 'menuitem');
    button.textContent = (checked ? '✓  ' : '') + label; button.disabled = disabled;
    button.addEventListener('click', action); menu.append(button);
    return button;
  };
  const separator = () => { const line = document.createElement('div'); line.className = 'menu-separator'; line.setAttribute('role', 'separator'); menu.append(line); };
  const fill = (fn) => { menu.replaceChildren(); fn(); place(); menu.querySelector('button:not(:disabled)')?.focus(); };
  const place = () => {
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 12))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 12))}px`;
  };
  build({ item, separator, fill });
  menu.hidden = false; place();
  menu.querySelector('button:not(:disabled)')?.focus();
}

function shortcutMenu(event, entry) {
  contextMenu(event, ({ item, separator, fill }) => {
    const actions = () => {
      item('Открыть', () => { closeContext(); perform(() => api.launch(entry.id)); });
      item('Переместить в категорию…', () => fill(() => {
        item('← Назад', () => fill(actions)); separator();
        for (const category of library.categories) item(category.name, () => {
          closeContext(); perform(() => api.move(entry.id, category.id));
        }, { checked: category.id === entry.category, disabled: category.id === entry.category });
      }));
      separator();
      item('Вернуть на рабочий стол', () => { closeContext(); perform(() => api.restore(entry.id)); });
    };
    actions();
  });
}
function apply(result) {
  if (!result.ok) { status(result.error, true); return false; }
  if (result.state) { library = result.state; render(); }
  if (Object.hasOwn(result, 'pendingDrop')) renderDrop(result.pendingDrop);
  if (result.config) {
    document.documentElement.dataset.skin = result.config.skin;
    document.querySelectorAll('[data-skin]').forEach((card) => {
      const selected = card.dataset.skin === result.config.skin;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
      card.querySelector('em').textContent = selected ? 'Выбран' : 'Выбрать';
    });
  }
  return true;
}
async function perform(fn, message) {
  if (busy) return;
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
  $('drop-confirm').disabled = $('drop-cancel').disabled = true;
  try {
    const result = await fn();
    if (apply(result)) status(message || '');
    return result;
  } catch (err) { status(err.message, true); }
  finally { busy = false; document.body.removeAttribute('aria-busy'); $('drop-confirm').disabled = $('drop-cancel').disabled = false; }
}

function dropTarget(element, category) {
  element.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; element.classList.add('drag-over'); });
  element.addEventListener('dragleave', (event) => { if (!element.contains(event.relatedTarget)) element.classList.remove('drag-over'); });
  element.addEventListener('drop', async (event) => {
    event.preventDefault(); event.stopPropagation(); element.classList.remove('drag-over');
    const target = category || importCategory(library, activeCategory);
    if (!target) return status('Сначала создай категорию.', true);
    const id = event.dataTransfer.getData('application/x-capri-id');
    if (id) return perform(() => api.move(id, target), 'Перенесла в другую категорию.');
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return status('Перетащи файл ярлыка с рабочего стола или из Проводника.', true);
    // Resolve File objects in preload before awaiting: the browser releases the drag data afterwards.
    await importResult(() => api.importFiles(files, target));
  });
}

// Card drops change saved order; category drops keep their existing move semantics.
function reorderTarget(card, entry, visible, folders = false, enabled = true) {
  const type = folders ? 'application/x-capri-folder-id' : 'application/x-capri-id';
  const clear = () => card.classList.remove('reorder-before', 'reorder-after');
  const after = (event) => event.clientX > card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2;
  card.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes(type)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = enabled ? 'move' : 'none';
    clear();
    if (enabled) card.classList.add(after(event) ? 'reorder-after' : 'reorder-before');
  });
  card.addEventListener('dragleave', (event) => { if (!card.contains(event.relatedTarget)) clear(); });
  card.addEventListener('drop', (event) => {
    const id = event.dataTransfer.getData(type);
    if (!id) return;
    event.preventDefault(); event.stopPropagation(); clear();
    if (!enabled || id === entry.id) return;
    const beforeId = after(event) ? visible[visible.findIndex((item) => item.id === entry.id) + 1]?.id || null : entry.id;
    perform(() => folders ? api.folders.reorder(id, beforeId) : api.reorder(id, beforeId));
  });
}

function folderMenu(event, entry) {
  contextMenu(event, ({ item, separator }) => {
    item('Открыть', () => { closeContext(); perform(() => api.folders.open(entry.id)); });
    separator();
    item('Убрать из меню', () => { closeContext(); perform(() => api.folders.remove(entry.id)); });
  });
}

function renderFolders() {
  const folders = library.folders || [];
  $('folder-count').textContent = folders.length;
  $('folder-empty').hidden = folders.length > 0;
  $('folder-entries').replaceChildren();
  for (const entry of folders) {
    const card = document.createElement('article'); card.className = 'entry'; card.draggable = true; card.dataset.id = entry.id;
    card.addEventListener('dragstart', (event) => { closeContext(); event.dataTransfer.setData('application/x-capri-folder-id', entry.id); event.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('contextmenu', (event) => folderMenu(event, entry));
    reorderTarget(card, entry, folders, true);
    const launch = document.createElement('button'); launch.className = 'entry-launch'; launch.title = `Открыть ${entry.name}`;
    const icon = document.createElement('img'); icon.src = entry.icon || '../../assets/icons/capri-mono.png'; icon.alt = ''; icon.draggable = false;
    const name = document.createElement('strong'); name.textContent = entry.name; launch.append(icon, name);
    launch.addEventListener('click', () => perform(() => api.folders.open(entry.id)));
    launch.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const rect = launch.getBoundingClientRect();
        folderMenu({ preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation(), currentTarget: card, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, entry);
      }
    });
    card.append(launch); $('folder-entries').append(card);
  }
}

async function importFolders(fn) {
  const result = await perform(fn);
  if (!result?.ok) return;
  const errors = result.results.filter((item) => !item.ok).map((item) => `${item.name}: ${item.error}`);
  status(errors.join(' '), Boolean(errors.length));
}
const folderLibrary = document.querySelector('.folder-library');
folderLibrary.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; folderLibrary.classList.add('drag-over'); });
folderLibrary.addEventListener('dragleave', (event) => { if (!folderLibrary.contains(event.relatedTarget)) folderLibrary.classList.remove('drag-over'); });
folderLibrary.addEventListener('drop', (event) => {
  event.preventDefault(); event.stopPropagation(); folderLibrary.classList.remove('drag-over');
  if (event.dataTransfer.getData('application/x-capri-folder-id')) return;
  const files = Array.from(event.dataTransfer.files);
  if (!files.length) return status('Перетащи папку или её ярлык из Проводника.', true);
  importFolders(() => api.folders.importFiles(files));
});
$('add-folders').onclick = async () => {
  const chosen = await api.folders.choose();
  if (!chosen.ok) return status(chosen.error, true);
  if (chosen.files.length) await importFolders(() => api.folders.importPaths(chosen.files));
};

async function importResult(fn) {
  const result = await perform(fn);
  if (!result?.ok) return;
  const errors = result.results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`);
  const warnings = result.results.filter((r) => r.warning).map((r) => r.warning);
  const count = result.results.filter((r) => r.ok).length;
  if (count && isRecent(activeCategory)) { activeCategory = result.results.find((r) => r.ok)?.entry?.category || 'all'; render(); }
  status([count ? `Добавлено: ${count}. Ярлыки с рабочего стола перенесены в библиотеку.` : '', ...warnings, ...errors].filter(Boolean).join(' '), Boolean(errors.length || warnings.length));
}

function renderDrop(pending) {
  // Refreshes must not overwrite choices the user has already made.
  if (pending && pendingDrop?.id === pending.id) return;
  pendingDrop = pending;
  $('drop-assistant').hidden = !pending;
  $('drop-items').replaceChildren();
  if (!pending) return;
  tab('apps');
  for (const item of pending.items) {
    const row = document.createElement('label'); row.className = 'drop-item';
    const name = document.createElement('span'); name.textContent = item.name;
    const select = document.createElement('select'); select.dataset.id = item.id;
    select.setAttribute('aria-label', `Категория для ${item.name}`);
    for (const category of library.categories) {
      const option = document.createElement('option'); option.value = category.id; option.textContent = category.name; select.append(option);
    }
    select.value = item.category; row.append(name, select); $('drop-items').append(row);
  }
  $('drop-assistant').scrollIntoView({ block: 'nearest' });
}
$('drop-confirm').addEventListener('click', () => {
  if (!pendingDrop) return;
  const choices = [...$('drop-items').querySelectorAll('select')].map((select) => ({ id: select.dataset.id, category: select.value }));
  importResult(() => api.confirmDrop(pendingDrop.id, choices));
});
$('drop-cancel').addEventListener('click', () => perform(() => api.cancelDrop()));

function render() {
  closeContext();
  renderFolders();
  const categories = categoryViews(library);
  if (!categories.some((c) => c.id === activeCategory)) activeCategory = RECENT_GAMES;
  $('categories').replaceChildren();
  for (const category of categories) {
    const button = document.createElement('button');
    button.className = 'category'; button.dataset.category = category.id;
    button.classList.toggle('selected', category.id === activeCategory);
    const title = document.createElement('span'); title.textContent = category.name;
    const count = document.createElement('small'); count.textContent = viewEntries(library, category.id).length;
    button.append(title, count);
    button.addEventListener('click', () => { activeCategory = category.id; render(); });
    if (!category.virtual) {
      dropTarget(button, category.id);
      button.addEventListener('contextmenu', (event) => contextMenu(event, ({ item }) => {
        item('Удалить категорию', () => { closeContext(); perform(() => api.removeCategory(category.id)); });
      }));
    }
    $('categories').append(button);
  }
  const visible = viewEntries(library, activeCategory);
  $('category-title').textContent = categories.find((c) => c.id === activeCategory)?.name || '';
  $('count').textContent = visible.length;
  $('entries').replaceChildren();
  $('empty').hidden = visible.length > 0;
  $('empty').querySelector('span').textContent = isRecent(activeCategory) ? 'Здесь появятся последние запуски' : 'Перетащи ярлыки сюда';
  $('empty').querySelector('small').textContent = activeCategory === RECENT_GAMES ? 'Запускай игры из категории «Игры» через Capri' : activeCategory === RECENT_APPS ? 'Запускай приложения из остальных категорий через Capri' : 'или добавь через «+ Ярлыки»';
  for (const entry of visible) {
    const card = document.createElement('article'); card.className = 'entry'; card.draggable = true; card.dataset.id = entry.id;
    card.addEventListener('dragstart', (event) => { closeContext(); event.dataTransfer.setData('application/x-capri-id', entry.id); event.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('contextmenu', (event) => shortcutMenu(event, entry));
    reorderTarget(card, entry, visible, false, !isRecent(activeCategory));
    const launch = document.createElement('button'); launch.className = 'entry-launch'; launch.title = `Запустить ${entry.name}`;
    const icon = document.createElement('img'); icon.src = entry.icon || '../../assets/icons/capri-mono.png'; icon.alt = ''; icon.draggable = false; launch.append(icon);
    const name = document.createElement('strong'); name.textContent = entry.name; launch.append(name);
    launch.addEventListener('click', () => perform(() => api.launch(entry.id)));
    launch.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const rect = launch.getBoundingClientRect();
        shortcutMenu({ preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation(), currentTarget: card, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, entry);
      }
    });
    card.append(launch); $('entries').append(card);
  }
}

$('close').onclick = () => api.close();
$('minimize').onclick = () => api.minimize();
$('settings').onclick = () => api.settings();
document.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => tab(button.dataset.tab); });
document.querySelectorAll('[data-skin]').forEach((button) => { button.onclick = () => perform(() => api.skin(button.dataset.skin), 'Новый образ сохранён.'); });
$('category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await perform(() => api.addCategory($('category-name').value));
  if (result?.ok) { activeCategory = result.category.id; $('category-name').value = ''; categoryForm(false); render(); status(''); }
});
function categoryForm(show) {
  $('category-form').hidden = !show;
  $('add-category').setAttribute('aria-expanded', String(show));
  if (show) $('category-name').focus();
}
$('add-category').onclick = () => categoryForm($('category-form').hidden);
$('cancel-category').onclick = () => categoryForm(false);
dropTarget($('dropzone'));
dropTarget($('entries'));
dropTarget(document.querySelector('.library'));
const choose = async () => {
  const chosen = await api.choose();
  if (chosen.ok && chosen.files.length) await importResult(() => api.importPaths(chosen.files, importCategory(library, activeCategory)));
};
$('dropzone').onclick = choose;
$('dropzone').onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } };
$('music-back').onclick = () => api.musicAction('back');
$('music-reload').onclick = () => api.musicAction('reload');
$('music-expand').onclick = () => api.musicAction('expand');
api.onMusicState((state) => {
  $('music-back').disabled = !state.canGoBack;
  $('music-loading').hidden = state.ready;
  $('music-state').textContent = state.error || 'Загружаю Яндекс Музыку…';
  if (activeTab === 'music') status(state.error || (state.loading ? 'Загружаю Яндекс Музыку…' : 'Плеер готов. Вход в аккаунт сохранится после перезапуска.'), Boolean(state.error));
});
new ResizeObserver(musicLayout).observe($('music-surface'));
window.addEventListener('resize', () => { closeContext(); musicLayout(); });
window.addEventListener('pointerdown', (event) => { if (!$('shortcut-menu').contains(event.target)) closeContext(); });
window.addEventListener('blur', () => closeContext());
document.querySelectorAll('.library').forEach((element) => element.addEventListener('scroll', () => closeContext()));
window.addEventListener('dragend', () => document.querySelectorAll('.drag-over, .reorder-before, .reorder-after').forEach((element) => element.classList.remove('drag-over', 'reorder-before', 'reorder-after')));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('shortcut-menu').hidden) { event.preventDefault(); closeContext(true); }
    else if (pendingDrop) perform(() => api.cancelDrop());
    else if (!$('category-form').hidden) categoryForm(false);
    else api.close();
  }
  if (!$('shortcut-menu').hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...$('shortcut-menu').querySelectorAll('button:not(:disabled)')];
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(buttons.indexOf(document.activeElement) + step + buttons.length) % buttons.length]?.focus();
  }
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
api.onTab((name) => { tab(name); perform(() => api.state()); });
api.onRefresh(() => { if (!busy) perform(() => api.state()); });
tab(new URLSearchParams(location.search).get('tab') || 'apps');
perform(() => api.state());
