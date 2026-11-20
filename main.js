'use strict';
// BySS для компьютера: окно, вкладки, режимы BySS (без следов), блокировка рекламы, перевод,
// загрузки, длинный скриншот и обновления с GitHub.

const {
  app, BaseWindow, WebContentsView, ipcMain, session, Menu, nativeTheme, shell, dialog, clipboard, protocol, net, screen,
  nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Store, MY_SITES } = require('./store');
const { AdBlock, baseDomain, hostOf } = require('./adblock');
const EXT = require('./extensions');

let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  autoUpdater = null;
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'byss', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const HOME = 'byss://home/';
const SETTINGS = 'byss://settings/';
const DOWNLOADS = 'byss://downloads/';
const EXTENSIONS = 'byss://extensions/';
const MAX_TABS = 50;
const STRIP = 40;   // ряд вкладок
const BAR = 46;     // адресная строка
const FIND = 42;    // поиск по странице

let store;
let adblock;
let win;
let ui;
let bubble;
let menuView;      // меню «⋮» — своё, чтобы пункты можно было раскрасить и сгруппировать
let tabs = [];
let activeId = null;
let nextId = 1;
let findOpen = false;
let fullscreenTab = null;
const closed = [];
const isMac = process.platform === 'darwin';

// значок: тот же лев на щите, что и на Android; вокруг щита — прозрачно. Для Windows — .ico, где каждый размер
// (16…256) нарисован отдельно, поэтому на панели задач он чёткий, а не смазанный
let YT_JS = null;
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'byss-shield.ico' : 'lion-big.png');

const COLORS = {
  dark: { bg: '#000000', text: '#FFFFFF' },
  light: { bg: '#F2F2F7', text: '#111113' }
};

function theme() {
  return store.get('theme') === 'light' ? 'light' : 'dark';
}

// ======================================================================= сессии

const prepared = new WeakSet();

function sessionFor(mode) {
  const ses = mode ? session.fromPartition('byss-' + mode) : session.fromPartition('persist:main');
  prepare(ses, !!mode);
  return ses;
}

function pagesFile(host, pathname) {
  const root = path.join(__dirname, 'pages');
  let p = decodeURIComponent(pathname || '/');
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(root, host, p));
  return file.startsWith(root) ? file : null;
}

function byssProtocol(req) {
  const u = new URL(req.url);
  if (u.hostname === 'data' && u.pathname === '/wallpaper') {
    const f = wallpaperFile();
    if (f && fs.existsSync(f)) return net.fetch(pathToFileURL(f).toString());
    return new Response('', { status: 404 });
  }
  const file = pagesFile(u.hostname, u.pathname);
  if (!file || !fs.existsSync(file)) return new Response('Страница не найдена', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function wallpaperFile() {
  const dir = app.getPath('userData');
  for (const ext of ['jpg', 'png', 'webp']) {
    const f = path.join(dir, 'wallpaper.' + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

const permissionMemory = new Map();
const PERM_NAMES = {
  media: 'камеру или микрофон',
  geolocation: 'ваше местоположение',
  notifications: 'показывать уведомления',
  'display-capture': 'запись экрана',
  midi: 'MIDI-устройства',
  'clipboard-read': 'чтение буфера обмена',
  'idle-detection': 'знать, когда вы не за компьютером',
  'storage-access': 'доступ к своим данным на других сайтах',
  'top-level-storage-access': 'доступ к своим данным на других сайтах'
};

const NET_FILTER = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };

/** Встроенная блокировка запросов. */
function netFilter(d, cb) {
  try {
    if (!store.get('adblock') || d.resourceType === 'mainFrame') return cb({});
    const t = tabByWc(d.webContentsId);
    const pageHost = t ? hostOf(t.url) : hostOf(d.referrer || '');
    if (pageHost && store.get('allowSites')[baseDomain(pageHost)]) return cb({});
    const host = hostOf(d.url);
    if (adblock.shouldBlock(host, pageHost)) {
      if (t) {
        t.blocked++;
        if (t.id === activeId) sendState();
      }
      return cb({ cancel: true });
    }
  } catch (e) {
    // на всякий случай пропускаем запрос
  }
  cb({});
}

/** Включён uBlock Origin — запросы отдаём ему (движок не даёт работать двум блокировщикам сразу). */
function applyNet(ses) {
  try {
    if (EXT.uboOwnsNetwork(ses)) ses.webRequest.onBeforeRequest(null);
    else ses.webRequest.onBeforeRequest(NET_FILTER, netFilter);
  } catch (e) {
    // ignore
  }
}

function prepare(ses, incognito) {
  if (prepared.has(ses)) return;
  prepared.add(ses);
  ses.protocol.handle('byss', byssProtocol);
  try {
    ses.setSpellCheckerLanguages(['ru', 'en-US']);
  } catch (e) {
    // проверка орфографии недоступна
  }

  applyNet(ses);

  ses.on('will-download', (e, item) => download(item, incognito));

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const free = ['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-management'];
    if (free.includes(permission)) return callback(true);
    const origin = (() => {
      try {
        return new URL(details.requestingUrl || wc.getURL()).origin;
      } catch (err) {
        return '';
      }
    })();
    if (origin.startsWith('byss:')) return callback(true);
    const key = origin + '|' + permission;
    if (permissionMemory.has(key)) return callback(permissionMemory.get(key));
    const what = PERM_NAMES[permission] || permission;
    showBubble({
      icon: 'lock',
      text: hostOf(origin) + ' просит ' + what,
      sub: 'Разрешить этому сайту?',
      buttons: [{ id: 'no', label: 'Запретить' }, { id: 'yes', label: 'Разрешить', primary: true }]
    }, (b) => {
      const ok = b === 'yes';
      permissionMemory.set(key, ok);
      callback(ok);
    }, () => callback(false));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)) return true;
    if ((origin || '').startsWith('byss:')) return true;
    return permissionMemory.get(origin + '|' + permission) === true;
  });
}

// ======================================================================= окно: размер и место
// Браузер помнит, каким было окно: размер, место и развёрнуто ли на весь экран.

let normalBounds = null;

function savedWindow() {
  const w = store.get('window');
  if (!w || typeof w !== 'object') return {};
  const b = { width: Math.max(520, w.width | 0 || 1280), height: Math.max(360, w.height | 0 || 820) };
  if (Number.isFinite(w.x) && Number.isFinite(w.y)) {
    // окно должно хотя бы частично попадать на один из мониторов (монитор могли отключить)
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return w.x + 80 < a.x + a.width && w.x + b.width - 80 > a.x && w.y + 20 < a.y + a.height && w.y + 20 > a.y - 20;
    });
    if (visible) {
      b.x = w.x;
      b.y = w.y;
    }
  }
  b.maximized = !!w.maximized;
  b.fullscreen = !!w.fullscreen;
  return b;
}

function rememberBounds() {
  if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
  normalBounds = win.getBounds();
}

function saveWindow() {
  if (!win || win.isDestroyed()) return;
  rememberBounds();
  const b = normalBounds || win.getBounds();
  store.set('window', {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    maximized: win.isMaximized(),
    // полноэкранное видео не считаем — только F11
    fullscreen: win.isFullScreen() && !fullscreenTab
  });
}

function createWindow() {
  const t = theme();
  const ws = savedWindow();
  win = new BaseWindow({
    width: ws.width || 1280,
    height: ws.height || 820,
    x: ws.x,
    y: ws.y,
    minWidth: 520,
    minHeight: 360,
    show: false,
    backgroundColor: COLORS[t].bg,
    title: store.get('name') || 'BySS',
    icon: ICON,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: COLORS[t].bg, symbolColor: COLORS[t].text, height: STRIP }
  });

  ui = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, sandbox: true }
  });
  ui.setBackgroundColor(COLORS[t].bg);
  win.contentView.addChildView(ui);
  ui.webContents.loadFile(path.join(__dirname, 'ui', 'ui.html'));
  ui.webContents.on('before-input-event', (e, input) => shortcuts(e, input, null));
  ui.webContents.on('context-menu', (e, p) => {
    if (!p.isEditable) return;
    const wc = ui.webContents;
    const clip = clipboard.readText().trim();
    Menu.buildFromTemplate([
      { label: 'Вырезать', enabled: p.editFlags.canCut, click: () => wc.cut() },
      { label: 'Копировать', enabled: p.editFlags.canCopy, click: () => wc.copy() },
      { label: 'Вставить', enabled: p.editFlags.canPaste, click: () => wc.paste() },
      {
        label: 'Вставить и перейти',
        enabled: !!clip,
        click: () => {
          const u = toUrl(clip);
          const t = activeTab();
          if (u && t) navigate(t, u);
        }
      },
      { type: 'separator' },
      { label: 'Выделить всё', click: () => wc.selectAll() }
    ]).popup({ window: win });
  });

  bubble = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-bubble.js'), contextIsolation: true, sandbox: true }
  });
  bubble.setBackgroundColor('#00000000');
  bubble.webContents.loadFile(path.join(__dirname, 'bubble', 'bubble.html'));
  bubble.webContents.on('did-finish-load', () => {
    bubbleReady = true;
    if (bubblePending) bubble.webContents.send('show', bubblePending);
    bubblePending = null;
  });

  menuView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-menu.js'), contextIsolation: true, sandbox: true }
  });
  menuView.setBackgroundColor('#00000000');
  menuView.webContents.loadFile(path.join(__dirname, 'menu', 'menu.html'));
  menuView.webContents.on('did-finish-load', () => {
    menuReady = true;
    if (menuPending) menuView.webContents.send('show', menuPending);
    menuPending = null;
  });

  win.on('resize', () => {
    layout();
    rememberBounds();
  });
  win.on('blur', () => hideMenu());
  win.on('move', rememberBounds);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  win.on('close', () => {
    saveWindow();
    saveSession();
  });
  win.on('closed', () => {
    win = null;
    app.quit();
  });

  restoreSession();
  rememberBounds();
  if (ws.maximized) win.maximize();
  if (ws.fullscreen) win.setFullScreen(true);
  layout();
  win.show();
}

function top() {
  return STRIP + BAR + (findOpen ? FIND : 0);
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const t = activeTab();
  if (fullscreenTab && t === fullscreenTab && t.view) {
    ui.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    t.view.setBounds({ x: 0, y: 0, width: w, height: h });
  } else {
    ui.setBounds({ x: 0, y: 0, width: w, height: top() });
    if (t && t.view) t.view.setBounds({ x: 0, y: top(), width: w, height: Math.max(0, h - top()) });
  }
  layoutBubble();
  if (menuShown) menuView.setBounds({ x: 0, y: 0, width: w, height: h });
}

// ======================================================================= вкладки

function activeTab() {
  return tabs.find((t) => t.id === activeId) || null;
}

function tabByWc(id) {
  return tabs.find((t) => t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === id) || null;
}

function modeName(mode) {
  const m = (store.get('modes') || []).find((x) => x.id === mode);
  return m ? m.name : 'BySS';
}

function newTab(url, opts = {}) {
  if (tabs.length >= MAX_TABS) {
    showBubble({
      icon: 'tabs',
      text: 'Открыто ' + MAX_TABS + ' вкладок',
      sub: 'Закройте ненужные — так браузер работает быстрее.',
      buttons: [{ id: 'ok', label: 'Хорошо', primary: true }]
    });
    return null;
  }
  const t = {
    id: nextId++,
    mode: opts.mode || null,
    url: url || HOME,
    title: opts.title || '',
    favicon: null,
    loading: false,
    blocked: 0,
    view: null,
    origUrl: null,
    translated: false,
    autoscroll: false,
    zoom: 0
  };
  const cur = activeTab();
  const idx = opts.index != null ? opts.index : (cur ? tabs.indexOf(cur) + 1 : tabs.length);
  tabs.splice(Math.min(idx, tabs.length), 0, t);
  if (opts.lazy) {
    sendState();
  } else if (opts.background) {
    ensureView(t);
    sendState();
  } else {
    activate(t.id);
  }
  return t;
}

