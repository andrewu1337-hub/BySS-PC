'use strict';
// Мостик для меню «⋮»: показать пункты, сообщить о выборе или закрытии.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('byssMenu', {
  pick: (id) => ipcRenderer.send('menu:pick', id),
  close: () => ipcRenderer.send('menu:close'),
  on: (fn) => ipcRenderer.on('show', (e, msg) => fn(msg))
});
