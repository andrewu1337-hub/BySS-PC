'use strict';
// Внутренние страницы браузера (byss://) получают доступ к настройкам. Обычные сайты — нет.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

if (location.protocol === 'byss:') {
  contextBridge.exposeInMainWorld('byss', {
    invoke: (ch, ...args) => ipcRenderer.invoke('page:' + ch, ...args),
    on: (ch, fn) => ipcRenderer.on('page:' + ch, (e, ...args) => fn(...args))
  });
} else if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
  // Блокировка рекламы на YouTube: скрипт должен оказаться в странице раньше её собственного кода.
  let cfg = null;
  try {
    cfg = ipcRenderer.sendSync('site:yt');
  } catch (e) {
    cfg = null;
  }
  if (cfg && cfg.code) {
    let done = false;
    try {
      if (contextBridge.executeInMainWorld) {
        contextBridge.executeInMainWorld({ func: new Function(cfg.code) });
        done = true;
      }
    } catch (e) {
      done = false;
    }
    if (!done) {
      try {
        webFrame.executeJavaScript(cfg.code);
      } catch (e) {
        // не получилось — страница просто откроется как есть
      }
    }
  }
}