function ensureView(t) {
  if (t.view) return t.view;
  const ses = sessionFor(t.mode);
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload-page.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true
    }
  });
  view.setBackgroundColor(COLORS[theme()].bg);
  t.view = view;
  wire(t, view.webContents);
  if (!t.mode) EXT.addTab(view.webContents);
  view.webContents.loadURL(t.url).catch(() => {});
  return view;
}

function activate(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  const prev = activeTab();
  if (prev && prev !== t && prev.view) {
    try {
      win.contentView.removeChildView(prev.view);
    } catch (e) {
      // уже убран
    }
  }
  hideMenu();
  activeId = id;
  ensureView(t);
  if (!t.mode) EXT.selectTab(t.view.webContents);
  win.contentView.addChildView(t.view, 1);
  if (bubbleShown) {
    win.contentView.removeChildView(bubble);
    win.contentView.addChildView(bubble);
  }
  layout();
  if (t.url === HOME && !t.view.webContents.isLoading()) {
    ui.webContents.send('focus-address');
  } else {
    t.view.webContents.focus();
  }
  if (findOpen) closeFind();
  sendState();
  if (/^https?:/.test(t.url) && !t.view.webContents.isLoading()) setTimeout(() => t.id === activeId && askTrackers(t), 400);
}

function closeTab(id) {
  const i = tabs.findIndex((x) => x.id === id);
  if (i < 0) return;
  const t = tabs[i];
  if (!t.mode && t.url && t.url !== HOME) {
    closed.push(t.url);
    if (closed.length > 25) closed.shift();
  }
  tabs.splice(i, 1);
  clearInterval(t.asTimer);
  if (fullscreenTab === t) fullscreenTab = null;
  if (t.view) {
    try {
      win.contentView.removeChildView(t.view);
    } catch (e) {
      // уже убран
    }
    try {
      t.view.webContents.close();
    } catch (e) {
      // уже закрыт
    }
  }
  if (activeId === id) {
    activeId = null;
    if (tabs.length === 0) {
      newTab(HOME);
      return;
    }
    activate(tabs[Math.min(i, tabs.length - 1)].id);
  } else {
    sendState();
  }
}

function navigate(t, url) {
  if (!t || !url) return;
  t.url = url;
  if (t.view) {
    t.view.webContents.loadURL(url).catch(() => {});
    t.view.webContents.focus();
  } else {
    ensureView(t);
  }
  sendState();
}

const ENGINES = {
  google: 'https://www.google.com/search?q=',
  yandex: 'https://yandex.ru/search/?text=',
  ddg: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q='
};

function searchUrl(engine, q) {
  return (ENGINES[engine] || ENGINES.google) + encodeURIComponent(q);
}

function toUrl(text) {
  const s = (text || '').trim();
  if (!s) return null;
  if (/^(https?|byss|file):/i.test(s)) return s;
  if (/^about:blank$/i.test(s)) return s;
  if (!/\s/.test(s) && /^(localhost|[\d.]+)(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[\p{L}\d-]+(\.[\p{L}\d-]+)+(:\d+)?([/?#].*)?$/u.test(s)) return 'https://' + s;
  return searchUrl(store.get('engine'), s);
}

function wire(t, wc) {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') {
      // окна входа (Google, Apple и т. п.) — настоящим окном, иначе вход не завершится
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          backgroundColor: COLORS[theme()].bg,
          icon: ICON
        }
      };
    }
    newTab(url, { mode: t.mode, background: disposition === 'background-tab' });
    return { action: 'deny' };
  });
  wc.on('did-start-loading', () => {
    t.loading = true;
    sendState();
  });
  wc.on('did-stop-loading', () => {
    t.loading = false;
    sendState();
  });
  wc.on('did-start-navigation', (e) => {
    const isMain = e && (e.isMainFrame !== undefined ? e.isMainFrame : true);
    const same = e && e.isSameDocument;
    if (isMain && !same) {
      t.blocked = 0;
      t.ytOk = null;
      if (t.autoscroll) {
        t.autoscroll = false; // новая страница — автоскролл начинается заново только по команде
        clearInterval(t.asTimer);
        t.asTimer = null;
        sendState();
      }
    }
  });
  const onNav = (e, url) => {
    t.url = url;
    if (t.translated && baseDomain(hostOf(url)) !== t.trBase) {
      t.translated = false;
      t.trRun = null;
    }
    if (t.noAuto && baseDomain(hostOf(url)) !== t.noAuto) t.noAuto = null;
    sendState();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', (e, url, isMain) => {
    if (isMain) onNav(e, url);
  });
  wc.on('page-title-updated', (e, title) => {
    t.title = title;
    sendState();
  });
  wc.on('page-favicon-updated', (e, icons) => {
    t.favicon = icons && icons.length ? icons[0] : null;
    sendState();
  });
  wc.on('dom-ready', () => {
    const host = hostOf(wc.getURL());
    if (!/^https?:/.test(wc.getURL()) || !store.get('adblock')) return;
    if (store.get('allowSites')[baseDomain(host)]) return;
    const css = adblock.cssFor(host);
    if (css) wc.insertCSS(css, { cssOrigin: 'user' }).catch(() => {});
  });
  wc.on('did-finish-load', () => afterLoad(t));
  wc.on('dom-ready', () => keepTranslating(t));
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3 || !/^https?:/.test(url)) return;
    wc.loadURL('byss://error/?c=' + encodeURIComponent(code) + '&d=' + encodeURIComponent(desc)
      + '&u=' + encodeURIComponent(url)).catch(() => {});
  });
  wc.on('render-process-gone', () => {
    const url = t.url;
    wc.loadURL('byss://error/?c=crash&u=' + encodeURIComponent(url)).catch(() => {});
  });
  wc.on('before-input-event', (e, input) => shortcuts(e, input, t));
  wc.on('context-menu', (e, p) => pageMenu(t, wc, p));
  wc.on('found-in-page', (e, r) => ui.webContents.send('find-result', r.activeMatchOrdinal, r.matches));
  wc.on('enter-html-full-screen', () => {
    fullscreenTab = t;
    win.setFullScreen(true);
    layout();
  });
  wc.on('leave-html-full-screen', () => {
    fullscreenTab = null;
    win.setFullScreen(false);
    layout();
  });
}

// ======================================================================= состояние для панели

let stateTimer = null;

function sendState() {
  if (stateTimer || !ui) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    if (!ui || ui.webContents.isDestroyed()) return;
    ui.webContents.send('state', snapshot());
  }, 16);
}

function canGo(wc, back) {
  try {
    const h = wc.navigationHistory;
    if (h) return back ? h.canGoBack() : h.canGoForward();
    return back ? wc.canGoBack() : wc.canGoForward();
  } catch (e) {
    return false;
  }
}

function go(wc, back) {
  const h = wc.navigationHistory;
  if (h) {
    if (back) h.goBack();
    else h.goForward();
  } else if (back) {
    wc.goBack();
  } else {
    wc.goForward();
  }
}

function snapshot() {
  const t = activeTab();
  const wc = t && t.view ? t.view.webContents : null;
  const url = t ? t.url : '';
  const site = /^https?:/.test(url);
  return {
    platform: process.platform,
    theme: theme(),
    name: store.get('name'),
    engine: store.get('engine'),
    findOpen,
    tabs: tabs.map((x) => ({
      id: x.id,
      title: x.title || titleFor(x.url),
      url: x.url,
      favicon: x.mode ? null : x.favicon,
      loading: x.loading,
      mode: x.mode,
      modeName: x.mode ? modeName(x.mode) : null
    })),
    active: activeId,
    nav: {
      url: url === HOME ? '' : (t && t.translated && t.origUrl ? t.origUrl : url),
      home: url === HOME,
      site,
      canBack: wc ? canGo(wc, true) : false,
      canFwd: wc ? canGo(wc, false) : false,
      loading: t ? t.loading : false,
      blocked: t ? t.blocked : 0,
      extTab: EXT.ready() && t && !t.mode && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents.id : 0,
      allowed: site && !!store.get('allowSites')[baseDomain(hostOf(url))],
      adblock: !!store.get('adblock'),
      translated: t ? t.translated : false,
      autoscroll: t ? !!t.autoscroll : false,
      mode: t ? t.mode : null,
      modeName: t && t.mode ? modeName(t.mode) : null
    }
  };
}

function titleFor(url) {
  if (!url || url === HOME) return 'Главная';
  if (url.startsWith(SETTINGS)) return 'Настройки';
  if (url.startsWith(EXTENSIONS)) return 'Расширения';
  return hostOf(url).replace(/^www\./, '') || 'Новая вкладка';
}

// ======================================================================= сочетания клавиш

function shortcuts(e, input, t) {
  if (input.type !== 'keyDown') return;
  const ctrl = isMac ? input.meta : input.control;
  const k = (input.key || '').toLowerCase();
  const cur = t || activeTab();
  const wc = cur && cur.view ? cur.view.webContents : null;
  let done = true;
  if (ctrl && input.shift && k === 'n') newModeTab(null);
  else if (ctrl && input.shift && k === 't') {
    const u = closed.pop();
    if (u) newTab(u);
  } else if (ctrl && k === 't') newTab(HOME);
  else if (ctrl && (k === 'w' || k === 'f4')) {
    if (cur) closeTab(cur.id);
  } else if (ctrl && k === 'tab') cycle(input.shift ? -1 : 1);
  else if (ctrl && /^[1-9]$/.test(k)) {
    const n = Number(k);
    const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (target) activate(target.id);
  } else if ((ctrl && k === 'l') || k === 'f6' || (input.alt && k === 'd')) ui.webContents.send('focus-address');
  else if ((ctrl && k === 'r') || k === 'f5') {
    if (wc) (input.shift ? wc.reloadIgnoringCache() : wc.reload());
  } else if (ctrl && k === 'f') openFind();
  else if (input.alt && k === 'arrowleft') {
    if (wc && canGo(wc, true)) go(wc, true);
  } else if (input.alt && k === 'arrowright') {
    if (wc && canGo(wc, false)) go(wc, false);
  } else if (ctrl && (k === '=' || k === '+')) zoom(cur, 0.5);
  else if (ctrl && k === '-') zoom(cur, -0.5);
  else if (ctrl && k === '0') zoom(cur, 0);
  else if (ctrl && k === 'p') {
    if (wc) wc.print();
  } else if (ctrl && k === 'd') addToHome(cur);
  else if (ctrl && k === 'j') openPage(DOWNLOADS);
  else if (ctrl && input.shift && k === 's') shotArea(cur);
  else if (k === 'f11') win.setFullScreen(!win.isFullScreen());
  else if (k === 'f12' || (ctrl && input.shift && k === 'i')) {
    if (wc) wc.toggleDevTools();
  } else if (k === 'escape' && findOpen) closeFind();
  else done = false;
  if (done) e.preventDefault();
}

function cycle(dir) {
  if (!tabs.length) return;
  const i = tabs.findIndex((x) => x.id === activeId);
  activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}

function zoom(t, step) {
  if (!t || !t.view) return;
  const wc = t.view.webContents;
  const z = step === 0 ? 0 : Math.max(-4, Math.min(5, wc.getZoomLevel() + step));
  wc.setZoomLevel(z);
  const pct = Math.round(Math.pow(1.2, z) * 100);
  toast('Масштаб ' + pct + '%');
}

// ======================================================================= поиск по странице

function openFind() {
  findOpen = true;
  layout();
  ui.webContents.send('find-open');
  sendState();
}

function closeFind() {
  findOpen = false;
  const t = activeTab();
  if (t && t.view) t.view.webContents.stopFindInPage('clearSelection');
  layout();
  sendState();
}

// ======================================================================= режимы BySS

function newMode() {
  const modes = store.get('modes') || [];
  let n = modes.length + 1;
  while (modes.some((m) => m.name === 'BySS ' + n)) n++;
  const m = { id: Date.now().toString(36), name: 'BySS ' + n };
  modes.push(m);
  store.set('modes', modes);
  return m.id;
}

function newModeTab(mode) {
  const modes = store.get('modes') || [];
  const id = mode || (modes.length ? modes[modes.length - 1].id : newMode());
  newTab(HOME, { mode: id });
}

