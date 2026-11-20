'use strict';
// Мостик для верхней панели (вкладки и адресная строка): только нужные команды.
const { contextBridge, ipcRenderer } = require('electron');

const SEND = ['ui:ready', 'tab:new', 'tab:activate', 'tab:close', 'tab:menu', 'tab:move', 'nav:go', 'nav:back',
  'nav:forward', 'nav:reload', 'nav:home', 'ui:menu', 'ui:shield', 'ui:translate', 'ui:engine', 'ui:focus-page',
  'ui:find', 'ui:copy', 'ui:print', 'ui:autoscroll',
  'find:query', 'find:close'];
const ON = ['state', 'focus-address', 'find-open', 'find-result'];

contextBridge.exposeInMainWorld('byssUI', {
  send: (ch, ...args) => {
    if (SEND.includes(ch)) ipcRenderer.send(ch, ...args);
  },
  on: (ch, fn) => {
    if (ON.includes(ch)) ipcRenderer.on(ch, (e, ...args) => fn(...args));
  }
});
