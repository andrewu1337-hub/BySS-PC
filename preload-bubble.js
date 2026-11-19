'use strict';
// Мостик для всплывающих сообщений внизу окна.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('byssBubble', {
  click: (id, button) => ipcRenderer.send('bubble:click', id, button),
  size: (h) => ipcRenderer.send('bubble:size', h),
  on: (fn) => ipcRenderer.on('show', (e, msg) => fn(msg))
});