async function deleteMode(id) {
  const name = modeName(id);
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Удалить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    title: 'Удалить режим',
    message: 'Вы точно хотите удалить «' + name + '»?',
    detail: 'Сотрутся все вкладки, входы на сайтах, история и данные этого режима. Восстановить будет нельзя.'
  });
  if (r.response !== 0) return false;
  for (const t of tabs.filter((x) => x.mode === id)) closeTab(t.id);
  const ses = session.fromPartition('byss-' + id);
  try {
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
  } catch (e) {
    // данные режима и так живут только в памяти и пропадут при выходе
  }
  store.set('modes', (store.get('modes') || []).filter((m) => m.id !== id));
  sendState();
  toast('«' + name + '» удалён — от него ничего не осталось');
  return true;
}

// ======================================================================= меню

function siteBlocked(t) {
  if (!t || !/^https?:/.test(t.url) || !store.get('adblock')) return false;
  return !store.get('allowSites')[baseDomain(hostOf(t.url))];
}

/** Быстрый переключатель, как на телефоне: реклама и слежка на открытом сайте. */
function toggleSiteBlock(t) {
  if (!t || !/^https?:/.test(t.url)) return;
  const base = baseDomain(hostOf(t.url));
  const a = Object.assign({}, store.get('allowSites'));
  let on;
  if (!store.get('adblock')) {
    store.set('adblock', true); // была выключена везде — включаем и для этого сайта
    delete a[base];
    on = true;
  } else if (a[base]) {
    delete a[base];
    on = true;
  } else {
    a[base] = true;
    on = false;
  }
  store.set('allowSites', a);
  const asked = Object.assign({}, store.get('askedSites') || {});
  asked[base] = true; // выбрали сами — больше не спрашиваем про этот сайт
  store.set('askedSites', asked);
  if (t.view) t.view.webContents.reload();
  sendState();
  toast(on ? 'Реклама и слежка на ' + base + ' блокируются' : 'На ' + base + ' реклама и трекеры разрешены');
}

function shotMenu(t) {
  return {
    label: 'Скриншот',
    submenu: [
      { label: 'Видимая часть', click: () => shotVisible(t) },
      { label: 'Вся страница', click: () => shotFull(t) },
      { label: 'Выделить область…', accelerator: 'CmdOrCtrl+Shift+S', click: () => shotArea(t) }
    ]
  };
}

// ======================================================================= автоскролл
// Настройки общие для всех вкладок, запускается на текущей. Плавно — скорость 1…10,
// шагами — интервал в секундах и шаг в процентах экрана. Колесо мыши ставит на паузу.
// Колесом — браузер сам «крутит колёсико» через интервал: так листаются ленты вроде
// TikTok, которые обычную прокрутку не принимают.
const AS_SPEEDS = [15, 25, 40, 60, 85, 120, 170, 240, 340, 480]; // пикселей в секунду
const AS_INTERVALS = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60];
const AS_STEPS = [10, 25, 50, 75, 90, 100];
const AS_TICKS = [1, 2, 3, 5, 10];
const AS_MODES = ['smooth', 'step', 'wheel'];

function asCfg() {
  const a = Object.assign({ mode: 'smooth', level: 4, interval: 5, step: 75, ticks: 1 }, store.get('autoscroll') || {});
  a.level = Math.min(10, Math.max(1, Math.round(a.level) || 4));
  if (!AS_INTERVALS.includes(a.interval)) a.interval = 5;
  if (!AS_STEPS.includes(a.step)) a.step = 75;
  if (!AS_TICKS.includes(a.ticks)) a.ticks = 1;
  if (!AS_MODES.includes(a.mode)) a.mode = 'smooth';
  return a;
}

function asPayload() {
  const a = asCfg();
  return { mode: a.mode, speed: AS_SPEEDS[a.level - 1], interval: a.interval, step: a.step };
}

function setAsCfg(patch) {
  store.set('autoscroll', Object.assign(asCfg(), patch));
  for (const t of tabs) if (t.autoscroll) applyAutoscroll(t);
}

/** Передать вкладке текущее состояние: прокрутку ведёт страница, а «колесом» — сам браузер по таймеру. */
function applyAutoscroll(t) {
  clearInterval(t.asTimer);
  t.asTimer = null;
  if (!t.view || t.view.webContents.isDestroyed()) return;
  const wc = t.view.webContents;
  const a = asCfg();
  if (t.autoscroll && a.mode === 'wheel') {
    wc.send('byss:autoscroll', { on: false });
    t.asTimer = setInterval(() => wheelTick(t), a.interval * 1000);
  } else {
    wc.send('byss:autoscroll', { on: !!t.autoscroll, cfg: asPayload() });
  }
}

/** Один «щелчок» колёсика (или несколько) посреди страницы — как будто крутит пользователь. */
function wheelTick(t) {
  if (!t.autoscroll || !t.view || t.view.webContents.isDestroyed() || !tabs.includes(t)) {
    clearInterval(t.asTimer);
    t.asTimer = null;
    return;
  }
  if (t !== activeTab() || !win || win.isMinimized()) return; // фоновую вкладку не трогаем
  const b = t.view.getBounds();
  const n = asCfg().ticks;
  try {
    t.view.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: Math.round(b.width / 2),
      y: Math.round(b.height / 2),
      deltaX: 0,
      deltaY: -120 * n,
      wheelTicksX: 0,
      wheelTicksY: -n,
      canScroll: true
    });
  } catch (e) {
    // вкладка закрывается
  }
}

function setAutoscroll(t, on) {
  if (!t || !t.view || t.view.webContents.isDestroyed()) return;
  if (on && !/^https?:/.test(t.url)) return;
  t.autoscroll = !!on;
  applyAutoscroll(t);
  sendState();
  if (!on) return;
  const a = asCfg();
  if (a.mode === 'wheel') toast('Автоскролл колесом: каждые ' + a.interval + ' с. Стоп — кнопка в адресной строке');
  else toast('Автоскролл: колесо мыши — пауза, кнопка в адресной строке — стоп');
}

function ticksWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return n + ' щелчок';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' щелчка';
  return n + ' щелчков';
}

/** Соседнее значение из списка: dir = +1 / -1; null — дальше некуда. */
function asNext(list, v, dir) {
  const i = list.indexOf(v);
  const j = i + dir;
  return i < 0 || j < 0 || j >= list.length ? null : list[j];
}

function autoscrollGroup(t, act) {
  const a = asCfg();
  const children = [
    {
      id: act(() => setAutoscroll(t, !t.autoscroll)),
      icon: t.autoscroll ? 'pause' : 'play',
      label: t.autoscroll ? 'Остановить' : 'Запустить'
    },
    {
      type: 'seg',
      label: 'Режим',
      options: [
        { id: act(() => setAsCfg({ mode: 'smooth' }), true), label: 'Плавно', on: a.mode === 'smooth' },
        { id: act(() => setAsCfg({ mode: 'step' }), true), label: 'Шагами', on: a.mode === 'step' },
        { id: act(() => setAsCfg({ mode: 'wheel' }), true), label: 'Колесом', on: a.mode === 'wheel' }
      ]
    }
  ];
  const stepper = (label, value, list, cur, key, fmt) => {
    const dn = asNext(list, cur, -1);
    const up = asNext(list, cur, 1);
    return {
      type: 'stepper',
      label,
      value: fmt(value),
      dec: dn == null ? null : act(() => setAsCfg({ [key]: dn }), true),
      inc: up == null ? null : act(() => setAsCfg({ [key]: up }), true)
    };
  };
  if (a.mode === 'smooth') {
    children.push(stepper('Скорость', a.level, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], a.level, 'level', (v) => v + ' из 10'));
  } else if (a.mode === 'step') {
    children.push(stepper('Интервал', a.interval, AS_INTERVALS, a.interval, 'interval', (v) => v + ' с'));
    children.push(stepper('Шаг', a.step, AS_STEPS, a.step, 'step', (v) => v + '% экрана'));
  } else {
    children.push(stepper('Интервал', a.interval, AS_INTERVALS, a.interval, 'interval', (v) => v + ' с'));
    children.push(stepper('Колесо', a.ticks, AS_TICKS, a.ticks, 'ticks', ticksWord));
  }
  return {
    type: 'group',
    key: 'autoscroll',
    icon: 'autoscroll',
    label: 'Автоскролл',
    badge: t.autoscroll ? 'идёт' : null,
    children
  };
}

// Своё меню вместо системного: пункты по группам, «Удалить все данные» — красным,
// ниже другим цветом «Обновить браузер» и «Режим BySS». Ссылка, поиск и печать — в адресной строке.
let menuShown = false;
let menuReady = false;
let menuPending = null;
let menuActions = new Map();

const ACC = (k) => (isMac ? '⌘' : 'Ctrl+') + k;

/** Для YouTube: запустилась ли защита внутри страницы (сообщает preload-page.js). */
function ytNote(t) {
  if (!/(^|\.)youtube\.com$/i.test(hostOf(t.url)) || t.ytOk == null) return '';
  return t.ytOk ? ' · видео: защита ✓' : ' · видео: защита не запустилась';
}

function mainMenu(refresh) {
  const t = activeTab();
  const site = t && /^https?:/.test(t.url);
  const modes = store.get('modes') || [];
  const acts = new Map();
  let seq = 0;
  const act = (fn, keep) => {
    const k = 'a' + (++seq);
    acts.set(k, { fn, keep: !!keep }); // keep — меню остаётся открытым (настройка поменялась)
    return k;
  };
  const items = [];
  if (site) {
    const base = baseDomain(hostOf(t.url));
    const on = siteBlocked(t);
    const n = t.blocked || 0;
    items.push({
      type: 'switch',
      id: act(() => toggleSiteBlock(t)),
      icon: on ? 'shield' : 'shield_off',
      label: 'Блокировать рекламу и слежку',
      sub: !store.get('adblock') ? 'выключено везде · нажмите, чтобы включить'
        : base + (on ? (n ? ' · убрано ' + n : '') + ytNote(t) : ' · разрешено'),
      on
    });
    items.push({ type: 'sep' });
    items.push({
      type: 'group',
      icon: 'screenshot',
      label: 'Скриншот',
      children: [
        { id: act(() => shotVisible(t)), label: 'Видимая часть' },
        { id: act(() => shotFull(t)), label: 'Вся страница' },
        { id: act(() => shotArea(t)), label: 'Выделить область…', accel: ACC('Shift+S') }
      ]
    });
    items.push(autoscrollGroup(t, act));
    items.push({ id: act(() => addToHome(t)), icon: 'home', label: 'Добавить на главную', accel: ACC('D') });
  }
  items.push({ id: act(() => openPage(DOWNLOADS)), icon: 'download', label: 'Скачанные файлы', accel: ACC('J') });
  items.push({ id: act(() => openPage(EXTENSIONS)), icon: 'puzzle', label: 'Расширения' });
  items.push({ id: act(() => openSettings()), icon: 'settings', label: 'Доп. настройки' });
  items.push({
    id: act(() => setTheme(theme() === 'dark' ? 'light' : 'dark')),
    icon: 'theme',
    label: theme() === 'dark' ? 'Светлая тема' : 'Тёмная тема'
  });
  items.push({ type: 'sep' });
  items.push({ id: act(clearAll), icon: 'trash', label: 'Удалить все данные', color: 'danger' });
  items.push({ id: act(() => checkUpdates(true)), icon: 'reload', label: 'Обновить браузер', color: 'accent' });
  items.push({
    type: 'group',
    icon: 'incognito',
    label: 'Режим BySS',
    color: 'accent',
    children: [
      ...modes.map((m) => ({
        id: act(() => newModeTab(m.id)),
        icon: 'shield',
        label: m.name,
        trailing: { id: act(() => deleteMode(m.id)), icon: 'trash', title: 'Удалить «' + m.name + '»' }
      })),
      { id: act(() => newModeTab(newMode())), icon: 'plus', label: 'Новый режим BySS' }
    ]
  });
  showMenu(items, acts, refresh);
}

