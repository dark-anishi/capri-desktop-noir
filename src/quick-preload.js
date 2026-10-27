'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('quickMenu', {
  state: () => ipcRenderer.invoke('quick:state'),
  close: () => ipcRenderer.invoke('quick:close'),
  fit: (height) => ipcRenderer.invoke('quick:fit', height),
  action: (id, value) => ipcRenderer.invoke('quick:action', id, value),
  onState: (fn) => ipcRenderer.on('quick:state', (_event, state) => fn(state)),
});
