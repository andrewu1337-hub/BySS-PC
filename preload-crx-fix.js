'use strict';
// Страницы расширений (фон, всплывающее окно, настройки). В этой версии движка
// contextBridge.executeInMainWorld молча ничего не делает, и библиотека расширений
// не добавляет им chrome.tabs, chrome.browserAction и остальное — расширения падают
// при запуске (так было с uBlock Origin). Подменяем этот вызов на webFrame.executeJavaScript:
// библиотека и сама так делает, когда executeInMainWorld нет.
// Этот preload должен быть зарегистрирован раньше preload библиотеки.
const { contextBridge, webFrame } = require('electron');

if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
  const viaWebFrame = (opts) => {
    const fn = opts && opts.func;
    if (typeof fn !== 'function') return undefined;
    const args = JSON.stringify((opts && opts.args) || []);
    const p = webFrame.executeJavaScript('(' + String(fn) + ').apply(null, ' + args + ');');
    if (p && p.catch) p.catch((e) => console.error('BySS: executeInMainWorld', e));
    return undefined;
  };
  try {
    contextBridge.executeInMainWorld = viaWebFrame;
  } catch (e) {
    // ignore
  }
  if (contextBridge.executeInMainWorld !== viaWebFrame) {
    try {
      Object.defineProperty(contextBridge, 'executeInMainWorld', { value: viaWebFrame, configurable: true, writable: true });
    } catch (e) {
      try {
        delete contextBridge.executeInMainWorld; // тогда библиотека сама возьмёт webFrame
      } catch (err) {
        // ignore
      }
    }
  }
}