function showMenu(items, acts, refresh) {
  if (!win || !menuView) return;
  menuActions = acts;
  const msg = { items, light: theme() === 'light', top: top() - 4, refresh: !!refresh };
  if (menuReady) menuView.webContents.send('show', msg);
  else menuPending = msg;
  if (!menuShown) {
    win.contentView.addChildView(menuView);
    menuShown = true;
  }
  const [w, h] = win.getContentSize();
  menuView.setBounds({ x: 0, y: 0, width: w, height: h });
  menuView.webContents.focus();
}

function hideMenu() {
  if (!menuShown) return;
  menuShown = false;
  menuActions = new Map();
  try {
    win.contentView.removeChildView(menuView);
  } catch (e) {
    // уже убрано
  }
  const t = activeTab();
  if (t && t.view && !t.view.webContents.isDestroyed()) t.view.webContents.focus();
}

const ENGINE_NAMES = { google: 'Google', yandex: 'Яндекс', ddg: 'DuckDuckGo', bing: 'Bing' };

function engineMenu(x, y) {
  const cur = ENGINES[store.get('engine')] ? store.get('engine') : 'google';
  const items = [{ label: 'Поиск из адресной строки', enabled: false }, { type: 'separator' }];
  for (const k of Object.keys(ENGINE_NAMES)) {
    items.push({
      label: ENGINE_NAMES[k],
      type: 'radio',
      checked: k === cur,
      click: () => {
        store.set('engine', k);
        broadcastSettings();
        sendState();
        toast('Поиск из адресной строки: ' + ENGINE_NAMES[k]);
        ui.webContents.send('focus-address');
      }
    });
  }
  const opts = { window: win };
  if (Number.isFinite(x) && Number.isFinite(y)) {
    opts.x = Math.round(x);
    opts.y = Math.round(y);
  }
  Menu.buildFromTemplate(items).popup(opts);
}

function shieldMenu() {
  const t = activeTab();
  if (!t || !/^https?:/.test(t.url)) return;
  const base = baseDomain(hostOf(t.url));
  const allowed = !!store.get('allowSites')[base];
  Menu.buildFromTemplate([
    { label: base, enabled: false },
    { label: 'Заблокировано на странице: ' + t.blocked, enabled: false },
    { type: 'separator' },
    {
      label: 'Блокировать рекламу и трекеры на этом сайте',
      type: 'checkbox',
      checked: !allowed && store.get('adblock'),
      click: () => toggleSiteBlock(t)
    },
    {
      label: 'Блокировка везде',
      type: 'checkbox',
      checked: !!store.get('adblock'),
      click: () => {
        store.set('adblock', !store.get('adblock'));
        if (t.view) t.view.webContents.reload();
        sendState();
      }
    }
  ]).popup({ window: win });
}

function pageMenu(t, wc, p) {
  const items = [];
  if (p.linkURL) {
    items.push({ label: 'Открыть в новой вкладке', click: () => newTab(p.linkURL, { mode: t.mode, background: true }) });
    items.push({ label: 'Открыть во вкладке BySS', click: () => newTab(p.linkURL, { mode: t.mode || lastModeOrNew() }) });
    items.push({ label: 'Скопировать ссылку', click: () => clipboard.writeText(p.linkURL) });
    items.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: 'Открыть картинку в новой вкладке', click: () => newTab(p.srcURL, { mode: t.mode, background: true }) });
    items.push({ label: 'Скопировать картинку', click: () => wc.copyImageAt(p.x, p.y) });
    items.push({ label: 'Сохранить картинку', click: () => wc.downloadURL(p.srcURL) });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ label: 'Вырезать', enabled: p.editFlags.canCut, click: () => wc.cut() });
    items.push({ label: 'Копировать', enabled: p.editFlags.canCopy, click: () => wc.copy() });
    items.push({ label: 'Вставить', enabled: p.editFlags.canPaste, click: () => wc.paste() });
    items.push({ label: 'Выделить всё', click: () => wc.selectAll() });
    if (p.misspelledWord && p.dictionarySuggestions && p.dictionarySuggestions.length) {
      items.unshift({ type: 'separator' });
      items.unshift(...p.dictionarySuggestions.slice(0, 4).map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) })));
    }
    items.push({ type: 'separator' });
  } else if (p.selectionText) {
    const q = p.selectionText.trim().slice(0, 60);
    items.push({ label: 'Копировать', click: () => wc.copy() });
    items.push({ label: 'Найти «' + q + (p.selectionText.length > 60 ? '…' : '') + '»', click: () => newTab(searchUrl(store.get('engine'), p.selectionText), { mode: t.mode }) });
    items.push({
      label: 'Перевести выделенное',
      click: () => newTab('https://translate.google.com/?sl=auto&tl=ru&op=translate&text=' + encodeURIComponent(p.selectionText), { mode: t.mode })
    });
    items.push({ type: 'separator' });
  }
  items.push({ label: 'Назад', enabled: canGo(wc, true), click: () => go(wc, true) });
  items.push({ label: 'Вперёд', enabled: canGo(wc, false), click: () => go(wc, false) });
  items.push({ label: 'Обновить', click: () => wc.reload() });
  if (/^https?:/.test(t.url)) {
    items.push({ type: 'separator' });
    items.push({ label: t.translated ? 'Показать оригинал' : 'Перевести страницу', click: () => translate(t) });
    items.push(shotMenu(t));
  }
  const xi = t.mode ? [] : EXT.menuItems(wc, p);
  if (xi.length) {
    items.push({ type: 'separator' });
    items.push(...xi);
  }
  items.push({ type: 'separator' });
  items.push({ label: 'Просмотреть код', click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

function lastModeOrNew() {
  const modes = store.get('modes') || [];
  return modes.length ? modes[modes.length - 1].id : newMode();
}

function openSettings() {
  openPage(SETTINGS);
}

/** Внутренняя страница: уже открыта — переключиться, нет — новая вкладка. */
function openPage(url) {
  const t = tabs.find((x) => x.url.startsWith(url));
  if (t) activate(t.id);
  else newTab(url);
}

function setTheme(th) {
  store.set('theme', th);
  applyTheme();
}

function applyTheme() {
  const c = COLORS[theme()];
  nativeTheme.themeSource = theme();
  if (win) {
    win.setBackgroundColor(c.bg);
    if (!isMac) {
      try {
        win.setTitleBarOverlay({ color: c.bg, symbolColor: c.text, height: STRIP });
      } catch (e) {
        // старая система — без цветных кнопок окна
      }
    }
  }
  if (ui) ui.setBackgroundColor(c.bg);
  for (const t of tabs) if (t.view) t.view.setBackgroundColor(c.bg);
  broadcastSettings();
  sendState();
}

function broadcastSettings() {
  for (const t of tabs) {
    if (t.view && !t.view.webContents.isDestroyed() && t.url.startsWith('byss:')) {
      t.view.webContents.send('page:settings', settingsForPage(t));
    }
  }
}

async function clearAll() {
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Удалить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    title: 'Удалить все данные',
    message: 'Вы точно хотите удалить все данные?',
    detail: 'Сотрутся входы на сайтах, куки, кэш, история вкладок и решения по сайтам. Настройки и главная останутся.'
  });
  if (r.response !== 0) return;
  const ses = session.fromPartition('persist:main');
  try {
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
  } catch (e) {
    // не всё удалилось — попробуем ещё раз при следующем запуске
  }
  store.set('allowSites', {});
  store.set('askedSites', {});
  store.set('translate', {});
  store.set('downloads', []);
  memDownloads.length = 0;
  pushDownloads();
  closed.length = 0;
  for (const t of tabs.filter((x) => !x.mode)) closeTab(t.id);
  toast('Все данные удалены');
}

// ======================================================================= перевод

const LANGS = {
  de: 'немецком', cs: 'чешском', fr: 'французском', es: 'испанском', it: 'итальянском', pl: 'польском',
  nl: 'нидерландском', uk: 'украинском', ro: 'румынском', tr: 'турецком', pt: 'португальском', sk: 'словацком',
  bg: 'болгарском', sv: 'шведском', da: 'датском', fi: 'финском', no: 'норвежском', hu: 'венгерском',
  el: 'греческом', ja: 'японском', zh: 'китайском', ko: 'корейском', ar: 'арабском', he: 'иврите'
};

// Перевод делаем прямо на странице: сайт остаётся настоящим — работают входы, видео,
// YouTube и сайты вроде sauto.cz, которые через «прокси» Google Переводчика ломались.
const TR_WORLD = 1077;
let trScript = null;

function trCode() {
  if (trScript == null) trScript = fs.readFileSync(path.join(__dirname, 'translate-page.js'), 'utf8');
  return trScript;
}

