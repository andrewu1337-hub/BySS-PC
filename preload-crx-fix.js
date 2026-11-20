'use strict';
// Страницы расширений (фон, всплывающее окно, настройки). Библиотека расширений добавляет в
// объект chrome свои chrome.tabs, chrome.browserAction и т. д. ещё до загрузки страницы, а движок
// потом подменяет window.chrome новым объектом — и добавленное пропадает. Расширения при этом
// падают при запуске (так было с uBlock Origin: «chrome.browserAction is undefined»).
// Здесь эти API запоминаются и ставятся заново на тот chrome, который увидит страница.
// Регистрируется после preload библиотеки.
const { ipcRenderer, webFrame } = require('electron');

function mainWorld(src) {
  return '(function () {\n'
    + 'var KEYS = ["action","browserAction","commands","contextMenus","cookies","downloads","extension","notifications",'
    + '"permissions","privacy","runtime","storage","tabs","topSites","webNavigation","webRequest","windows"];\n'
    + 'function grab(o) {\n'
    + '  if (!o || typeof o !== "object" || !Object.isFrozen(o)) return null;\n'
    + '  var out = {}, n = 0;\n'
    + '  KEYS.forEach(function (k) { var d = Object.getOwnPropertyDescriptor(o, k);'
    + ' if (d && "value" in d && d.value !== undefined) { out[k] = d.value; n++; } });\n'
    + '  return n ? out : null;\n'
    + '}\n'
    // 1) библиотека уже поставила API (и заморозила объект) — берём их
    + 'var apis = grab(globalThis.chrome);\n'
    // 2) не поставила — строим сами на свежей копии chrome
    + 'if (!apis && globalThis.electron) {\n'
    + '  var nat = globalThis.chrome || {}, stage = {};\n'
    + '  Object.getOwnPropertyNames(nat).forEach(function (k) { try { var v = nat[k]; if (v !== undefined) stage[k] = v; } catch (e) {} });\n'
    + '  var was = Object.getOwnPropertyDescriptor(globalThis, "chrome");\n'
    + '  try {\n'
    + '    Object.defineProperty(globalThis, "chrome", { value: stage, configurable: true, writable: true, enumerable: true });\n'
    + '    (' + (src || 'function () {}') + ')();\n'
    + '  } catch (e) { console.error("BySS: расширения", e); }\n'
    + '  apis = grab(stage);\n'
    + '  try { if (was) Object.defineProperty(globalThis, "chrome", was); } catch (e) {}\n'
    + '}\n'
    + 'if (!apis) return;\n'
    + 'function augment(o) {\n'
    + '  if (!o || typeof o !== "object" || Object.isFrozen(o)) return;\n'
    + '  KEYS.forEach(function (k) {\n'
    + '    if (!(k in apis) || o[k] === apis[k]) return;\n'
    + '    try { Object.defineProperty(o, k, { value: apis[k], configurable: true, enumerable: true, writable: true }); } catch (e) {}\n'
    + '  });\n'
    + '}\n'
    // 3) ставим на текущий и на любой следующий объект chrome
    + 'var cur = globalThis.chrome;\n'
    + 'augment(cur);\n'
    + 'try {\n'
    + '  Object.defineProperty(globalThis, "chrome", { configurable: true, enumerable: true,\n'
    + '    get: function () { return cur; }, set: function (v) { cur = v; augment(v); } });\n'
    + '} catch (e) {}\n'
    + 'var check = function () { try { var c = globalThis.chrome; if (c !== cur) cur = c; augment(c); } catch (e) {} };\n'
    + 'try {\n'
    + '  var mo = new MutationObserver(check);\n'
    + '  mo.observe(document, { childList: true, subtree: true });\n'
    + '  addEventListener("load", function () { check(); setTimeout(function () { check(); mo.disconnect(); }, 3000); });\n'
    + '} catch (e) {}\n'
    + 'document.addEventListener("readystatechange", check);\n'
    + 'queueMicrotask(check);\n'
    + '})();';
}

if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
  let src = null;
  try {
    src = ipcRenderer.sendSync('byss:crx-main');
  } catch (e) {
    src = null;
  }
  try {
    const p = webFrame.executeJavaScript(mainWorld(typeof src === 'string' ? src : ''));
    if (p && p.catch) p.catch((e) => console.error('BySS: расширения', e));
  } catch (e) {
    console.error('BySS: расширения', e);
  }
}

