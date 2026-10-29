'use strict';
const { contextBridge } = require('electron');
// Runs before the player's scripts, inside the page world. No Electron/IPC capability
// is exported to the remote site. Capture standard Media Session actions and detached Audio.
contextBridge.executeInMainWorld({ func: () => {
  const handlers = new Map(), media = new Set(); let volume = null;
  let pendingVolume = null;
  const volumeSlider = () => document.querySelector('input[type="range"][aria-label*="громк" i], input[type="range"][aria-label*="volume" i], [class*="ChangeVolume"] input[type="range"]');
  const sliderVolume = () => {
    const slider = volumeSlider(); if (!slider) return null;
    const min = Number(slider.min || 0), max = Number(slider.max || 100);
    const value = (slider.valueAsNumber - min) / (max - min);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
  };
  const applySlider = () => {
    const slider = volumeSlider(); if (!slider || pendingVolume === null) return false;
    const value = pendingVolume; pendingVolume = null;
    const min = Number(slider.min || 0), max = Number(slider.max || 100);
    // Use the native setter so React receives the input/change instead of
    // updating only the DOM value while its player state stays unchanged.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(min + value * (max - min)));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  new MutationObserver(() => { if (pendingVolume !== null) applySlider(); }).observe(document, { childList: true, subtree: true });
  for (const event of ['input', 'change']) document.addEventListener(event, e => {
    if (e.target === volumeSlider()) { const value = sliderVolume(); if (value !== null) volume = value; }
  }, true);
  window.__capriMusicVolume = () => {
    const value = sliderVolume();
    if (value !== null) volume = value;
    return volume;
  };
  const session = navigator.mediaSession;
  if (session) { const original = session.setActionHandler.bind(session); session.setActionHandler = (name, handler) => { original(name, handler); if (handler) handlers.set(name, handler); else handlers.delete(name); }; }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) { media.add(this); if (volume !== null && !volumeSlider()) this.volume = volume; return play.apply(this, args); };
  document.addEventListener('playing', (e) => { if (e.target instanceof HTMLMediaElement) { media.add(e.target); if (volume !== null && !volumeSlider()) e.target.volume = volume; } }, true);
  window.__capriMusicControl = async (command, value) => {
    for (const element of document.querySelectorAll('audio, video')) media.add(element);
    if (command === 'volume') {
      volume = value; pendingVolume = value;
      // Let the player map its UI scale to audio gain. Writing both scales
      // makes its volumechange handler move the slider to a different value.
      if (!applySlider()) for (const element of media) element.volume = value;
      return true;
    }
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