function inWorld(wc, code) {
  // во время перехода на другую страницу ответ может не прийти — не ждём вечно
  return Promise.race([
    wc.executeJavaScriptInIsolatedWorld(TR_WORLD, [{ code }]),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Перевод пачки строк через Google (тот же переводчик, что и в Chrome). */
let gtxGetOnly = false;

async function gtxAsk(q, tl) {
  const base = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + tl + '&dt=t';
  const headers = { 'User-Agent': app.userAgentFallback };
  let r;
  if (!gtxGetOnly) {
    r = await net.fetch(base, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, headers),
      body: 'q=' + encodeURIComponent(q)
    });
    // сервер не принял POST — дальше спрашиваем обычной ссылкой
    if (!r.ok && r.status !== 429 && r.status < 500) gtxGetOnly = true;
  }
  if (gtxGetOnly) r = await net.fetch(base + '&q=' + encodeURIComponent(q), { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j && j[0] ? j[0] : []).map((x) => (x && x[0]) || '').join('');
}

async function gTranslate(texts, tl) {
  // пачки: длинный текст через POST, короче — если сервер понимает только ссылку
  const limit = gtxGetOnly ? 700 : 3500;
  const groups = [];
  let cur = [];
  let size = 0;
  for (const k of texts) {
    if (cur.length && size + k.length > limit) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(k);
    size += k.length + 1;
  }
  if (cur.length) groups.push(cur);
  const out = [];
  for (const g of groups) {
    const parts = (await gtxAsk(g.join('\n'), tl)).split('\n');
    if (parts.length === g.length) {
      g.forEach((k, i) => out.push([k, parts[i].trim()]));
      continue;
    }
    // строки «склеились» — переводим по одной (по 6 сразу)
    for (let i = 0; i < g.length; i += 6) {
      const chunk = g.slice(i, i + 6);
      const res = await Promise.all(chunk.map((k) => gtxAsk(k, tl).then((v) => v.trim()).catch(() => k)));
      chunk.forEach((k, j) => out.push([k, res[j]]));
    }
  }
  return out;
}

async function translateLoop(t) {
  const run = {};
  t.trRun = run;
  const wc = t.view && t.view.webContents;
  if (!wc) return;
  let fails = 0;
  let idle = 0;
  while (t.trRun === run && t.translated && !wc.isDestroyed()) {
    let keys;
    try {
      keys = await inWorld(wc, 'window.__byssTr ? window.__byssTr.take(3500) : null');
      if (keys == null) {
        await inWorld(wc, trCode());
        await sleep(150);
        continue;
      }
    } catch (e) {
      await sleep(500); // страница ещё грузится
      continue;
    }
    if (!keys.length) {
      // страница спокойна — проверяем реже (новые тексты, прокрутка, YouTube)
      idle++;
      await sleep(idle > 20 ? 1500 : 450);
      continue;
    }
    idle = 0;
    try {
      const pairs = await gTranslate(keys, 'ru');
      fails = 0;
      if (t.trRun !== run || wc.isDestroyed()) return;
      await inWorld(wc, 'window.__byssTr && window.__byssTr.put(' + JSON.stringify(pairs) + ')').catch(() => {});
    } catch (e) {
      fails++;
      // вернём тексты в очередь, чтобы попробовать ещё раз
      const back = JSON.stringify(keys.map((k) => [k, k]));
      await inWorld(wc, 'window.__byssTr && window.__byssTr.put(' + back + ')').catch(() => {});
      if (fails >= 3) {
        stopTranslate(t, false);
        showBubble({
          icon: 'translate',
          text: 'Не получилось перевести страницу',
          sub: /HTTP 429/.test(String(e)) ? 'Google просит подождать — попробуйте через минуту' : 'Нет связи с Google Переводчиком',
          buttons: [{ id: 'ok', label: 'Закрыть' }, { id: 'retry', label: 'Ещё раз', primary: true }]
        }, (b) => {
          if (b === 'retry') startTranslate(t);
        });
        return;
      }
      await sleep(1500 * fails);
    }
  }
}

function startTranslate(t) {
  if (!t || !t.view || !/^https?:/.test(t.url)) return;
  t.translated = true;
  t.trBase = baseDomain(hostOf(t.url));
  t.noAuto = null;
  translateLoop(t);
  sendState();
}

function stopTranslate(t, restore) {
  if (!t) return;
  t.translated = false;
  t.trRun = null;
  if (restore && t.view && !t.view.webContents.isDestroyed()) {
    inWorld(t.view.webContents, 'window.__byssTr ? window.__byssTr.restore() : true').catch(() => {});
  }
  sendState();
}

function translate(t) {
  if (!t) return;
  // старая вкладка, переведённая ещё через translate.google — вернуть настоящий сайт
  if (t.origUrl && /translate\.goog|translate\.google/.test(hostOf(t.url))) {
    const u = t.origUrl;
    t.origUrl = null;
    t.translated = false;
    t.noAuto = baseDomain(hostOf(u));
    navigate(t, u);
    return;
  }
  if (t.translated) {
    // «Показать оригинал» — и не переводить этот сайт заново сам, пока вы на нём
    t.noAuto = baseDomain(hostOf(t.url));
    stopTranslate(t, true);
    return;
  }
  startTranslate(t);
}

/** Новая страница загрузилась: если вкладка переведена, переводим и её (на том же сайте). */
function keepTranslating(t) {
  if (!t.translated) return;
  if (baseDomain(hostOf(t.url)) !== t.trBase || !/^https?:/.test(t.url)) {
    t.translated = false;
    t.trRun = null;
    sendState();
    return;
  }
  if (!t.trRun) translateLoop(t);
}

async function offerTranslate(t) {
  if (!t || !t.view || t.translated || !/^https?:/.test(t.url)) return;
  const host = hostOf(t.url);
  if (/(^|\.)(google|translate\.goog|youtube|yandex|ya)\./.test(host) || host.endsWith('translate.goog')) return;
  const base = baseDomain(host);
  if (t.noAuto === base) return;
  const choice = store.get('translate')[base];
  if (choice === 'no') return;
  let lang = '';
  try {
    lang = String(await t.view.webContents.executeJavaScript('(document.documentElement.lang||"").slice(0,2).toLowerCase()', false));
  } catch (e) {
    return;
  }
  if (!lang || lang === 'ru' || lang === 'en' || t.id !== activeId || t.translated) return;
  if (choice === 'yes') {
    startTranslate(t);
    return;
  }
  const remember = (v) => {
    const m = Object.assign({}, store.get('translate'));
    m[base] = v;
    store.set('translate', m);
  };
  showBubble({
    icon: 'translate',
    text: 'Страница на ' + (LANGS[lang] || 'другом языке') + '. Перевести на русский?',
    sub: base,
    buttons: [{ id: 'no', label: 'Нет' }, { id: 'yes', label: 'Перевести', primary: true }]
  }, (b) => {
    // «Нет» или крестик — для этого сайта больше не предлагаем
    remember(b === 'yes' ? 'yes' : 'no');
    if (b === 'yes') startTranslate(t);
  });
}

// ======================================================================= реклама: спросить на новом сайте
// При первом заходе на сайт браузер спрашивает, блокировать ли на нём рекламу и трекеры.

function askTrackers(t) {
  return new Promise((resolve) => {
    if (!t || !t.view || !/^https?:/.test(t.url) || !store.get('adblock') || t.id !== activeId) return resolve();
    const base = baseDomain(hostOf(t.url));
    if (!base || (store.get('askedSites') || {})[base] || store.get('allowSites')[base]) return resolve();
    const mark = () => {
      const m = Object.assign({}, store.get('askedSites') || {});
      m[base] = true;
      store.set('askedSites', m);
    };
    showBubble({
      icon: 'lock',
      text: 'Блокировать рекламу и трекеры на ' + base + '?',
      sub: (t.blocked ? 'Уже заблокировано: ' + t.blocked + '. ' : '') + 'Если сайт работает неправильно — разрешите.',
      buttons: [{ id: 'allow', label: 'Разрешить' }, { id: 'block', label: 'Блокировать', primary: true }],
      timeout: 20000
    }, (b) => {
      mark();
      if (b === 'allow') {
        const a = Object.assign({}, store.get('allowSites'));
        a[base] = true;
        store.set('allowSites', a);
        sendState();
        if (t.view) t.view.webContents.reload();
        toast('На ' + base + ' реклама и трекеры разрешены');
        return resolve();
      }
      resolve();
    }, () => resolve());
  });
}

async function afterLoad(t) {
  await askTrackers(t);
  offerTranslate(t);
}

// ======================================================================= главная: ярлыки

function addToHome(t) {
  if (!t || !/^https?:/.test(t.url)) return;
  const list = store.get('shortcuts') || [];
  if (list.length >= 24) {
    toast('На главной уже много сайтов — удалите лишние');
    return;
  }
  const host = hostOf(t.url).replace(/^www\./, '');
  if (list.some((s) => hostOf(s.url).replace(/^www\./, '') === host)) {
    toast('Этот сайт уже на главной');
    return;
  }
  list.push({ title: (t.title || host).slice(0, 24), url: t.url });
  store.set('shortcuts', list);
  broadcastSettings();
  toast('Добавлено на главную');
}

// Значки сайтов для главной: ищем самый крупный и чёткий — значки из манифеста сайта,
// apple-touch-icon, крупные <link rel=icon>, векторные (svg); favicon.ico — в последнюю очередь.
const iconDir = () => path.join(app.getPath('userData'), 'site_icons2');

async function siteIcon(url) {
  const host = hostOf(url);
  if (!host) return null;
  const file = path.join(iconDir(), host.replace(/[^a-z0-9.-]/g, '_') + '.json');
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 14 * 24 * 3600 * 1000) {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      return c && c.data ? 'data:' + c.type + ';base64,' + c.data : null;
    }
  } catch (e) {
    // ещё нет
  }
  const cands = [];
  const add = (u, size, base, svg) => {
    try {
      const abs = new URL(u, base).toString();
      if (!/^https?:/.test(abs) || cands.some((c) => c.url === abs)) return;
      cands.push({ url: abs, size, svg: !!svg });
    } catch (e) {
      // кривая ссылка
    }
  };
  let origin = 'https://' + host + '/';
  try {
    const pg = await fetchText(origin);
    origin = pg.url || origin;
    const links = [...pg.text.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    for (const l of links) {
      const rel = ((l.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || '').toLowerCase();
      const href = (l.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (!href || href.startsWith('data:')) continue;
      if (rel.includes('manifest')) {
        try {
          const murl = new URL(href, origin).toString();
          const r = await net.fetch(murl, { headers: { 'User-Agent': app.userAgentFallback } });
          const m = JSON.parse(await r.text());
          for (const ic of (m.icons || [])) {
            if (!ic.src || /monochrome/i.test(ic.purpose || '')) continue;
            const sz = Math.max(0, ...String(ic.sizes || '').split(/\s+/).map((x) => parseInt(x, 10) || 0));
            const svg = /svg/i.test(ic.type || '') || /\.svg(\?|$)/i.test(ic.src);
            add(ic.src, svg ? 512 : sz, murl, svg);
          }
        } catch (e) {
          // манифеста нет
        }
        continue;
      }
      if (!/icon/.test(rel) || rel.includes('mask-icon')) continue;
      const sizes = (l.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1];
      const any = /sizes\s*=\s*["']?any/i.test(l);
      const svg = /\.svg(\?|$)/i.test(href) || /type\s*=\s*["']image\/svg/i.test(l);
      const size = svg || any ? 512 : sizes ? Number(sizes) : (rel.includes('apple-touch') ? 180 : 32);
      add(href, size, origin, svg);
    }
  } catch (e) {
    // сайт не открылся — пробуем стандартные адреса
  }
  add('/apple-touch-icon.png', 180, origin);
  add('/apple-touch-icon-precomposed.png', 179, origin);
  add('/favicon.ico', 40, origin);
  // крупнее — лучше, но огромные (>512) не нужны: чёткости хватает и так
  const score = (c) => (c.size >= 96 ? 1000 - Math.abs(256 - Math.min(c.size, 512)) : c.size);
  cands.sort((a, b) => score(b) - score(a));
  for (const c of cands.slice(0, 8)) {
    try {
      const r = await net.fetch(c.url, { headers: { 'User-Agent': app.userAgentFallback } });
      if (!r.ok) continue;
      let type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (type.includes('html') || type.includes('json') || type.includes('text/plain')) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100) continue;
      if (c.svg || type.includes('svg')) {
        if (!/<svg[\s>]/i.test(buf.slice(0, 4000).toString('utf8'))) continue;
        type = 'image/svg+xml';
      } else if (!type.startsWith('image/')) {
        type = /\.ico(\?|$)/i.test(c.url) ? 'image/x-icon' : 'image/png';
      }
      fs.mkdirSync(iconDir(), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ type, data: buf.toString('base64') }));
      return 'data:' + type + ';base64,' + buf.toString('base64');
    } catch (e) {
      // следующий вариант
    }
  }
  try {
    fs.mkdirSync(iconDir(), { recursive: true });
    fs.writeFileSync(file, '{}'); // нет значка — не спрашиваем 2 недели
  } catch (e) {
    // не страшно
  }
  return null;
}

async function fetchText(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': app.userAgentFallback, Accept: 'text/html' } });
  const text = await r.text();
  return { text: text.slice(0, 400000), url: r.url || url };
}

// ======================================================================= загрузки

// Список загрузок (как «Скачанные файлы» на телефоне): обычные — в настройках, из режимов BySS —
// только в памяти до выхода (сами файлы остаются в «Загрузках»).
const memDownloads = [];
const liveDownloads = new Map(); // id → DownloadItem

function allDownloads() {
  return memDownloads.concat(store.get('downloads') || []).sort((a, b) => b.time - a.time);
}

function findDownload(id) {
  return allDownloads().find((d) => d.id === id) || null;
}

function saveDownloads() {
  const list = (store.get('downloads') || []).slice(0, 300);
  store.set('downloads', list);
}

function downloadsForPage() {
  return allDownloads().map((d) => Object.assign({}, d, {
    exists: d.state === 'completed' ? fs.existsSync(d.file) : false,
    live: liveDownloads.has(d.id)
  }));
}

let dlPushTimer = null;
function pushDownloads() {
  clearTimeout(dlPushTimer);
  dlPushTimer = setTimeout(() => {
    const list = downloadsForPage();
    for (const t of tabs) {
      if (t.view && !t.view.webContents.isDestroyed() && t.url.startsWith(DOWNLOADS)) {
        t.view.webContents.send('page:downloads', list);
      }
    }
  }, 120);
}

function download(item, incognito) {
  const dir = app.getPath('downloads');
  const name = item.getFilename() || 'file';
  let file = path.join(dir, name);
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; fs.existsSync(file) && i < 500; i++) file = path.join(dir, stem + ' (' + i + ')' + ext);
  item.setSavePath(file);
  const id = 'dl' + Date.now() + Math.floor(Math.random() * 1000);
  const entry = {
    id, name: path.basename(file), file, url: item.getURL(), size: item.getTotalBytes(), got: 0,
    state: 'progress', time: Date.now(), mode: !!incognito
  };
  if (incognito) memDownloads.unshift(entry);
  else {
    const list = (store.get('downloads') || []).slice();
    list.unshift(entry);
    store.set('downloads', list.slice(0, 300));
  }
  liveDownloads.set(id, item);
  pushDownloads();
  let last = 0;
  item.on('updated', (e, state) => {
    entry.got = item.getReceivedBytes();
    entry.size = item.getTotalBytes();
    entry.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progress');
    pushDownloads();
    if (Date.now() - last < 300) return;
    last = Date.now();
    const total = entry.size;
    const got = entry.got;
    showBubble({
      id,
      icon: 'download',
      text: 'Скачиваю ' + path.basename(file),
      sub: total ? mb(got) + ' из ' + mb(total) : mb(got),
      progress: total ? got / total : -1,
      buttons: [{ id: 'list', label: 'Все загрузки' }, { id: 'cancel', label: 'Отмена' }]
    }, (b) => {
      if (b === 'cancel') item.cancel();
      if (b === 'list') openPage(DOWNLOADS);
    });
  });
  item.once('done', (e, state) => {
    liveDownloads.delete(id);
    entry.state = state;
    entry.got = item.getReceivedBytes();
    if (!entry.size) entry.size = entry.got;
    if (!incognito) saveDownloads();
    pushDownloads();
    if (state === 'completed') {
      showBubble({
        id,
        icon: 'download',
        text: 'Скачано: ' + path.basename(file),
        sub: incognito ? 'Файл сохранён в «Загрузки» — он останется и после удаления режима' : 'Папка «Загрузки» · Ctrl+J — все загрузки',
        buttons: [{ id: 'folder', label: 'Показать в папке' }, { id: 'open', label: 'Открыть', primary: true }],
        timeout: 9000
      }, (b) => {
        if (b === 'open') shell.openPath(file);
        if (b === 'folder') shell.showItemInFolder(file);
      });
    } else if (state === 'cancelled') {
      showBubble({ id, icon: 'download', text: 'Загрузка отменена', timeout: 2500 });
    } else {
      showBubble({ id, icon: 'download', text: 'Не удалось скачать ' + path.basename(file), sub: 'Попробуйте ещё раз', timeout: 5000 });
    }
  });
}

function removeDownload(id) {
  const i = memDownloads.findIndex((d) => d.id === id);
  if (i >= 0) memDownloads.splice(i, 1);
  store.set('downloads', (store.get('downloads') || []).filter((d) => d.id !== id));
  pushDownloads();
}

const fileIcons = new Map();
async function downloadIcon(id) {
  const d = findDownload(id);
  if (!d || !fs.existsSync(d.file)) return null;
  const key = path.extname(d.file).toLowerCase() || d.file;
  // у .exe и ярлыков свой значок у каждого файла
  const own = ['.exe', '.lnk', '.ico', ''].includes(key);
  if (!own && fileIcons.has(key)) return fileIcons.get(key);
  try {
    const img = await app.getFileIcon(d.file, { size: 'normal' });
    const url = img.isEmpty() ? null : img.toDataURL();
    if (!own) fileIcons.set(key, url);
    return url;
  } catch (e) {
    return null;
  }
}

function mb(b) {
  return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
}

// ======================================================================= скриншоты

function shotsDir() {
  const dir = path.join(app.getPath('pictures'), store.get('name') || 'BySS');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function shotFile() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stem = (store.get('name') || 'BySS').replace(/[^\p{L}\d _-]/gu, '') + '_' + d.getFullYear() + pad(d.getMonth() + 1)
    + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  let file = path.join(shotsDir(), stem + '.png');
  for (let i = 2; fs.existsSync(file) && i < 100; i++) file = path.join(shotsDir(), stem + '_' + i + '.png');
  return file;
}

function shotSaved(buf, note, copied) {
  const file = shotFile();
  fs.writeFileSync(file, buf);
  if (copied) clipboard.writeImage(nativeImage.createFromBuffer(buf));
  showBubble({
    id: 'shot',
    icon: 'shot',
    text: copied ? 'Снимок сохранён и скопирован' : 'Снимок сохранён',
    sub: 'Изображения → ' + path.basename(path.dirname(file)) + (note ? ' · ' + note : ''),
    buttons: [
      ...(copied ? [] : [{ id: 'copy', label: 'Копировать' }]),
      { id: 'folder', label: 'Показать в папке' },
      { id: 'open', label: 'Открыть', primary: true }
    ],
    timeout: 10000
  }, (b) => {
    if (b === 'open') shell.openPath(file);
    if (b === 'folder') shell.showItemInFolder(file);
    if (b === 'copy') {
      clipboard.writeImage(nativeImage.createFromBuffer(buf));
      toast('Снимок скопирован — вставьте его куда нужно (Ctrl+V)');
    }
  });
}

function shotError(e) {
  showBubble({ id: 'shot', icon: 'shot', text: 'Не получилось сделать снимок', sub: String((e && e.message) || e).slice(0, 120), timeout: 5000 });
}

function shotTarget(t) {
  if (!t || !t.view || !/^https?:/.test(t.url)) {
    toast('Скриншот делается на открытом сайте');
    return null;
  }
  return t.view.webContents;
}

/** Что сейчас видно на странице. */
async function shotVisible(t) {
  const wc = shotTarget(t);
  if (!wc) return;
  try {
    const img = await wc.capturePage();
    shotSaved(img.toPNG(), '');
  } catch (e) {
    shotError(e);
  }
}

/** Кусок страницы в координатах документа (CSS-пиксели) — через DevTools, за пределами экрана тоже. */
async function captureClip(wc, clip) {
  let attached = false;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      attached = true;
    }
    const r = await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: Object.assign({ scale: 1 }, clip)
    });
    return Buffer.from(r.data, 'base64');
  } finally {
    if (attached) {
      try {
        wc.debugger.detach();
      } catch (e) {
        // уже отключён
      }
    }
  }
}

