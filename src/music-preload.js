'use strict';
const { contextBridge } = require('electron');
// Runs before the player's scripts, inside the page world. No Electron/IPC capability
// is exported to the remote site. Capture standard Media Session actions and detached Audio.
contextBridge.executeInMainWorld({ func: () => {
  const handlers = new Map(), media = new Set(); let volume = null;
  const session = navigator.mediaSession;
  if (session) { const original = session.setActionHandler.bind(session); session.setActionHandler = (name, handler) => { original(name, handler); if (handler) handlers.set(name, handler); else handlers.delete(name); }; }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) { media.add(this); if (volume !== null) this.volume = volume; return play.apply(this, args); };
  document.addEventListener('playing', (e) => { if (e.target instanceof HTMLMediaElement) { media.add(e.target); if (volume !== null) e.target.volume = volume; } }, true);
  window.__capriMusicControl = async (command, value) => {
    for (const element of document.querySelectorAll('audio, video')) media.add(element);
    if (command === 'volume') { volume = value; for (const element of media) element.volume = value; return true; }
    if (command === 'toggle') {
      const element = [...media].find((e) => !e.paused && !e.ended) || [...media].find((e) => e.currentSrc || e.src);
      const action = element ? element.paused ? 'play' : 'pause' : session?.playbackState === 'playing' ? 'pause' : 'play';
      if (handlers.has(action)) { await handlers.get(action)({ action }); return true; }
      if (element) { if (element.paused) await element.play(); else element.pause(); return true; }
    }
    const action = command === 'next' ? 'nexttrack' : command === 'previous' ? 'previoustrack' : null;
    if (action && handlers.has(action)) { await handlers.get(action)({ action }); return true; }
    // Official Yandex controls: N/P switch tracks; K toggles playback.
    const key = { toggle: 'k', next: 'n', previous: 'p' }[command];
    if (!key) return false;
    const target = document.activeElement?.matches('input, textarea, [contenteditable]') ? document.body : document.activeElement || document.body;
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key, code: 'Key' + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0), which: key.toUpperCase().charCodeAt(0), bubbles: true }));
    return true;
  };
} });
