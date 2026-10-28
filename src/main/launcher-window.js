'use strict';
const path = require('node:path');
const { app, BrowserWindow, screen, ipcMain, shell, dialog, nativeImage } = require('electron');
const { LauncherStore } = require('./launcher-store');
const { ShortcutDrop } = require('./shortcut-drop');
const { createMusic } = require('./music');
const { createShortcutIcons } = require('./shortcut-icons');
const { dispatch: vpnDispatch } = require('./vpn/ipc');
const { createQuickMenu } = require('./quick-menu');
const { createVpnNarrator } = require('./vpn/speech');
const MENU_SIZE = { width: 1065, height: 930 }; // 1.5 × the original 710 × 620

function createLauncher({ config, rendererConfig, updateConfig, sendCommand, openSettings, getVpn, getZapret, getPetState = () => ({}), preparePin = () => {} }) {
  let win = null;
  let store = null;
  let drops = null;
  const getDrops = () => drops ||= new ShortcutDrop(getStore());
  let music = null;
  let musicVisible = false;
  let musicPlaying = false;
  const iconFor = createShortcutIcons({ app, shell, nativeImage });
  const getStore = () => store ||= new LauncherStore(path.join(app.getPath('userData'), 'launcher'), [
    app.getPath('desktop'), process.env.PUBLIC && path.join(process.env.PUBLIC, 'Desktop'),
  ]);
  const speak = (action, details = {}) => sendCommand('launcherSpeech', { action, ...details });
  const vpnNarrate = createVpnNarrator(speak);

  async function state() {
    const data = getStore().list();
    data.entries = await Promise.all(data.entries.map(async (entry) => {
      let icon = '';
      try {
        icon = await iconFor(getStore().entryPath(entry), entry.source);
      } catch { /* a removed application still has a restorable shortcut */ }
      const { source, file, ...visible } = entry;
      return { ...visible, icon };
    }));
    data.folders = await Promise.all(data.folders.map(async (entry) => {
      let icon = '';
      try { icon = await iconFor(entry.source); }
      catch { try { icon = await iconFor(entry.target); } catch { /* offline folders retain their reference */ } }
      return { id: entry.id, name: entry.name, icon };
    }));
    return { state: data, config: rendererConfig(), pet: getPetState(), pendingDrop: getDrops().view() };
  }

  function open(tab = 'apps') {
    quick.hide();
    preparePin();
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const width = Math.min(MENU_SIZE.width, area.width);
    const height = Math.min(MENU_SIZE.height, area.height);
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width, height, minWidth: Math.min(500, width), minHeight: Math.min(430, height),
        x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2),
        frame: false, resizable: true, minimizable: true, alwaysOnTop: false, backgroundColor: '#393939',
        show: false, skipTaskbar: false, title: 'Capri',
        icon: path.join(__dirname, '../../assets/icons/capri-mono.png'),
        webPreferences: { preload: path.join(__dirname, '../launcher-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      music = createMusic({ window: win, initialVolume: config.load().musicVolume ?? .7, onVolume: (value) => config.save({ musicVolume: value }), onState: (state) => {
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('launcher:music-state', state);
        quick.refresh();
        if (musicPlaying !== state.playing) { musicPlaying = Boolean(state.playing); sendCommand('musicPlayback', { playing: musicPlaying }); }
      } });
      win.on('closed', () => { drops?.cancel(); music?.close(); music = null; musicVisible = false; win = null; });
      win.loadURL(`capri://app/src/launcher/index.html?tab=${encodeURIComponent(tab)}`);
      win.once('ready-to-show', () => { win?.show(); win?.focus(); });
    } else {
      win.webContents.send('launcher:tab', tab);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    const [currentW, currentH] = win.getSize();
    if (currentW > area.width || currentH > area.height) win.setSize(Math.min(currentW, area.width), Math.min(currentH, area.height));
    const [w, h] = win.getSize();
    win.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + (area.height - h) / 2));
    speak('open');
  }

  function handle(name, fn) {
    ipcMain.handle(`launcher:${name}`, async (event, ...args) => {
      if (!win || event.sender !== win.webContents) throw new Error('Invalid launcher sender');
      try { return { ok: true, ...await fn(...args) }; }
      catch (err) { speak(name === 'launch' ? 'launchError' : 'error', { error: err.message }); return { ok: false, error: err.message }; }
    });
  }
  handle('state', state);
  handle('close', () => { drops?.cancel(); win?.hide(); return {}; });
  handle('minimize', () => { win?.minimize(); return {}; });
  handle('settings', () => { openSettings(win); return {}; });
  function setPinned(pinned) {
    if (typeof pinned !== 'boolean') throw new Error('Некорректное закрепление.');
    if (pinned && !getPetState().canPin) throw new Error('Сначала посади Capri на край подходящего окна.');
    win?.hide(); sendCommand('pinWindow', { pinned }); return {};
  }
  function setRest(sleeping) {
    if (typeof sleeping !== 'boolean') throw new Error('Некорректное состояние отдыха.');
    if (sleeping && !getPetState().canRest) throw new Error('Сейчас Capri занята.');
    win?.hide(); sendCommand('petRest', { sleeping }); return {};
  }
  handle('pin-window', setPinned);
  handle('pet-rest', setRest);
  handle('vpn', (action, payload) => vpnDispatch(getVpn(), action, payload, { dialog, window: win }));
  handle('import', async (files, category) => {
    if (!Array.isArray(files) || files.length > 100) throw new Error('За один раз можно добавить до 100 ярлыков.');
    const results = files.map((file) => {
      try { return { ok: true, ...getStore().importOne(file, category) }; }
      catch (err) { return { ok: false, name: path.basename(String(file)), error: err.message }; }
    });
    const count = results.filter((r) => r.ok).length;
    if (count) speak('added', { count });
    return { ...await state(), results };
  });
  handle('drop-cancel', async () => { getDrops().cancel(); return state(); });
  handle('drop-confirm', async (id, choices) => {
    const results = getDrops().commit(id, choices);
    const count = results.filter((r) => r.ok).length;
    if (count) speak('added', { count });
    return { ...await state(), results };
  });
  handle('choose', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Добавить ярлыки', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Ярлыки приложений', extensions: ['lnk', 'url'] }] });
    return { files: result.canceled ? [] : result.filePaths };
  });
  handle('category-add', async (name) => ({ category: getStore().addCategory(name), ...await state() }));
  handle('category-remove', async (id) => { getStore().removeCategory(id); return state(); });
  handle('move', async (id, category) => { getStore().move(id, category); return state(); });
  handle('reorder', async (id, beforeId) => { getStore().reorder(id, beforeId); return state(); });
  handle('folder-import', async (files) => {
    if (!Array.isArray(files) || files.length > 100) throw new Error('За один раз можно добавить до 100 папок.');
    const results = files.map((file) => {
      try { return { ok: true, ...getStore().importFolder(file, (source) => shell.readShortcutLink(source)) }; }
      catch (err) { return { ok: false, name: path.basename(String(file)), error: err.message }; }
    });
    // Renderer receives identifiers and captions, never filesystem paths.
    return { ...await state(), results: results.map((result) => result.ok ? { ok: true, entry: { id: result.entry.id, name: result.entry.name } } : result) };
  });
  handle('folder-choose', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Добавить папки', properties: ['openDirectory', 'multiSelections'] });
    return { files: result.canceled ? [] : result.filePaths };
  });
  handle('folder-reorder', async (id, beforeId) => { getStore().reorder(id, beforeId, 'folders'); return state(); });
  handle('folder-remove', async (id) => { getStore().removeFolder(id); return state(); });
  handle('folder-open', async (id) => {
    const entry = getStore().folder(id);
    const error = await shell.openPath(getStore().folderPath(entry));
    if (error) throw new Error(error);
    win?.hide();
    return {};
  });
  handle('restore', async (id) => {
    getStore().restore(id);
    return state();
  });
  handle('launch', async (id) => {
    const entry = getStore().entry(id);
    const error = await shell.openPath(getStore().entryPath(entry));
    if (error) throw new Error(error);
    getStore().recordLaunch(id);
    win?.hide();
    speak('launched', { app: entry.name });
    return state();
  });
  handle('skin', async (skin) => {
    if (!['classic', 'mono'].includes(skin)) throw new Error('Неизвестный скин.');
    updateConfig({ skin });
    speak('skin', { skin });
    return state();
  });
  handle('music-layout', (visible, bounds) => {
    if (visible && !musicVisible) speak('music');
    musicVisible = Boolean(visible);
    music.layout(Boolean(visible), bounds);
    return {};
  });
  handle('music-action', (action) => {
    if (action === 'expand') {
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      const [width] = win.getSize();
      const next = width < 1280 ? { width: Math.min(1420, area.width), height: Math.min(1050, area.height) } : { width: Math.min(MENU_SIZE.width, area.width), height: Math.min(MENU_SIZE.height, area.height) };
      win.setBounds({ ...next, x: Math.round(area.x + (area.width - next.width) / 2), y: Math.round(area.y + (area.height - next.height) / 2) });
    } else music.action(action);
    return {};
  });
  const quick = createQuickMenu({ BrowserWindow, ipcMain, screen, getVpn, getZapret, getPetState, open, pin: setPinned, rest: setRest,
    getMusicState: () => music?.state() || { ready: false, playing: false, volume: config.load().musicVolume ?? .7 },
    musicPrevious: () => music?.control('previous'), musicNext: () => music?.control('next'), musicVolume: (value) => music?.control('volume', value),
    musicToggle: () => { if (!music) throw new Error('Сначала открой Яндекс Музыку.'); return music.togglePlayback(); },
    onError: (err) => speak('error', { error: err.message }),
  });
  async function acceptDrop(files) {
    try {
      getDrops().prepare(files);
      open('apps');
      // Initial state includes the pending drop; refresh also reaches an existing window.
      win.webContents.send('launcher:refresh');
      speak('dropCategory');
      return { ok: true };
    } catch (err) { speak('error', { error: err.message }); return { ok: false, error: err.message }; }
  }
  return { open, openQuick: (window) => quick.show(window), hideQuick: () => quick.hide(), acceptDrop, petChanged: (state) => { win?.webContents.send('launcher:pet-state', state); quick.refresh(); }, vpnChanged: (state) => { win?.webContents.send('launcher:vpn-state', state); quick.refresh(); vpnNarrate(state); }, zapretChanged: () => quick.refresh(), configChanged: () => win?.webContents.send('launcher:refresh'), close: () => { quick.close(); win?.destroy(); } };
}
module.exports = { createLauncher };