/** Вся страница сверху донизу. */
async function shotFull(t) {
  const wc = shotTarget(t);
  if (!wc) return;
  showBubble({ id: 'shot', icon: 'shot', text: 'Делаю снимок всей страницы…', progress: -1 });
  try {
    let size;
    let attached = false;
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3');
        attached = true;
      }
      const m = await wc.debugger.sendCommand('Page.getLayoutMetrics');
      size = m.cssContentSize || m.contentSize;
    } finally {
      if (attached) {
        try {
          wc.debugger.detach();
        } catch (e) {
          // уже отключён
        }
      }
    }
    const width = Math.ceil(size.width);
    const height = Math.min(Math.ceil(size.height), 30000);
    const buf = await captureClip(wc, { x: 0, y: 0, width, height });
    shotSaved(buf, height >= 30000 ? 'страница очень длинная, снято 30 000 точек' : '');
  } catch (e) {
    shotError(e);
  }
}

// Выделение области мышью прямо на странице. Можно тянуть за край экрана — страница
// прокрутится сама (или крутите колёсико), так снимается и длинный кусок.
const SELECT_JS = String.raw`(() => new Promise((done) => {
  const d = document, de = d.documentElement;
  const S = (el, st) => { Object.assign(el.style, st); return el; };
  const mk = (tag, st, text) => { const e = d.createElement(tag); if (text) e.textContent = text; return S(e, st); };
  const font = '13px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
  const W = () => Math.max(de.scrollWidth, d.body ? d.body.scrollWidth : 0, innerWidth);
  const H = () => Math.max(de.scrollHeight, d.body ? d.body.scrollHeight : 0, innerHeight);
  const root = mk('div', { position: 'absolute', left: '0', top: '0', width: W() + 'px', height: H() + 'px',
    zIndex: '2147483647', cursor: 'crosshair', background: 'rgba(0,0,0,.38)', userSelect: 'none', margin: '0', padding: '0' });
  const sel = mk('div', { position: 'absolute', display: 'none', border: '2px solid #fff', boxSizing: 'border-box',
    boxShadow: '0 0 0 100000px rgba(0,0,0,.38)', pointerEvents: 'none', borderRadius: '2px' });
  const size = mk('div', { position: 'absolute', display: 'none', font, fontSize: '12px', fontWeight: '600', color: '#000',
    background: '#fff', borderRadius: '10px', padding: '3px 9px', pointerEvents: 'none', whiteSpace: 'nowrap' });
  const hint = mk('div', { position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)', font, color: '#F2F2F7',
    background: 'rgba(28,28,30,.96)', borderRadius: '16px', padding: '9px 16px', boxShadow: '0 6px 22px rgba(0,0,0,.45)',
    zIndex: '2147483647', pointerEvents: 'none', textAlign: 'center', maxWidth: '86vw' },
    'Выделите мышью нужную часть. Тяните за край окна или крутите колёсико — так можно снять длинный кусок. Enter — сохранить, Esc — отмена');
  const bar = mk('div', { position: 'absolute', display: 'none', gap: '6px', padding: '6px', background: 'rgba(28,28,30,.97)',
    borderRadius: '18px', boxShadow: '0 6px 22px rgba(0,0,0,.45)', zIndex: '2147483647' });
  const btn = (label, primary) => {
    const b = mk('button', { font, border: '0', borderRadius: '13px', padding: '7px 14px', cursor: 'default',
      background: primary ? '#F2F2F7' : 'rgba(255,255,255,.14)', color: primary ? '#000' : '#F2F2F7', fontWeight: primary ? '600' : '400' }, label);
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    bar.appendChild(b);
    return b;
  };
  const bCancel = btn('Отмена'), bCopy = btn('Сохранить и копировать'), bSave = btn('Сохранить', true);
  root.append(sel, size, bar);
  de.appendChild(root);
  de.appendChild(hint);
  let a = null, b = null, drag = false, cx = 0, cy = 0, raf = 0;
  const rect = () => {
    if (!a || !b) return null;
    const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
    return { x, y, width: Math.min(W(), Math.max(a.x, b.x)) - x, height: Math.min(H(), Math.max(a.y, b.y)) - y };
  };
  const draw = () => {
    const r = rect();
    if (!r) return;
    root.style.background = 'transparent';
    S(sel, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
    size.textContent = Math.round(r.width) + ' × ' + Math.round(r.height);
    S(size, { display: 'block', left: r.x + 'px', top: Math.max(0, r.y - 26) + 'px' });
  };
  const finish = (action) => {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', key, true);
    removeEventListener('scroll', onScroll, true);
    removeEventListener('mousemove', move, true);
    removeEventListener('mouseup', up, true);
    root.remove();
    hint.remove();
    const r = rect();
    done(action && r && r.width >= 4 && r.height >= 4 ? Object.assign(r, { action }) : null);
  };
  const showBar = () => {
    const r = rect();
    if (!r || r.width < 4 || r.height < 4) { bar.style.display = 'none'; return; }
    S(bar, { display: 'flex' });
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = r.x + r.width - bw, y = r.y + r.height + 8;
    if (y + bh > scrollY + innerHeight - 4) y = Math.max(r.y + 8, scrollY + innerHeight - bh - 12);
    S(bar, { left: Math.max(scrollX + 8, x) + 'px', top: y + 'px' });
  };
  const toPage = () => ({ x: cx + scrollX, y: cy + scrollY });
  const tick = () => {
    if (!drag) return;
    const edge = 46;
    let dy = 0;
    if (cy > innerHeight - edge) dy = Math.ceil((cy - (innerHeight - edge)) / 2.2);
    else if (cy < edge) dy = -Math.ceil((edge - cy) / 2.2);
    if (dy) scrollBy(0, dy);
    b = toPage();
    draw();
    raf = requestAnimationFrame(tick);
  };
  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    cx = e.clientX; cy = e.clientY;
    a = toPage(); b = a; drag = true;
    bar.style.display = 'none';
    hint.style.display = 'none';
    raf = requestAnimationFrame(tick);
  });
  const move = (e) => {
    if (!drag) return;
    cx = e.clientX; cy = e.clientY;
    b = toPage();
    draw();
  };
  const up = () => {
    if (!drag) return;
    drag = false;
    cancelAnimationFrame(raf);
    b = toPage();
    draw();
    showBar();
  };
  addEventListener('mousemove', move, true);
  addEventListener('mouseup', up, true);
  const onScroll = () => { if (drag) { b = toPage(); draw(); } };
  addEventListener('scroll', onScroll, true);
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish('save'); }
  };
  addEventListener('keydown', key, true);
  root.addEventListener('contextmenu', (e) => { e.preventDefault(); finish(null); });
  bCancel.onclick = () => finish(null);
  bSave.onclick = () => finish('save');
  bCopy.onclick = () => finish('copy');
}))()`;

