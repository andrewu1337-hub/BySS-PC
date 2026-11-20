'use strict';
// Расширения Chrome — только в обычном режиме: в «Режимах BySS» данные не сохраняются, а расширениям это нужно.
// Ставятся двумя путями:
//  • из Chrome Web Store, кнопкой «Установить» прямо на странице магазина (как в Chrome);
//  • uBlock Origin — с его официальной страницы на GitHub: из магазина Chrome он убран.
// Пока работает uBlock Origin, встроенная блокировка запросов уступает ему место
// (движок отдаёт запросы только одному блокировщику).
const fs = require('fs');
const path = require('path');
const { app, net, dialog } = require('electron');

const UBO_API = 'https://api.github.com/repos/gorhill/uBlock/releases/latest';
const UBO_EVERY = 24 * 3600 * 1000; // проверять новую версию uBlock Origin раз в сутки
const UBO_NAME = 'uBlock Origin';

let ECE = null; // библиотека electron-chrome-extensions
let WS = null; // библиотека electron-chrome-web-store
let ext = null; // ElectronChromeExtensions для основной сессии
let ses = null;
let H = null; // связь с main.js
let state = 'off'; // off | loading | ready | error
let failure = '';
let uboBusy = null; // текст: что сейчас делается с uBlock Origin
const tabsAdded = new WeakSet();

function E() {
  return ses.extensions || ses;
}

function paths() {
  const root = app.getPath('userData');
  return {
    store: path.join(root, 'Extensions'),
    ubo: path.join(root, 'BySS-Extensions', 'ublock'),
    uboNew: path.join(root, 'BySS-Extensions', 'ublock-new'),
    uboOld: path.join(root, 'BySS-Extensions', 'ublock-old')
  };
}

function off() {
  return new Set(H.store.get('extOff') || []);
}

function uboCfg() {
  return Object.assign({ on: false, version: '', checked: 0, pending: '' }, H.store.get('ubo') || {});
}

function setUbo(patch) {
  H.store.set('ubo', Object.assign(uboCfg(), patch));
}

function changed() {
  try {
    H.onChange();
  } catch (e) {
    // ignore
  }
}

// ------------------------------------------------------------------ файлы расширений

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return null;
  }
}

function cmpVer(a, b) {
  const x = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

/** Каталог с manifest.json не глубже двух уровней. */
function findManifestDir(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  if (depth >= 2) return null;
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const d of list) {
    if (!d.isDirectory()) continue;
    const r = findManifestDir(path.join(dir, d.name), depth + 1);
    if (r) return r;
  }
  return null;
}

