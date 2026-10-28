'use strict';
const path = require('node:path');
const label = (value) => String(value).replace(/[\r\n\t]/g, ' ');
function quickTemplate({ vpn, pet, music, zapret, busy = {} }, actions) {
  const connected = vpn?.phase === 'connected';
  const transitioning = busy.vpn || ['connecting', 'reconnecting'].includes(vpn?.phase);
  const favorites = new Set(vpn?.favorites || []);
  let groups = (vpn?.proxies || []).filter((p) => p.type === 'Selector' && p.all);
  // GLOBAL controls global mode; rule mode uses the profile's own selectors.
  groups = vpn?.settings?.mode === 'global' ? groups.filter((p) => p.name === 'GLOBAL') : groups.filter((p) => p.name !== 'GLOBAL');
  const saved = groups.map((group, g) => ({ label: label(group.name), submenu: group.all.filter((name) => favorites.has(name)).map((name, i) => ({
    id: `quick-favorite:${g}:${i}`, label: label(name), type: 'checkbox', checked: group.now === name,
    enabled: connected && !transitioning, click: () => actions.selectProxy(group.name, name),
  })) })).filter((g) => g.submenu.length);
  const locations = saved.length === 1 ? saved[0].submenu : saved;
  return [
    { id: 'quick-vpn-toggle', label: transitioning ? 'VPN — подключение…' : connected ? 'Отключить VPN' : 'Подключить VPN', enabled: Boolean(vpn?.activeId) && !transitioning, click: () => actions.vpnToggle(connected) },
    { label: 'Избранные локации', submenu: locations.length ? locations : [{ label: connected ? 'Добавь локации в избранное во вкладке VPN' : 'Подключи VPN, чтобы выбрать локацию', enabled: false }] },
    { id: 'quick-vpn-open', label: 'Настройки VPN', click: () => actions.open('vpn') },
    ...(zapret ? [
      { type: 'separator' },
      { id: 'quick-zapret-toggle', label: busy.zapret || ['starting', 'stopping'].includes(zapret.phase) ? 'Zapret — подожди…' : zapret.phase === 'running' ? 'Остановить Zapret' : 'Запустить Zapret', enabled: zapret.supported && !busy.zapret && !['starting', 'stopping'].includes(zapret.phase), click: () => actions.zapretToggle(zapret.phase === 'running') },
      { label: zapret.runningBat ? `Zapret · ${label(zapret.runningBat.replace(/\.bat$/i, ''))}` : 'Стратегии Zapret', submenu: [
        ...(zapret.batches || []).map((name, i) => ({ id: `quick-zapret-batch:${i}`, label: label(name.replace(/\.bat$/i, '')), type: 'checkbox', checked: (zapret.runningBat || zapret.lastBat) === name, enabled: !busy.zapret && !['starting', 'stopping'].includes(zapret.phase), click: () => actions.zapretSelect(name) })),
        ...(!zapret.batches?.length ? [{ label: 'Выбери папку Zapret', enabled: false }] : []),
        { id: 'quick-zapret-folder', label: 'Выбрать папку Zapret…', enabled: !busy.zapret && !['starting', 'running', 'stopping'].includes(zapret.phase), click: actions.zapretFolder },
      ] },
    ] : []),
    { type: 'separator' },
    { id: 'quick-music-open', label: 'Музыка', click: () => actions.open('music') },
    { id: 'quick-music-prev', label: 'Предыдущий трек', enabled: Boolean(music.ready) && !busy.music, click: actions.musicPrevious },
    { id: 'quick-music-toggle', label: music.playing ? 'Пауза' : 'Воспроизвести', enabled: Boolean(music.ready) && !busy.music, click: actions.musicToggle },
    { id: 'quick-music-next', label: 'Следующий трек', enabled: Boolean(music.ready) && !busy.music, click: actions.musicNext },
    { id: 'quick-volume', type: 'volume', label: 'Громкость', value: music.volume ?? .7, enabled: Boolean(music.ready) && !busy.music, click: actions.musicVolume },
    { type: 'separator' },
    { id: 'quick-pin', label: pet.pinned ? 'Открепить от окна' : 'Остаться здесь', type: 'checkbox', checked: pet.pinned, enabled: Boolean(pet.canPin) && !busy.pet, click: () => actions.pin(!pet.pinned) },
    { id: 'quick-rest', label: pet.sleeping ? 'Проснуться' : 'Подремать', enabled: Boolean(pet.canRest) && !busy.pet, click: () => actions.rest(!pet.sleeping) },
    { type: 'separator' },
    { id: 'quick-open', label: 'Открыть Capri', click: () => actions.open('apps') },
  ];
}
function createQuickMenu({ BrowserWindow, ipcMain, screen, getVpn, getZapret, getPetState, getMusicState, open, pin, rest, musicToggle, musicPrevious, musicNext, musicVolume, onError }) {
  let win = null, blurTimer = null, items = [], requested = false, lastSent = '', anchor = null, measuredHeight = 575;
  const busy = { vpn: false, zapret: false, music: false, pet: false };
  const hide = () => { requested = false; clearTimeout(blurTimer); win?.hide(); };
  const run = (group, fn) => async (...args) => {
    if (busy[group]) return;
    busy[group] = true; refresh();
    try { await fn(...args); } catch (err) { onError(err); }
    finally { busy[group] = false; refresh(); }
  };
  const actions = {
    open: (tab) => { hide(); open(tab); }, pin: run('pet', pin), rest: run('pet', rest), musicToggle: run('music', musicToggle),
    musicPrevious: run('music', musicPrevious), musicNext: run('music', musicNext), musicVolume: run('music', musicVolume),
    vpnToggle: run('vpn', (wasConnected) => { const vpn = getVpn(); return wasConnected ? vpn.stop() : vpn.start(); }),
    selectProxy: run('vpn', (group, name) => getVpn().selectProxy(group, name)),
    zapretToggle: run('zapret', (running) => running ? getZapret().stop() : getZapret().start()),
    zapretSelect: run('zapret', (name) => getZapret().select(name)),
    zapretFolder: run('zapret', () => getZapret().chooseFolder()),
  };
  function model() {
    let vpn = null, zapret = null;
    try { vpn = getVpn().state(); } catch { /* Settings remain available. */ }
    try { zapret = getZapret?.()?.state(); } catch { /* Optional Windows component. */ }
    items = quickTemplate({ vpn, zapret, pet: getPetState(), music: getMusicState(), busy }, actions);
    function visible(list) { return list.map(({ click, submenu, ...item }) => ({ ...item, ...(submenu ? { submenu: visible(submenu) } : {}) })); }
    return { items: visible(items) };
  }
  function refresh() {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const state = model(), key = JSON.stringify(state);
    // VPN traffic ticks do not change this menu. Keep sliders and focus intact.
    if (key === lastSent) return;
    lastSent = key; win.webContents.send('quick:state', state);
  }
  function sender(event) { if (!win || event.sender !== win.webContents) throw new Error('Invalid quick menu sender'); }
  ipcMain.handle('quick:state', (event) => { sender(event); const state = model(); lastSent = JSON.stringify(state); return state; });
  ipcMain.handle('quick:close', (event) => { sender(event); hide(); });
  function resize(bounds) {
    // Windows pins the min/max size of non-resizable toolbars. Temporarily release
    // that constraint for our own measured layout, then restore the fixed frame.
    win.setResizable(true);
    try { win.setBounds(bounds); } finally { win.setResizable(false); }
  }
  ipcMain.handle('quick:fit', (event, height) => {
    sender(event);
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 1 || height > 4096) throw new Error('Некорректный размер меню.');
    measuredHeight = Math.max(200, Math.ceil(height));
    const point = anchor || screen.getCursorScreenPoint(), area = screen.getDisplayNearestPoint(point).workArea;
    const bounds = win.getBounds();
    const nextHeight = Math.min(area.height, measuredHeight);
    const y = Math.max(area.y, Math.min(area.y + area.height - nextHeight, point.y - 30));
    if (Math.abs(bounds.height - nextHeight) > 1 || bounds.y !== y) resize({ ...bounds, width: Math.min(310, area.width), y, height: nextHeight });
  });
  ipcMain.handle('quick:action', async (event, id, value) => {
    sender(event);
    if (typeof id !== 'string' || id.length > 100) throw new Error('Некорректный пункт меню.');
    const flatten = (list) => list.flatMap((item) => [item, ...flatten(item.submenu || [])]);
    model();
    const item = flatten(items).find((item) => item.id === id);
    if (!item?.click || item.enabled === false) throw new Error('Действие сейчас недоступно.');
    if (id === 'quick-volume') { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Некорректная громкость.'); }
    else if (value !== undefined) throw new Error('Пункт меню не принимает аргументы.');
    await item.click(value);
    return model();
  });
  function show() {
    clearTimeout(blurTimer);
    if (requested) { hide(); return; }
    requested = true;
    const point = screen.getCursorScreenPoint(), area = screen.getDisplayNearestPoint(point).workArea;
    anchor = point;
    // Reusing the window also reuses the renderer's fit cache. Keep its measured
    // height instead of restoring the initial placeholder on every opening.
    const width = Math.min(310, area.width), height = Math.min(measuredHeight, area.height);
    const preferredX = point.x + width + 18 <= area.x + area.width ? point.x + 18 : point.x - width - 18;
    const x = Math.max(area.x, Math.min(area.x + area.width - width, preferredX));
    const y = Math.max(area.y, Math.min(area.y + area.height - height, point.y - 30));
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({ width, height, x, y, frame: false, resizable: false, minimizable: false, maximizable: false,
        show: false, skipTaskbar: true, alwaysOnTop: true, type: process.platform === 'win32' ? 'toolbar' : undefined, backgroundColor: '#111111', title: 'Capri — быстрое меню',
        webPreferences: { preload: path.join(__dirname, '../quick-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      win.on('focus', () => clearTimeout(blurTimer));
      win.on('blur', () => { clearTimeout(blurTimer); blurTimer = setTimeout(hide, 140); });
      win.on('closed', () => { requested = false; win = null; clearTimeout(blurTimer); });
      win.once('ready-to-show', () => { if (requested) { win?.show(); win?.focus(); } });
      win.loadURL('capri://app/src/quick/index.html');
    } else { resize({ x, y, width, height }); win.show(); win.focus(); refresh(); }
  }
  return { show, refresh, hide, close: () => { requested = false; clearTimeout(blurTimer); win?.destroy(); win = null; } };
}
module.exports = { quickTemplate, createQuickMenu };