async function shotArea(t) {
  const wc = shotTarget(t);
  if (!wc || t.selecting) return;
  t.selecting = true;
  wc.focus();
  let off = null;
  const gone = new Promise((resolve) => {
    off = () => resolve(null);
    wc.once('did-start-navigation', off);
    wc.once('destroyed', off);
  });
  try {
    const r = await Promise.race([wc.executeJavaScriptInIsolatedWorld(1077, [{ code: SELECT_JS }], true), gone]);
    if (!r || !r.width || !r.height) return;
    await new Promise((res) => setTimeout(res, 80)); // рамка выделения успевает исчезнуть
    const clip = { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.min(Math.ceil(r.height), 30000) };
    showBubble({ id: 'shot', icon: 'shot', text: 'Сохраняю выделенное…', progress: -1 });
    const buf = await captureClip(wc, clip);
    shotSaved(buf, r.height > 30000 ? 'выделено очень много, снято 30 000 точек' : '', r.action === 'copy');
  } catch (e) {
    shotError(e);
  } finally {
    t.selecting = false;
    if (off && !wc.isDestroyed()) {
      wc.removeListener('did-start-navigation', off);
      wc.removeListener('destroyed', off);
    }
  }
}

// ======================================================================= всплывающие сообщения

let bubbleShown = false;
let bubbleReady = false;
let bubblePending = null;
let bubbleHeight = 96;
let bubbleTimer = null;
const bubbleCallbacks = new Map();
let currentBubble = null;

function showBubble(msg, onClick, onDismiss) {
  if (!bubble) return;
  const id = msg.id || 'b' + Date.now() + Math.random();
  msg.id = id;
  if (currentBubble && currentBubble.id !== id) {
    const prev = bubbleCallbacks.get(currentBubble.id);
    if (prev && prev.dismiss) prev.dismiss();
    bubbleCallbacks.delete(currentBubble.id);
  }
  if (onClick || onDismiss) bubbleCallbacks.set(id, { click: onClick, dismiss: onDismiss });
  currentBubble = msg;
  msg.light = theme() === 'light';
  if (bubbleReady) bubble.webContents.send('show', msg);
  else bubblePending = msg;
  if (!bubbleShown) {
    win.contentView.addChildView(bubble);
    bubbleShown = true;
  }
  layoutBubble();
  clearTimeout(bubbleTimer);
  const timeout = msg.timeout || (msg.buttons && msg.buttons.length ? 0 : 3200);
  if (timeout) bubbleTimer = setTimeout(() => hideBubble(id, true), timeout);
}

function toast(text) {
  showBubble({ text, timeout: 2600 });
}

function hideBubble(id, dismissed) {
  if (!currentBubble || (id && currentBubble.id !== id)) return;
  const cb = bubbleCallbacks.get(currentBubble.id);
  if (dismissed && cb && cb.dismiss) cb.dismiss();
  bubbleCallbacks.delete(currentBubble.id);
  currentBubble = null;
  if (bubbleShown) {
    try {
      win.contentView.removeChildView(bubble);
    } catch (e) {
      // уже убран
    }
    bubbleShown = false;
  }
}

function layoutBubble() {
  if (!win || !bubbleShown) return;
  const [w, h] = win.getContentSize();
  const bw = Math.min(480, w - 24);
  bubble.setBounds({ x: Math.round((w - bw) / 2), y: Math.max(top(), h - bubbleHeight - 18), width: bw, height: bubbleHeight });
}

// ======================================================================= обновления

let manualCheck = false;
let updating = false;

function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    showBubble({
      id: 'upd',
      icon: 'update',
      text: 'Есть новая версия ' + info.version + ' (у вас ' + app.getVersion() + ')',
      sub: 'Точно обновить? Вкладки и настройки сохранятся.',
      buttons: [{ id: 'later', label: 'Не сейчас' }, { id: 'go', label: 'Обновить', primary: true }]
    }, (b) => {
      if (b !== 'go') return;
      updating = true;
      showBubble({ id: 'upd', icon: 'update', text: 'Подключаюсь к GitHub…', progress: -1 });
      autoUpdater.downloadUpdate().catch(() => {});
    });
    manualCheck = false;
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      showBubble({ id: 'upd', icon: 'update', text: 'Обновлений нет', sub: 'У вас последняя версия — ' + app.getVersion(), timeout: 4000 });
    }
    manualCheck = false;
  });
  autoUpdater.on('download-progress', (p) => {
    const left = p.bytesPerSecond > 0 ? (p.total - p.transferred) / p.bytesPerSecond : 0;
    showBubble({
      id: 'upd',
      icon: 'update',
      text: 'Скачиваю обновление — ' + Math.floor(p.percent) + '%',
      sub: mb(p.transferred) + ' из ' + mb(p.total) + ' · ' + mb(p.bytesPerSecond) + '/с'
        + (left > 0 ? ' · осталось ' + (left < 60 ? Math.ceil(left) + ' с' : Math.ceil(left / 60) + ' мин') : ''),
      progress: p.percent / 100
    });
  });
  autoUpdater.on('update-downloaded', () => {
    updating = false;
    showBubble({
      id: 'upd',
      icon: 'update',
      text: 'Обновление скачано',
      sub: 'Перезапустить браузер сейчас? Вкладки откроются снова.',
      buttons: [{ id: 'later', label: 'При выходе' }, { id: 'restart', label: 'Перезапустить', primary: true }]
    }, (b) => {
      if (b !== 'restart') return;
      saveSession();
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
    });
  });
  autoUpdater.on('error', (e) => {
    if (manualCheck || updating) {
      showBubble({
        id: 'upd',
        icon: 'update',
        text: 'Обновление не удалось',
        sub: /ENOTFOUND|ECONN|net::/.test(String(e)) ? 'Нет связи с GitHub — проверьте интернет' : String((e && e.message) || e).slice(0, 140),
        buttons: [{ id: 'ok', label: 'Закрыть' }, { id: 'retry', label: 'Повторить', primary: true }]
      }, (b) => {
        if (b === 'retry') checkUpdates(true);
      });
    }
    manualCheck = false;
    updating = false;
  });
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
}

function checkUpdates(manual) {
  if (!autoUpdater || !app.isPackaged) {
    toast('Обновления работают в установленной версии');
    return;
  }
  manualCheck = manual;
  if (manual) showBubble({ id: 'upd', icon: 'update', text: 'Проверяю обновления…', progress: -1 });
  autoUpdater.checkForUpdates().catch(() => {});
}

// ======================================================================= сессия вкладок

function sessionFile() {
  return path.join(app.getPath('userData'), 'tabs.json');
}

function saveSession() {
  try {
    const list = tabs.filter((t) => !t.mode).map((t) => ({ url: t.translated && t.origUrl ? t.origUrl : t.url, title: t.title }));
    const act = activeTab();
    const idx = act && !act.mode ? tabs.filter((t) => !t.mode).indexOf(act) : 0;
    fs.writeFileSync(sessionFile(), JSON.stringify({ tabs: list, active: idx }));
  } catch (e) {
    // не удалось сохранить вкладки
  }
  if (store) store.flush();
}

function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
  } catch (e) {
    saved = null;
  }
  const startUrls = process.argv.slice(1).filter((a) => /^https?:\/\//i.test(a));
  if (store.get('restoreTabs') && saved && saved.tabs && saved.tabs.length) {
    for (const s of saved.tabs.slice(0, MAX_TABS)) newTab(s.url, { lazy: true, title: s.title, index: tabs.length });
    const a = tabs[Math.max(0, Math.min(saved.active || 0, tabs.length - 1))];
    activate(a.id);
  } else {
    newTab(HOME);
  }
  for (const u of startUrls) newTab(u);
}

// ======================================================================= связь с панелью и страницами

function fromUi(e) {
  return ui && e.sender === ui.webContents;
}