/** Расширения из магазина на диске: Extensions/<id>/<версия>/manifest.json — берём самую новую версию. */
function storeOnDisk() {
  const out = [];
  let ids = [];
  try {
    ids = fs.readdirSync(paths().store, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) {
    return out;
  }
  for (const id of ids) {
    if (!/^[a-p]{32}$/.test(id)) continue;
    let best = null;
    let vers = [];
    try {
      vers = fs.readdirSync(path.join(paths().store, id), { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch (e) {
      continue;
    }
    for (const v of vers) {
      const dir = path.join(paths().store, id, v.name);
      const m = readJson(path.join(dir, 'manifest.json'));
      if (m && (!best || cmpVer(m.version, best.manifest.version) > 0)) best = { id, dir, manifest: m };
    }
    if (best) out.push(best);
  }
  return out;
}

/** Имя вида __MSG_appName__ — из папки _locales (русский, потом язык по умолчанию, потом английский). */
function localName(dir, manifest, value) {
  const m = /^__MSG_(.+)__$/.exec(String(value || ''));
  if (!m) return value || '';
  const key = m[1].toLowerCase();
  for (const lang of ['ru', manifest.default_locale, 'en', 'en_US']) {
    if (!lang) continue;
    const msgs = readJson(path.join(dir, '_locales', lang, 'messages.json'));
    if (!msgs) continue;
    for (const k of Object.keys(msgs)) {
      if (k.toLowerCase() === key && msgs[k] && msgs[k].message) return msgs[k].message;
    }
  }
  return value;
}

function iconData(dir, manifest) {
  const icons = manifest.icons || {};
  const sizes = Object.keys(icons).map((s) => parseInt(s, 10)).filter((s) => s > 0).sort((a, b) => a - b);
  const pick = sizes.find((s) => s >= 48) || sizes[sizes.length - 1];
  if (!pick) return '';
  try {
    const file = path.join(dir, String(icons[pick]).replace(/^\//, ''));
    if (!file.startsWith(dir)) return '';
    const buf = fs.readFileSync(file);
    const ext2 = path.extname(file).toLowerCase();
    const mime = ext2 === '.svg' ? 'image/svg+xml' : ext2 === '.jpg' || ext2 === '.jpeg' ? 'image/jpeg' : 'image/png';
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch (e) {
    return '';
  }
}

/** Блокировщик рекламы на правилах declarativeNetRequest — в этом движке их нет, блокировать он не сможет. */
function usesDnr(manifest) {
  const p = [].concat(manifest.permissions || [], manifest.optional_permissions || []);
  return !!manifest.declarative_net_request || p.includes('declarativeNetRequest')
    || p.includes('declarativeNetRequestWithHostAccess');
}

// ------------------------------------------------------------------ загрузка

async function load(dir) {
  return E().loadExtension(dir, { allowFileAccess: false });
}

async function startWorker(x) {
  try {
    const m = x.manifest || {};
    if (m.manifest_version === 3 && m.background && m.background.service_worker) {
      await ses.serviceWorkers.startWorkerForScope(x.url);
    }
  } catch (e) {
    // запустится сам при первом событии
  }
}

async function loadStore() {
  const disabled = off();
  const loaded = new Set(E().getAllExtensions().map((x) => x.id));
  for (const s of storeOnDisk()) {
    if (disabled.has(s.id) || loaded.has(s.id)) continue;
    try {
      const x = await load(s.dir);
      await startWorker(x);
    } catch (e) {
      console.error('extension', s.id, e && e.message);
    }
  }
}

function uboExt() {
  const dir = paths().ubo;
  return E().getAllExtensions().find((x) => {
    const p = x.path ? path.resolve(x.path) : '';
    return p === dir || p.startsWith(dir + path.sep);
  }) || null;
}

/** Новая версия uBlock Origin скачана, пока браузер работал, — ставим её до загрузки (файлы ещё не заняты). */
function applyPendingUbo() {
  const p = paths();
  const c = uboCfg();
  if (!c.pending || !findManifestDir(p.uboNew)) return;
  try {
    fs.rmSync(p.uboOld, { recursive: true, force: true });
    if (fs.existsSync(p.ubo)) fs.renameSync(p.ubo, p.uboOld);
    fs.renameSync(p.uboNew, p.ubo);
    setUbo({ version: c.pending, pending: '' });
    fs.rmSync(p.uboOld, { recursive: true, force: true });
  } catch (e) {
    // не вышло — остаётся прежняя версия
    try {
      if (!fs.existsSync(p.ubo) && fs.existsSync(p.uboOld)) fs.renameSync(p.uboOld, p.ubo);
    } catch (err) {
      // ignore
    }
  }
}

async function loadUbo() {
  const c = uboCfg();
  if (!c.on) return false;
  const dir = findManifestDir(paths().ubo);
  if (!dir) {
    setUbo({ on: false });
    return false;
  }
  if (uboExt()) return true;
  try {
    await load(dir);
    return true;
  } catch (e) {
    failure = 'uBlock Origin не запустился: ' + ((e && e.message) || e);
    setUbo({ on: false });
    return false;
  }
}

// ------------------------------------------------------------------ запуск

/**
 * hooks: { store, win(), createTab(url, active) → webContents, selectTab(wc), removeTab(wc), onChange() }
 */
async function init(session, hooks) {
  H = hooks;
  ses = session;
  if (state !== 'off') return;
  state = 'loading';
  try {
    // после app.ready: иначе библиотека перепишет права схемы byss://
    ECE = require('electron-chrome-extensions');
    WS = require('electron-chrome-web-store');
  } catch (e) {
    state = 'error';
    failure = 'Модуль расширений не найден в этой сборке.';
    changed();
    return;
  }
  try {
    // до библиотеки: её preload для страниц расширений иначе не срабатывает (см. preload-crx-fix.js)
    try {
      ses.registerPreloadScript({ id: 'byss-crx-fix', type: 'frame', filePath: path.join(__dirname, 'preload-crx-fix.js') });
    } catch (e) {
      console.error('extensions preload fix', e);
    }
    ext = new ECE.ElectronChromeExtensions({
      session: ses,
      createTab: async (details) => {
        const wc = H.createTab(details && details.url, !details || details.active !== false);
        if (!wc) throw new Error('Не удалось открыть вкладку');
        return [wc, H.win()];
      },
      // библиотека зовёт их и из событий страниц: ошибка здесь не должна уронить браузер
      selectTab: (wc) => {
        try {
          H.selectTab(wc);
        } catch (e) {
          console.error('extensions selectTab', e);
        }
      },
      removeTab: (wc) => {
        try {
          H.removeTab(wc);
        } catch (e) {
          console.error('extensions removeTab', e);
        }
      },
      createWindow: async (details) => {
        const url = details && (Array.isArray(details.url) ? details.url[0] : details.url);
        H.createTab(url, true);
        return H.win();
      },
      removeWindow: () => {}
    });
    // значки расширений в верхней панели (она в обычной сессии приложения)
    ECE.ElectronChromeExtensions.handleCRXProtocol(require('electron').session.defaultSession);

    await WS.installChromeWebStore({
      session: ses,
      extensionsPath: paths().store,
      loadExtensions: false, // грузим сами — чтобы не включать выключенные
      autoUpdate: true,
      beforeInstall: askInstall
    });
    applyPendingUbo();
    await loadUbo();
    await loadStore();
    state = 'ready';
  } catch (e) {
    state = 'error';
    failure = 'Расширения не запустились: ' + ((e && e.message) || e);
  }
  const E2 = E();
  E2.on('extension-loaded', changed);
  E2.on('extension-unloaded', changed);
  changed();
  setTimeout(() => checkUboUpdate().catch(() => {}), 60 * 1000);
}

async function askInstall(details) {
  const w = H.win();
  const m = details.manifest || {};
  const name = details.localizedName || m.name || 'расширение';
  const perms = [].concat(m.permissions || [], m.host_permissions || []).filter((p) => typeof p === 'string');
  let detail = '';
  if (perms.some((p) => p === '<all_urls>' || p.startsWith('*://') || p.startsWith('http'))) {
    detail += 'Расширение сможет читать и менять страницы сайтов, которые вы открываете.\n';
  }
  if (usesDnr(m)) {
    detail += '\nВнимание: блокировщики рекламы из магазина Chrome здесь не блокируют — '
      + 'нужной им функции в движке браузера нет. Для рекламы есть встроенная защита BySS '
      + 'и uBlock Origin: Меню → Расширения.\n';
  }
  detail += '\nУстанавливайте только то, чему доверяете.';
  const r = await dialog.showMessageBox(w, {
    type: 'question',
    title: 'Установить расширение?',
    message: 'Установить «' + name + '»?',
    detail,
    icon: details.icon && !details.icon.isEmpty() ? details.icon : undefined,
    buttons: ['Установить', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (r.response === 0) {
    const s = off();
    if (s.delete(details.id)) H.store.set('extOff', [...s]);
    setTimeout(changed, 1500);
  }
  return { action: r.response === 0 ? 'allow' : 'deny' };
}

function ready() {
  return state === 'ready';
}

function addTab(wc) {
  if (!ext || !wc || wc.isDestroyed() || tabsAdded.has(wc) || wc.session !== ses) return;
  try {
    ext.addTab(wc, H.win());
    tabsAdded.add(wc);
  } catch (e) {
    // ignore
  }
}

function selectTab(wc) {
  if (!ext || !wc || wc.isDestroyed() || wc.session !== ses) return;
  try {
    ext.selectTab(wc);
  } catch (e) {
    // ignore
  }
}

function menuItems(wc, params) {
  if (!ext || !wc || wc.session !== ses) return [];
  try {
    return ext.getContextMenuItems(wc, params) || [];
  } catch (e) {
    return [];
  }
}

/** uBlock Origin включён — встроенная блокировка запросов в основной сессии выключается. */
function uboOwnsNetwork(session) {
  if (session !== ses || !H) return false;
  if (state === 'loading' || state === 'off') return uboCfg().on && !!findManifestDir(paths().ubo);
  return !!uboExt();
}

// ------------------------------------------------------------------ для страницы «Расширения»

function list() {
  const out = [];
  const loaded = ses ? new Map(E().getAllExtensions().map((x) => [x.id, x])) : new Map();
  const u = ses ? uboExt() : null;
  const uc = uboCfg();
  const udir = findManifestDir(paths().ubo);
  if (udir) {
    const m = readJson(path.join(udir, 'manifest.json')) || {};
    out.push({
      id: 'ubo',
      kind: 'ubo',
      name: UBO_NAME,
      version: m.version || uc.version,
      on: !!u,
      icon: iconData(udir, m),
      desc: 'Блокировщик рекламы. Пока он включён, встроенная блокировка BySS уступает ему.',
      options: !!u,
      pending: uc.pending || ''
    });
  }
  for (const s of storeOnDisk()) {
    const x = loaded.get(s.id);
    const m = s.manifest;
    out.push({
      id: s.id,
      kind: 'store',
      name: localName(s.dir, m, m.name),
      version: m.version,
      on: !!x,
      icon: iconData(s.dir, m),
      desc: localName(s.dir, m, m.description || ''),
      options: !!(x && (m.options_page || (m.options_ui && m.options_ui.page))),
      dnr: usesDnr(m)
    });
  }
  return {
    state,
    failure,
    busy: uboBusy,
    ubo: { installed: !!udir, on: !!u, version: uc.version, pending: uc.pending },
    list: out
  };
}

function optionsUrl(id) {
  const x = id === 'ubo' ? uboExt() : E().getExtension(id);
  if (!x) return null;
  const m = x.manifest || {};
  const page = m.options_page || (m.options_ui && m.options_ui.page) || (id === 'ubo' ? 'dashboard.html' : null);
  return page ? x.url.replace(/\/?$/, '/') + String(page).replace(/^\//, '') : null;
}

async function setOn(id, on) {
  if (!ready()) return false;
  if (id === 'ubo') {
    setUbo({ on: !!on });
    if (on) {
      const ok = await loadUbo();
      changed();
      return ok;
    }
    const x = uboExt();
    if (x) E().removeExtension(x.id);
    changed();
    return true;
  }
  const s = off();
  if (on) {
    s.delete(id);
    H.store.set('extOff', [...s]);
    const d = storeOnDisk().find((x) => x.id === id);
    if (d && !E().getExtension(id)) {
      const x = await load(d.dir);
      await startWorker(x);
    }
  } else {
    s.add(id);
    H.store.set('extOff', [...s]);
    if (E().getExtension(id)) E().removeExtension(id);
  }
  changed();
  return true;
}

async function remove(id) {
  if (!ready()) return false;
  if (id === 'ubo') {
    const x = uboExt();
    if (x) E().removeExtension(x.id);
    setUbo({ on: false, version: '', pending: '' });
    for (const d of [paths().ubo, paths().uboNew]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch (e) {
        // файлы освободятся после перезапуска
      }
    }
    changed();
    return true;
  }
  if (!/^[a-p]{32}$/.test(id)) return false;
  await WS.uninstallExtension(id, { session: ses, extensionsPath: paths().store });
  const s = off();
  if (s.delete(id)) H.store.set('extOff', [...s]);
  changed();
  return true;
}

// ------------------------------------------------------------------ uBlock Origin с GitHub

async function latestUbo() {
  const r = await net.fetch(UBO_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BySS-Browser' } });
  if (!r.ok) throw new Error('GitHub ответил ' + r.status);
  const j = await r.json();
  const a = (j.assets || []).find((x) => /^uBlock0_[\d.]+\.chromium\.zip$/.test(x.name || ''));
  if (!a || !a.browser_download_url) throw new Error('на странице выпуска нет файла для Chromium');
  return { version: String(j.tag_name || '').replace(/^v/, ''), url: a.browser_download_url, size: a.size || 0 };
}

/** Скачивает и распаковывает выпуск в dest (старое содержимое dest удаляется). */
async function fetchUbo(rel, dest) {
  const r = await net.fetch(rel.url, { headers: { 'User-Agent': 'BySS-Browser' } });
  if (!r.ok) throw new Error('файл не скачался (' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 500000) throw new Error('файл слишком маленький');
  const AdmZip = require('adm-zip');
  const tmp = dest + '-tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  new AdmZip(buf).extractAllTo(tmp, true);
  const dir = findManifestDir(tmp);
  const m = dir && readJson(path.join(dir, 'manifest.json'));
  if (!m || !/ublock/i.test(String(m.name || '') + ' ' + String(m.short_name || ''))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error('в архиве не uBlock Origin');
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(dir === tmp ? tmp : dir, dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  return m.version || rel.version;
}

async function installUbo() {
  if (!ready()) throw new Error(failure || 'расширения ещё запускаются');
  if (uboBusy) return false;
  uboBusy = 'Скачиваю uBlock Origin с GitHub…';
  changed();
  try {
    const rel = await latestUbo();
    const old = uboExt();
    if (old) E().removeExtension(old.id);
    const version = await fetchUbo(rel, paths().ubo);
    setUbo({ on: true, version, checked: Date.now(), pending: '' });
    uboBusy = 'Запускаю…';
    changed();
    const ok = await loadUbo();
    if (!ok) throw new Error(failure || 'не запустился');
    return true;
  } finally {
    uboBusy = null;
    changed();
  }
}

/** Раз в сутки: есть новая версия — скачать рядом, поставить при следующем запуске. */
async function checkUboUpdate() {
  const c = uboCfg();
  if (!c.on || !ready() || uboBusy || Date.now() - (c.checked || 0) < UBO_EVERY) return;
  setUbo({ checked: Date.now() });
  const rel = await latestUbo();
  if (!rel.version || cmpVer(rel.version, c.pending || c.version || '0') <= 0) return;
  const v = await fetchUbo(rel, paths().uboNew);
  setUbo({ pending: v });
  changed();
}

module.exports = {
  init,
  ready,
  addTab,
  selectTab,
  menuItems,
  uboOwnsNetwork,
  list,
  optionsUrl,
  setOn,
  remove,
  installUbo,
  status: () => ({ state, failure }),
  PARTITION: 'persist:main'
};
