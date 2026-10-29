'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, safeStorage, powerMonitor, dialog,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const { createGameMode, sameDisplay } = require('./game-mode');
const { createOverlayInput } = require('./overlay-input');
const hooks = require('../../scripts/install-hooks');
const demoSteps = require('../../scripts/demo-sequence');
const { createLauncher } = require('./launcher-window');
const { VpnManager } = require('./vpn/manager');
const { createZapret } = require('./zapret');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
if (DEV && process.env.CAPRI_TEST_DATA) {
  fs.mkdirSync(process.env.CAPRI_TEST_DATA, { recursive: true });
  app.setPath('userData', process.env.CAPRI_TEST_DATA);
}
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const CODEX_HELP = 'https://developers.openai.com/codex/quickstart';

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let overlayInput = null;
let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
let gameMode = null;
let launcher = null;
let vpn = null;
let zapret = null;
let petState = { pinned: false, canPin: false, sleeping: false, canRest: false };
let quitting = false;
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

function fitOverlay() {
  if (!overlay) return;
  const { workArea } = targetDisplay();
  overlay.setBounds(workArea);
  overlayInput?.reapply();
  if (lastWindows) gameMode?.update(lastWindows.gameMode, { covered: sameDisplay(targetDisplay().bounds, lastWindows.gameDisplay) });
  overlay.webContents.send('overlay:resize', { width: workArea.width, height: workArea.height });
}

