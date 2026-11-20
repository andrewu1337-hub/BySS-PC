'use strict';
// Страницы расширений (фон, всплывающее окно, настройки). Библиотека расширений добавляет им
// chrome.tabs, chrome.browserAction и остальное через contextBridge.executeInMainWorld, а в этой
// версии движка этот вызов на страницах расширений молча не срабатывает — и расширения падают
// при запуске (так было с uBlock Origin). Здесь тот же код библиотеки ставится через
// webFrame.executeJavaScript. Если библиотека всё же успела сама — повтор тихо ничего не делает.
// Этот preload регистрируется после preload библиотеки.
const { ipcRenderer, webFrame } = require('electron');

if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
  let src = null;
  try {
    src = ipcRenderer.sendSync('byss:crx-main');
  } catch (e) {
    src = null;
  }
  if (typeof src === 'string' && src) {
    const code = 'try{(' + src + ')()}catch(e){if(!(e instanceof ReferenceError))console.error("BySS: расширения", e)}';
    try {
      const p = webFrame.executeJavaScript(code);
      if (p && p.catch) p.catch((e) => console.error('BySS: расширения', e));
    } catch (e) {
      console.error('BySS: расширения', e);
    }
  }
}
