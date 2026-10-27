'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { WebContentsView, shell } = require('electron');
const MUSIC_URL = 'https://music.yandex.ru/';
const PARTITION = 'persist:capri-yandex-music';
function isYandexURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)(yandex\.(ru|com|by|kz|uz|com\.tr)|ya\.ru)$/.test(url.hostname); }
  catch { return false; }
}
function createMusic({ window, onState, initialVolume = .7, onVolume = () => {} }) {
  let view = null, active = false, started = false, loaded = false, loading = false, closed = false;
  let bounds = null, error = '';
  let playing = false;
  let volume = Number.isFinite(initialVolume) ? Math.max(0, Math.min(1, initialVolume)) : .7;
  const authWindows = new Set();
  const theme = fs.readFileSync(path.join(__dirname, 'music-theme.css'), 'utf8');
  function notify() {
    if (!closed) onState({ loading, error, playing, ready: loaded, canGoBack: Boolean(view?.webContents.navigationHistory.canGoBack()) });
  }
  function playback(value) { const next = Boolean(value); if (playing !== next) { playing = next; notify(); } }
  function position() {
    if (!view || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    const rect = bounds || { x: 12, y: 180, width: width - 24, height: height - 225 };
    const x = Math.max(0, Math.min(width - 1, Math.round(Number(rect.x) || 0)));
    const y = Math.max(120, Math.min(height - 1, Math.round(Number(rect.y) || 180)));
    const w = Math.max(1, Math.min(width - x, Math.round(Number(rect.width) || width - x)));
    const h = Math.max(1, Math.min(height - y - 35, Math.round(Number(rect.height) || height - y - 35)));
    view.setBounds({ x, y, width: w, height: h });
    view.webContents.setZoomFactor(w < 800 ? 0.8 : 0.9);
    view.setVisible(active && loaded);
  }
  function navigation(event, url) {
    if (!isYandexURL(url)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  }
  function ensureView() {
    if (view) return;
    view = new WebContentsView({ webPreferences: {
      partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, '../music-preload.js'),
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    } });
    view.setBackgroundColor('#111113');
    window.contentView.addChildView(view); view.setVisible(false);
    const contents = view.webContents;
    contents.on('media-started-playing', () => playback(true));
    contents.on('media-paused', () => playback(contents.isCurrentlyAudible()));
    contents.on('audio-state-changed', ({ audible }) => playback(audible));
    contents.setUserAgent(contents.getUserAgent().replace(/\s(?:Electron|capri-desktop|Capri)\/[^\s]+/g, ''));
    contents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'mediaKeySystem' || permission === 'fullscreen'));
    contents.session.setPermissionCheckHandler((_contents, permission) => permission === 'mediaKeySystem' || permission === 'fullscreen');
    contents.on('will-navigate', navigation); contents.on('will-redirect', navigation);
    contents.setWindowOpenHandler(({ url }) => {
      if (!isYandexURL(url)) {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 520, height: 700, parent: window, autoHideMenuBar: true, title: 'Вход в Яндекс',
        backgroundColor: '#111113', webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
      } };
    });
    contents.on('did-create-window', (auth) => {
      authWindows.add(auth); auth.on('closed', () => authWindows.delete(auth));
      auth.webContents.on('will-navigate', navigation); auth.webContents.on('will-redirect', navigation);
      auth.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      auth.webContents.on('did-finish-load', () => {
        auth.webContents.insertCSS('html { filter: grayscale(1); color-scheme: dark; }', { cssOrigin: 'user' }).catch(() => {});
        if (/^https:\/\/music\.yandex\./.test(auth.webContents.getURL())) { contents.reload(); auth.close(); }
      });
    });
    contents.on('dom-ready', () => contents.insertCSS(theme, { cssOrigin: 'user' }).catch((err) => console.error('[capri] music theme:', err.message)));
    contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) { loading = true; error = ''; playback(false); notify(); }
    });
    contents.on('did-finish-load', () => { loading = false; loaded = true; error = ''; position(); control('volume', volume).catch(() => {}); notify(); });
    contents.on('did-navigate-in-page', notify);
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      loading = false; loaded = false;
      error = `Яндекс Музыка не загрузилась: ${description}. Проверь подключение и нажми «Обновить».`;
      position(); notify();
    });
    contents.on('render-process-gone', () => {
      playback(false);
      loaded = false; loading = false; error = 'Плеер остановился. Нажми «Обновить», чтобы открыть его снова.';
      position(); notify();
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); window.hide(); }
    });
  }
  function load() {
    ensureView(); started = true; loading = true; error = ''; notify();
    view.webContents.loadURL(MUSIC_URL).catch(() => {});
  }
  function layout(visible, rect) {
    const becomingActive = visible && !active;
    active = visible;
    if (rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))) bounds = rect;
    if (visible && !started) load();
    position();
    if (becomingActive) notify();
  }
  function action(name) {
    if (name === 'reload') { if (!view || !loaded) load(); else view.webContents.reload(); }
    else if (name === 'back' && view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
  }
  async function control(command, value) {
    if (!['toggle', 'next', 'previous', 'volume'].includes(command)) throw new Error('Неизвестная команда плеера.');
    if (command === 'volume' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Некорректная громкость.');
    if (!view || view.webContents.isDestroyed() || !loaded) throw new Error('Сначала открой Яндекс Музыку и выбери трек.');
    const script = `window.__capriMusicControl?.(${JSON.stringify(command)}, ${command === 'volume' ? value : 'undefined'})`;
    if (!await view.webContents.executeJavaScript(script, true)) throw new Error('Плеер ещё не готов. Нажми «Обновить» во вкладке музыки.');
    if (command === 'volume') { volume = value; onVolume(value); notify(); }
  }
  const togglePlayback = () => control('toggle');
  window.on('resize', position);
  function close() {
    playback(false);
    closed = true; window.removeListener('resize', position);
    for (const auth of authWindows) if (!auth.isDestroyed()) auth.destroy();
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = null;
  }
  return { layout, action, close, togglePlayback, control, state: () => ({ ready: loaded && !closed, playing, volume }) };
}
module.exports = { createMusic, isYandexURL, MUSIC_URL, PARTITION };