function createOverlay() {
  const { workArea } = targetDisplay();
  overlay = new BrowserWindow({
    ...workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    icon: path.join(ROOT, 'assets/icons/capri-mono.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlayInput = createOverlayInput({ overlay, blocked: () => gameMode?.active === true, onRecover: () => sendCommand('recoverInput') });
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner
  overlay.once('ready-to-show', () => { gameMode?.sync(); if (!gameMode?.active) overlay.showInactive(); });
  overlay.webContents.on('did-finish-load', () => gameMode?.sync());
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendCommand(name, payload = {}) {
  if (overlay && !overlay.isDestroyed() && !overlay.webContents.isDestroyed()) overlay.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out of it.
function toggleVisible(force) {
  if (typeof force !== 'boolean' && gameMode?.toggleReveal()) {
    if (!gameMode.active) { config.save({ visible: true }); sendCommand('stow', { on: false }); }
    rebuildTray(); return;
  }
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function playDemo() {
  clearTimeout(demoTimer);
  let i = 0;
  const next = () => {
    if (i >= demoSteps.length) return;
    const [delay, evt] = demoSteps[i++];
    demoTimer = setTimeout(() => {
      overlay?.webContents.send('codex:event', evt);
      next();
    }, delay);
  };
  next();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// 'auto' -> the first system language Capri speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const cfg = config.load();
  return { ...cfg, lang: resolveLang(cfg.lang), langSetting: cfg.lang, gameMode: Boolean(gameMode?.active), gameQuiet: Boolean(gameMode?.quiet) };
}

function updateConfig(patch) {
  config.save(patch);
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  launcher?.configChanged();
  rebuildTray();
  return cfg;
}

function rebuildTray() {
  if (!tray) return;
  const cfg = config.load();
  const hookState = hooks.status();
  const t = TRAY[resolveLang(cfg.lang)];

  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;

  const menu = Menu.buildFromTemplate([
    { label: cfg.lang === 'ru' || resolveLang(cfg.lang) === 'ru' ? 'Приложения' : 'Applications', click: () => launcher?.open('apps') },
    { label: resolveLang(cfg.lang) === 'ru' ? 'Музыка' : 'Music', click: () => launcher?.open('music') },
    { label: resolveLang(cfg.lang) === 'ru' ? 'Скин персонажа' : 'Character skin', click: () => launcher?.open('skins') },
    { type: 'separator' },
    { label: t.online(PORT), enabled: false },
    { type: 'separator' },
    { label: t.teleport, click: () => sendCommand('teleport') },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.demo, click: playDemo },
    { label: t.help, click: () => sendCommand('welcome') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    { type: 'separator' },
    {
      label: t.size,
      submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: t.screen,
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); fitOverlay(); rebuildTray(); },
      })),
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    {
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label, type: 'radio', checked: cfg.lang === lang, click: () => updateConfig({ lang }),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    { type: 'separator' },
    hookState.installed
      ? { label: t.hooksOn, enabled: false }
      : { label: t.hooksOff, click: () => runHooks('install') },
    ...(hookState.installed ? [{ label: t.hooksRemove, click: () => runHooks('uninstall') }] : []),
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

// From the tray, she says how it went; from her welcome panel (quiet), the panel does.
function runHooks(action, { quiet = false } = {}) {
  let outcome;
  try {
    const result = action === 'install' ? hooks.install() : hooks.uninstall();
    outcome = { action, ok: true, file: result.file };
  } catch (err) {
    outcome = { action, ok: false, error: err.message };
  }
  if (!quiet) sendCommand('hooks', outcome);
  rebuildTray();
  return outcome;
}

function createTray() {
  const mono = path.join(ROOT, 'assets', 'icons', 'tray-mono.png');
  const icon = nativeImage.createFromPath(fs.existsSync(mono) ? mono : path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('pet:state', (event, value) => {
    if (event.sender !== overlay?.webContents || !value || typeof value !== 'object') return;
    const fields = ['pinned', 'canPin', 'sleeping', 'canRest'];
    if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => typeof value[key] !== 'boolean')) return;
    const justPinned = (value.pinned && !petState.pinned) || (value.canPin && !petState.canPin);
    petState = Object.fromEntries(fields.map((key) => [key, value[key]])); launcher?.petChanged(petState);
    if (justPinned) raisePinnedOverlay();
  });
  ipcMain.on('overlay:interactive', (event, on) => {
    if (!overlay || overlay.isDestroyed() || event.sender !== overlay.webContents || typeof on !== 'boolean') return;
    overlayInput?.setInteractive(on);
  });
  ipcMain.handle('pet:drop-shortcuts', (event, files) => {
    if (event.sender !== overlay?.webContents) throw new Error('Invalid overlay sender');
    return launcher.acceptDrop(files);
  });
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => hooks.status());
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  ipcMain.on('menu:open', () => launcher?.open());
  ipcMain.on('menu:quick', (event) => { if (event.sender === overlay?.webContents && !gameMode?.active) launcher?.openQuick(overlay); });
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
  ipcMain.handle('codex:found', () => fs.existsSync(path.dirname(hooks.status().file))); // Codex keeps its settings there
  ipcMain.on('codex:help', () => shell.openExternal(CODEX_HELP));
  ipcMain.handle('windows:get', () => lastWindows);
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide: Codex's folder (~/.codex) in Explorer, its settings file selected
  ipcMain.handle('guide:codexFolder', () => {
    const file = hooks.status().file;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) return { found: false, dir };
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(dir);
    return { found: true, dir, file: fs.existsSync(file) };
  });
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window

async function debugHandler(route, body) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (route === 'launcher') {
    launcher.open(body.tab || 'apps');
    return { ok: true };
  }
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Capri test window ${id}`, backgroundColor: '#1b1726',
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');

  app.whenReady().then(() => {
    serveProtocol();
    try { vpn = new VpnManager({ app, cipher: safeStorage, onState: (state) => launcher?.vpnChanged(state) }); }
    catch { console.error('[capri] VPN store unavailable; other Capri features remain active'); }
    zapret = createZapret({ app, dialog, onChange: () => launcher?.zapretChanged() });
    launcher = createLauncher({ config, rendererConfig, updateConfig, sendCommand, getPetState: () => petState, preparePin: () => sendCommand('preparePin', { windowId: lastWindows?.fg || 0 }), getZapret: () => zapret, getVpn: () => { if (!vpn) throw new Error('Хранилище VPN недоступно. Проверь Windows DPAPI и папку данных Capri.'); return vpn; }, openSettings: (window) => trayMenu?.popup({ window }) });
    registerIpc();
    createOverlay();
    gameMode = createGameMode({ overlay, onChange: (active, quiet) => sendCommand('gameMode', { active, quiet }), hideQuick: () => launcher?.hideQuick() });
    createTray();
    windowWatch = startWindowWatch({
      overlay,
      onInputRecovered: () => {
        sendCommand('recoverInput'); overlayInput?.reapply();
        const file = path.join(app.getPath('userData'), 'input-recovery.log');
        try {
          if (fs.existsSync(file) && fs.statSync(file).size > 65536) fs.writeFileSync(file, '');
          fs.appendFileSync(file, `${new Date().toISOString()} restored hidden Chromium input window\n`);
        } catch { /* Logging must not interrupt input recovery. */ }
      },
      onUpdate: (data) => {
        const foregroundChanged = data.fg !== lastWindows?.fg;
        lastWindows = data;
        gameMode.update(data.gameMode, { covered: sameDisplay(targetDisplay().bounds, data.gameDisplay) });
        if (foregroundChanged) raisePinnedOverlay();
        overlay?.webContents.send('windows:update', data);
      },
    });
    createBridge({
      port: PORT,
      onEvent: (evt) => overlay?.webContents.send('codex:event', evt),
      onDebug: DEV ? debugHandler : null,
    });
    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
    powerMonitor.on('resume', () => { overlayInput?.reapply(); if (vpn?.wanted) vpn.restart().catch(() => {}); });
    powerMonitor.on('unlock-screen', () => overlayInput?.reapply());
  });

  app.on('before-quit', (event) => {
    if ((!vpn && !zapret) || quitting) return;
    event.preventDefault(); quitting = true;
    Promise.allSettled([vpn?.close(), zapret?.close()]).then(() => app.quit());
  });

  app.on('will-quit', () => {
    overlayInput?.close();
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    launcher?.close();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

// Restacking a seated mascot must never activate it or steal keyboard focus.
function raisePinnedOverlay() {
  if (gameMode?.active || (!petState.pinned && !petState.canPin) || !overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
  const foreground = BrowserWindow.getFocusedWindow();
  if (foreground && /\/src\/(?:launcher|quick)\//.test(foreground.webContents.getURL())) return;
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.moveTop();
}

main();
