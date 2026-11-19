'use strict';
// Внутренние страницы браузера (byss://) получают доступ к настройкам. Обычные сайты — нет.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'byss:') {
  contextBridge.exposeInMainWorld('byss', {
    invoke: (ch, ...args) => ipcRenderer.invoke('page:' + ch, ...args),
    on: (ch, fn) => ipcRenderer.on('page:' + ch, (e, ...args) => fn(...args))
  });
}