function setupIpc() {
  // YouTube: реклама в видео идёт с тех же серверов, что и само видео, поэтому её не отрезать
  // по адресу. Скрипт (yt.js) убирает её из ответов плеера ещё до запуска страницы.
  // Ответ: null — рекламу на YouTube не трогаем (блокировка выключена или сайт разрешён).
  ipcMain.on('site:yt', (e, host) => {
    e.returnValue = null;
    try {
      if (!tabByWc(e.sender.id) || !/(^|\.)youtube\.com$/i.test(String(host || ''))) return;
      if (!store.get('adblock') || store.get('allowSites')['youtube.com']) return;
      if (YT_JS === null) {
        try { YT_JS = fs.readFileSync(path.join(__dirname, 'yt.js'), 'utf8'); } catch (err) { YT_JS = ''; }
      }
      e.returnValue = { code: YT_JS || '' };
    } catch (err) {
      e.returnValue = null;
    }
  });

  ipcMain.on('ui:ready', (e) => {
    if (fromUi(e)) sendState();
  });
  ipcMain.on('tab:new', (e) => fromUi(e) && newTab(HOME));
  ipcMain.on('tab:activate', (e, id) => fromUi(e) && activate(id));
  ipcMain.on('tab:close', (e, id) => fromUi(e) && closeTab(id));
  ipcMain.on('tab:menu', (e, id) => {
    if (!fromUi(e)) return;
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    Menu.buildFromTemplate([
      { label: 'Обновить', click: () => t.view && t.view.webContents.reload() },
      { label: 'Дублировать', click: () => newTab(t.url, { mode: t.mode }) },
      { label: 'Скопировать ссылку', click: () => clipboard.writeText(t.url) },
      { type: 'separator' },
      { label: 'Закрыть другие вкладки', click: () => tabs.filter((x) => x !== t).forEach((x) => closeTab(x.id)) },
      { label: 'Закрыть вкладку', click: () => closeTab(t.id) }
    ]).popup({ window: win });
  });
  ipcMain.on('tab:move', (e, id, to) => {
    if (!fromUi(e)) return;
    const i = tabs.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [t] = tabs.splice(i, 1);
    tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t);
    sendState();
  });
  ipcMain.on('nav:go', (e, text) => {
    if (!fromUi(e)) return;
    const url = toUrl(text);
    const t = activeTab();
    if (url && t) navigate(t, url);
  });
  ipcMain.on('nav:back', (e) => {
    const t = activeTab();
    if (fromUi(e) && t && t.view && canGo(t.view.webContents, true)) go(t.view.webContents, true);
  });
  ipcMain.on('nav:forward', (e) => {
    const t = activeTab();
    if (fromUi(e) && t && t.view && canGo(t.view.webContents, false)) go(t.view.webContents, false);
  });
  ipcMain.on('nav:reload', (e) => {
    const t = activeTab();
    if (!fromUi(e) || !t || !t.view) return;
    if (t.loading) t.view.webContents.stop();
    else t.view.webContents.reload();
  });
  ipcMain.on('nav:home', (e) => {
    const t = activeTab();
    if (fromUi(e) && t) navigate(t, HOME);
  });
  ipcMain.on('ui:menu', (e) => fromUi(e) && (menuShown ? hideMenu() : mainMenu()));
  ipcMain.on('menu:pick', (e, id) => {
    if (!menuView || e.sender !== menuView.webContents) return;
    const a = menuActions.get(id);
    if (a && a.keep) {
      a.fn();
      if (menuShown) mainMenu(true);
      return;
    }
    hideMenu();
    if (a) a.fn();
  });
  // автоскролл: страница дошла до конца
  ipcMain.on('page:yt-status', (e, ok) => {
    const t = tabByWc(e.sender.id);
    if (t) t.ytOk = !!ok;
  });
  ipcMain.on('page:autoscroll-end', (e) => {
    const t = tabByWc(e.sender.id);
    if (!t || !t.autoscroll) return;
    t.autoscroll = false;
    clearInterval(t.asTimer);
    t.asTimer = null;
    sendState();
    if (t === activeTab()) toast('Автоскролл остановлен — конец страницы');
  });
  ipcMain.on('ui:autoscroll', (e) => {
    if (!fromUi(e)) return;
    const t = activeTab();
    if (t) setAutoscroll(t, !t.autoscroll);
  });
  ipcMain.on('menu:close', (e) => {
    if (menuView && e.sender === menuView.webContents) hideMenu();
  });
  // адресная строка: поиск по странице, ссылка и печать
  ipcMain.on('ui:find', (e) => fromUi(e) && (findOpen ? closeFind() : openFind()));
  ipcMain.on('ui:copy', (e) => {
    if (!fromUi(e)) return;
    const t = activeTab();
    if (!t || !/^https?:/.test(t.url)) return;
    clipboard.writeText(t.url);
    toast('Ссылка скопирована');
  });
  ipcMain.on('ui:print', (e) => {
    if (!fromUi(e)) return;
    const t = activeTab();
    if (t && t.view) t.view.webContents.print();
  });
  ipcMain.on('ui:shield', (e) => fromUi(e) && shieldMenu());
  ipcMain.on('ui:translate', (e) => fromUi(e) && translate(activeTab()));
  ipcMain.on('ui:engine', (e, x, y) => fromUi(e) && engineMenu(x, y));
  ipcMain.on('ui:focus-page', (e) => {
    const t = activeTab();
    if (fromUi(e) && t && t.view) t.view.webContents.focus();
  });
  ipcMain.on('find:query', (e, text, forward, next) => {
    const t = activeTab();
    if (!fromUi(e) || !t || !t.view) return;
    if (!text) {
      t.view.webContents.stopFindInPage('clearSelection');
      ui.webContents.send('find-result', 0, 0);
      return;
    }
    t.view.webContents.findInPage(text, { forward: forward !== false, findNext: !!next });
  });
  ipcMain.on('find:close', (e) => fromUi(e) && closeFind());

  // всплывающее сообщение
  ipcMain.on('bubble:click', (e, id, button) => {
    if (!bubble || e.sender !== bubble.webContents) return;
    const cb = bubbleCallbacks.get(id);
    bubbleCallbacks.delete(id);
    if (cb && cb.click) cb.click(button);
    if (currentBubble && currentBubble.id === id && !(updating && id === 'upd')) hideBubble(id, false);
  });
  ipcMain.on('bubble:size', (e, h) => {
    if (!bubble || e.sender !== bubble.webContents) return;
    bubbleHeight = Math.max(60, Math.min(260, Math.ceil(h)));
    layoutBubble();
  });

  // внутренние страницы (главная, настройки) — только byss://
  const page = (name, fn) => ipcMain.handle('page:' + name, (e, ...args) => {
    const url = (e.senderFrame && e.senderFrame.url) || '';
    if (!url.startsWith('byss://')) throw new Error('нет доступа');
    return fn(e, ...args);
  });
  page('settings', (e) => settingsForPage(tabByWc(e.sender.id)));
  page('set', (e, key, value) => {
    const allowed = ['name', 'showBrand', 'theme', 'wallpaper', 'engines', 'engine', 'cities', 'shortcuts', 'adblock',
      'restoreTabs', 'allowSites', 'askedSites', 'translate', 'currency'];
    if (!allowed.includes(key)) return false;
    store.set(key, value);
    if (key === 'theme') applyTheme();
    else broadcastSettings();
    if (key === 'name' && win) win.setTitle(value || 'BySS');
    sendState();
    return true;
  });
  page('icon', (e, url) => siteIcon(url));
  page('open', (e, url, newTabToo) => {
    const t = tabByWc(e.sender.id);
    const u = toUrl(url);
    if (!u) return;
    if (newTabToo || !t) newTab(u, { mode: t ? t.mode : null });
    else navigate(t, u);
  });
  page('search', (e, engine, q) => {
    const t = tabByWc(e.sender.id);
    if (t && q && q.trim()) navigate(t, searchUrl(engine, q.trim()));
  });
  page('tile-menu', async () => {
    return new Promise((resolve) => {
      let done = false;
      const pick = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const m = Menu.buildFromTemplate([
        { label: 'Открыть в новой вкладке', click: () => pick('newtab') },
        { label: 'Изменить', click: () => pick('edit') },
        { type: 'separator' },
        { label: 'Удалить с главной', click: () => pick('delete') }
      ]);
      // меню закрыли без выбора — ответ «ничего» (с задержкой: щелчок по пункту приходит чуть позже)
      m.popup({ window: win, callback: () => setTimeout(() => pick(null), 250) });
    });
  });
  page('pick-wallpaper', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Своя картинка для фона',
      filters: [{ name: 'Картинки', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return false;
    const src = r.filePaths[0];
    let ext = path.extname(src).slice(1).toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    const dir = app.getPath('userData');
    for (const x of ['jpg', 'png', 'webp']) {
      try {
        fs.unlinkSync(path.join(dir, 'wallpaper.' + x));
      } catch (err) {
        // не было
      }
    }
    fs.copyFileSync(src, path.join(dir, 'wallpaper.' + ext));
    store.set('wallpaper', 'custom');
    store.set('wallpaperStamp', Date.now());
    broadcastSettings();
    return true;
  });
  page('mode-rename', (e, id, name) => {
    const modes = (store.get('modes') || []).map((m) => (m.id === id ? { id, name: String(name || '').slice(0, 30) || m.name } : m));
    store.set('modes', modes);
    sendState();
    broadcastSettings();
    return true;
  });
  page('mode-new', () => {
    const id = newMode();
    broadcastSettings();
    sendState();
    return id;
  });
  page('mode-open', (e, id) => newModeTab(id));
  page('mode-delete', async (e, id) => {
    const ok = await deleteMode(id);
    broadcastSettings();
    return ok;
  });
  page('clear-data', () => clearAll());
  // скачанные файлы
  page('downloads', () => downloadsForPage());
  page('ext-list', () => EXT.list());
  page('ext-set', (e, id, on) => EXT.setOn(String(id), !!on));
  page('ext-remove', (e, id) => EXT.remove(String(id)));
  page('ext-options', (e, id) => {
    const u = EXT.optionsUrl(String(id));
    if (u) newTab(u);
    return !!u;
  });
  page('ext-store', () => newTab('https://chromewebstore.google.com/'));
  page('ext-ubo', async () => {
    try {
      await EXT.installUbo();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  page('ext-restart', () => {
    saveSession();
    app.relaunch();
    app.exit(0);
  });
  page('dl-open', (e, id) => {
    const d = findDownload(id);
    if (d && fs.existsSync(d.file)) shell.openPath(d.file);
  });
  page('dl-folder', (e, id) => {
    const d = findDownload(id);
    if (d && fs.existsSync(d.file)) shell.showItemInFolder(d.file);
    else shell.openPath(app.getPath('downloads'));
  });
  page('dl-dir', () => shell.openPath(app.getPath('downloads')));
  page('dl-remove', (e, id) => removeDownload(id));
  page('dl-clear', () => {
    const keep = (d) => liveDownloads.has(d.id);
    store.set('downloads', (store.get('downloads') || []).filter(keep));
    for (let i = memDownloads.length - 1; i >= 0; i--) if (!keep(memDownloads[i])) memDownloads.splice(i, 1);
    pushDownloads();
  });
  page('dl-cancel', (e, id) => {
    const it = liveDownloads.get(id);
    if (it) it.cancel();
  });
  page('dl-pause', (e, id) => {
    const it = liveDownloads.get(id);
    if (!it) return;
    if (it.isPaused()) it.resume();
    else it.pause();
  });
  page('dl-retry', (e, id) => {
    const d = findDownload(id);
    const t = tabByWc(e.sender.id);
    if (d && d.url && t && t.view) {
      removeDownload(id);
      t.view.webContents.downloadURL(d.url);
    }
  });
  page('dl-icon', (e, id) => downloadIcon(id));
  page('update', () => checkUpdates(true));
  page('open-settings', () => openSettings());
  page('reload-filters', async () => {
    await adblock.refresh();
    return adblock.size;
  });
}

function settingsForPage(t) {
  const s = Object.assign({}, store.all());
  delete s.downloads; // список загрузок — отдельно, только странице загрузок
  s.modeName = t && t.mode ? modeName(t.mode) : null;
  s.version = app.getVersion();
  s.filters = adblock ? adblock.size : 0;
  s.platform = process.platform;
  return s;
}

// ======================================================================= запуск

app.on('second-instance', (e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const urls = argv.filter((a) => /^https?:\/\//i.test(a));
  if (urls.length) urls.forEach((u) => newTab(u));
  else newTab(HOME);
});

// Галочка «мои сайты» из установщика: установщик кладёт install-options.json рядом с app.asar.
function applyInstallOptions() {
  if (!app.isPackaged) return;
  const f = path.join(process.resourcesPath, 'install-options.json');
  let st;
  try {
    st = fs.statSync(f);
  } catch (e) {
    return;
  }
  const stamp = String(Math.round(st.mtimeMs));
  if (store.get('installStamp') === stamp) return;
  let o = {};
  try {
    o = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    o = {};
  }
  store.set('installStamp', stamp);
  const key = (u) => hostOf(u).replace(/^www\./, '');
  const mine = new Set(MY_SITES.map((m) => key(m.url)));
  let list = (store.get('shortcuts') || []).slice();
  if (o.mySites === false) {
    list = list.filter((x) => !mine.has(key(x.url)));
  } else {
    for (const m of MY_SITES) if (!list.some((x) => key(x.url) === key(m.url))) list.push(Object.assign({}, m));
  }
  store.set('shortcuts', list);
}

function startExtensions() {
  return EXT.init(sessionFor(null), {
    store,
    win: () => win,
    createTab: (url, active) => {
      const t = newTab(url || HOME, { background: !active });
      if (!t) return null;
      ensureView(t);
      return t.view.webContents;
    },
    selectTab: (wc) => {
      const t = tabByWc(wc.id);
      if (t) activate(t.id);
    },
    removeTab: (wc) => {
      const t = tabByWc(wc.id);
      if (t) closeTab(t.id);
    },
    onChange: () => {
      applyNet(sessionFor(null));
      if (!win) return;
      sendState();
      const list = EXT.list();
      for (const t of tabs) {
        if (t.view && !t.view.webContents.isDestroyed() && t.url.startsWith(EXTENSIONS)) {
          t.view.webContents.send('page:ext', list);
        }
      }
    }
  }).catch(() => {});
}

if (process.platform === 'win32') app.setAppUserModelId('app.byss.desktop');

app.whenReady().then(async () => {
  // без «Electron» в названии браузера — сайты (и вход в Google) видят обычный Chrome
  app.userAgentFallback = app.userAgentFallback
    .replace(/\s?Electron\/[\d.]+/i, '')
    .replace(/\s?byss\/[\d.]+/i, '');
  store = new Store(app.getPath('userData'));
  try {
    applyInstallOptions();
  } catch (e) {
    // не страшно — главная останется как была
  }
  // один раз: третья строка на главной становится конвертером валют (можно вернуть поиск в настройках)
  if (!store.get('fxHome')) {
    const e = (store.get('engines') || ['google', 'yandex', 'ddg']).slice(0, 3);
    while (e.length < 3) e.push('ddg');
    e[2] = 'currency';
    store.set('engines', e);
    store.set('fxHome', true);
  }
  nativeTheme.themeSource = theme();
  // на Mac без меню «Правка» не работают ⌘C / ⌘V — оставляем только его
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null);
  protocol.handle('byss', byssProtocol);
  adblock = new AdBlock(app.getPath('userData'), (u) => net.fetch(u));
  adblock.init().catch(() => {});
  setupIpc();
  // расширения грузятся до вкладок (не дольше пары секунд), чтобы сразу работали на открытых сайтах
  await Promise.race([startExtensions(), new Promise((r) => setTimeout(r, 2000))]);
  createWindow();
  setupUpdater();
});

app.on('before-quit', saveSession);

app.on('window-all-closed', () => {
  app.quit();
});
