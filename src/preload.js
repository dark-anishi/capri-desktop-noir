'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('host', {
  onCodexEvent: on('codex:event'),
  onCommand: on('capri:command'),
  onConfig: on('capri:config'),
  onResize: on('overlay:resize'),
  onWindows: on('windows:update'),
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', Boolean(on)),
  petState: (state) => ipcRenderer.send('pet:state', state),
  dropShortcuts: (files) => ipcRenderer.invoke('pet:drop-shortcuts', Array.from(files, (file) => webUtils.getPathForFile(file))),
  cursor: () => ipcRenderer.invoke('overlay:cursor'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  demoWindow: (open) => ipcRenderer.invoke('demo:window', Boolean(open)),
  openQuickMenu: () => ipcRenderer.send('menu:quick'),
  openMenu: () => ipcRenderer.send('menu:open'),
  installHooks: () => ipcRenderer.invoke('hooks:install'),
  codexFound: () => ipcRenderer.invoke('codex:found'),
  openCodexHelp: () => ipcRenderer.send('codex:help'),
  windowsNow: () => ipcRenderer.invoke('windows:get'),
  trayPlace: () => ipcRenderer.invoke('guide:tray'),
  openCodexFolder: () => ipcRenderer.invoke('guide:codexFolder'),
});
