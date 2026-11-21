'use strict';
/* BySS для Firefox — фоновая часть:
   • настройки (главная, тема, автоскролл) в storage.local, при первом запуске — перенос из старого BySS;
   • тёмная или светлая тема окна в цветах BySS;
   • значки сайтов для плиток на главной (с кэшем на 2 недели);
   • автоскролл: состояние по вкладкам, кнопка и сочетание клавиш. */

const D = globalThis.BYSS_DEFAULTS;
const KEYS = globalThis.BYSS_KEYS;

// ---------------------------------------------------------------- настройки

async function getSettings() {
  const { settings } = await browser.storage.local.get('settings');
  return Object.assign(JSON.parse(JSON.stringify(D)), settings || {});
}

async function setSetting(key, value) {
  if (!KEYS.includes(key) && key !== 'wallpaperData') return false;
  const s = await getSettings();
  s[key] = value;
  await browser.storage.local.set({ settings: s });
  return true;
}

/** Установщик кладёт настройки старого BySS в политики Firefox («3rdparty») — забираем их один раз. */
async function importOld() {
  const { imported } = await browser.storage.local.get('imported');
  if (imported) return;
  let m = null;
  try {
    m = await browser.storage.managed.get(null);
  } catch (e) {
    m = null; // политик нет — обычная установка без переноса
  }
  const s = await getSettings();
  if (m && m.import && typeof m.import === 'object') {
    for (const k of KEYS) if (m.import[k] !== undefined && m.import[k] !== null) s[k] = m.import[k];
    if (m.import.autoscroll) s.autoscroll = Object.assign({}, D.autoscroll, m.import.autoscroll);
    if (s.wallpaper === 'custom' && typeof m.wallpaper === 'string' && m.wallpaper.startsWith('data:image/')) {
      s.wallpaperData = m.wallpaper;
    } else if (s.wallpaper === 'custom') {
      s.wallpaper = 'lines';
    }
  }
  if (s.engines && s.engines.length < 3) s.engines = D.engines.slice();
  await browser.storage.local.set({ settings: s, imported: Date.now() });
}

/** Версия установщика и его настроек — для проверки обновлений во всплывающем меню. */
async function installInfo() {
  try {
    const m = await browser.storage.managed.get(['version', 'setup']);
    return { version: m.version || '', setup: Number(m.setup) || 0 };
  } catch (e) {
    return { version: '', setup: 0 };
  }
}

// ---------------------------------------------------------------- тема окна

const THEMES = {
  dark: {
    colors: {
      frame: '#000000', frame_inactive: '#000000',
      tab_background_text: '#8E8E93', tab_text: '#F2F2F7', tab_selected: '#1C1C1E', tab_line: '#1C1C1E',
      tab_loading: '#F2F2F7', tab_background_separator: 'rgba(0,0,0,0)',
      toolbar: '#000000', toolbar_text: '#F2F2F7', bookmark_text: '#F2F2F7',
      toolbar_top_separator: 'rgba(0,0,0,0)', toolbar_bottom_separator: 'rgba(0,0,0,0)', toolbar_vertical_separator: 'rgba(255,255,255,0.08)',
      toolbar_field: '#1C1C1E', toolbar_field_text: '#F2F2F7', toolbar_field_border: 'rgba(0,0,0,0)',
      toolbar_field_focus: '#1C1C1E', toolbar_field_text_focus: '#F2F2F7', toolbar_field_border_focus: '#3A3A3C',
      toolbar_field_highlight: '#3A3A3C', toolbar_field_highlight_text: '#FFFFFF',
      icons: '#F2F2F7', icons_attention: '#30D158',
      button_background_hover: 'rgba(255,255,255,0.08)', button_background_active: 'rgba(255,255,255,0.14)',
      popup: '#1C1C1E', popup_text: '#F2F2F7', popup_border: '#2C2C2E',
      popup_highlight: '#2C2C2E', popup_highlight_text: '#F2F2F7',
      sidebar: '#1C1C1E', sidebar_text: '#F2F2F7', sidebar_border: '#2C2C2E',
      sidebar_highlight: '#2C2C2E', sidebar_highlight_text: '#F2F2F7',
      ntp_background: '#000000', ntp_text: '#F2F2F7'
    },
    properties: { color_scheme: 'dark', content_color_scheme: 'auto' }
  },
  light: {
    colors: {
      frame: '#F2F2F7', frame_inactive: '#F2F2F7',
      tab_background_text: '#6C6C70', tab_text: '#111113', tab_selected: '#FFFFFF', tab_line: '#FFFFFF',
      tab_loading: '#111113', tab_background_separator: 'rgba(0,0,0,0)',
      toolbar: '#F2F2F7', toolbar_text: '#111113', bookmark_text: '#111113',
      toolbar_top_separator: 'rgba(0,0,0,0)', toolbar_bottom_separator: 'rgba(0,0,0,0)', toolbar_vertical_separator: 'rgba(0,0,0,0.08)',
      toolbar_field: '#FFFFFF', toolbar_field_text: '#111113', toolbar_field_border: 'rgba(0,0,0,0)',
      toolbar_field_focus: '#FFFFFF', toolbar_field_text_focus: '#111113', toolbar_field_border_focus: '#C7C7CC',
      toolbar_field_highlight: '#C7C7CC', toolbar_field_highlight_text: '#000000',
      icons: '#111113', icons_attention: '#248A3D',
      button_background_hover: 'rgba(0,0,0,0.06)', button_background_active: 'rgba(0,0,0,0.12)',
      popup: '#FFFFFF', popup_text: '#111113', popup_border: '#E5E5EA',
      popup_highlight: '#E5E5EA', popup_highlight_text: '#111113',
      sidebar: '#FFFFFF', sidebar_text: '#111113', sidebar_border: '#E5E5EA',
      sidebar_highlight: '#E5E5EA', sidebar_highlight_text: '#111113',
      ntp_background: '#F2F2F7', ntp_text: '#111113'
    },
    properties: { color_scheme: 'light', content_color_scheme: 'auto' }
  }
};

async function applyTheme(s) {
  const t = THEMES[s.theme === 'light' ? 'light' : 'dark'];
  try {
    await browser.theme.update(t);
  } catch (e) {
    // старый Firefox без части свойств — пробуем только цвета
    try {
      await browser.theme.update({ colors: t.colors });
    } catch (e2) {
      // тема не важнее работы браузера
    }
  }
}

// ---------------------------------------------------------------- значки сайтов

const ICON_TTL = 14 * 24 * 3600 * 1000;

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function toBase64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchWithTimeout(url, ms, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, Object.assign({ signal: ac.signal, credentials: 'omit', redirect: 'follow' }, opts || {}));
  } finally {
    clearTimeout(t);
  }
}

async function siteIcon(url) {
  const host = hostOf(url);
  if (!host) return null;
  const key = 'ic:' + host;
  const cached = (await browser.storage.local.get(key))[key];
  if (cached && Date.now() - cached.at < ICON_TTL) return cached.data || null;

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
    const r = await fetchWithTimeout(origin, 8000, { headers: { Accept: 'text/html' } });
    origin = r.url || origin;
    const text = (await r.text()).slice(0, 400000);
    const links = [...text.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    for (const l of links) {
      const rel = ((l.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || '').toLowerCase();
      const href = (l.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (!href || href.startsWith('data:')) continue;
      if (rel.includes('manifest')) {
        try {
          const murl = new URL(href, origin).toString();
          const mr = await fetchWithTimeout(murl, 6000);
          const m = JSON.parse(await mr.text());
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
  const score = (c) => (c.size >= 96 ? 1000 - Math.abs(256 - Math.min(c.size, 512)) : c.size);
  cands.sort((a, b) => score(b) - score(a));
  for (const c of cands.slice(0, 8)) {
    try {
      const r = await fetchWithTimeout(c.url, 8000);
      if (!r.ok) continue;
      let type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (type.includes('html') || type.includes('json') || type.includes('text/plain')) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength < 100 || buf.byteLength > 2000000) continue;
      if (c.svg || type.includes('svg')) {
        const head = new TextDecoder().decode(new Uint8Array(buf).subarray(0, 4000));
        if (!/<svg[\s>]/i.test(head)) continue;
        type = 'image/svg+xml';
      } else if (!type.startsWith('image/')) {
        type = /\.ico(\?|$)/i.test(c.url) ? 'image/x-icon' : 'image/png';
      }
      const data = 'data:' + type + ';base64,' + toBase64(buf);
      await browser.storage.local.set({ [key]: { at: Date.now(), data } });
      return data;
    } catch (e) {
      // следующий вариант
    }
  }
  await browser.storage.local.set({ [key]: { at: Date.now(), data: null } }); // нет значка — не спрашиваем 2 недели
  return null;
}

// ---------------------------------------------------------------- автоскролл

const scrolling = new Set(); // вкладки, где идёт автоскролл

function asPayload(s) {
  const a = Object.assign({}, D.autoscroll, s.autoscroll || {});
  const level = Math.min(10, Math.max(1, Math.round(a.level) || 4));
  return { mode: a.mode, speed: globalThis.BYSS_AS_SPEEDS[level - 1], interval: a.interval, step: a.step, ticks: a.ticks || 1 };
}

async function badge(tabId) {
  const on = scrolling.has(tabId);
  try {
    await browser.browserAction.setBadgeText({ tabId, text: on ? '▶' : '' });
    await browser.browserAction.setBadgeBackgroundColor({ tabId, color: '#30D158' });
  } catch (e) {
    // вкладка уже закрыта
  }
}

async function setAutoscroll(tabId, on) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || !/^https?:/.test(tab.url || '')) return { ok: false, why: 'Автоскролл работает на сайтах' };
  const s = await getSettings();
  try {
    await browser.tabs.sendMessage(tabId, on ? { as: 'start', cfg: asPayload(s) } : { as: 'stop' });
  } catch (e) {
    return { ok: false, why: 'Обновите страницу (F5) — и автоскролл заработает' };
  }
  if (on) scrolling.add(tabId);
  else scrolling.delete(tabId);
  badge(tabId);
  return { ok: true, on };
}

async function reapplyAutoscroll() {
  const s = await getSettings();
  for (const id of scrolling) {
    browser.tabs.sendMessage(id, { as: 'set', cfg: asPayload(s) }).catch(() => scrolling.delete(id));
  }
}

browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url && scrolling.has(tabId)) {
    scrolling.delete(tabId); // новая страница — автоскролл только по команде
    badge(tabId);
  }
});
browser.tabs.onRemoved.addListener((tabId) => scrolling.delete(tabId));

browser.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'autoscroll') return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) setAutoscroll(tab.id, !scrolling.has(tab.id));
});

// ---------------------------------------------------------------- сообщения от страниц BySS

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== 'object') return undefined;
  const fromExt = sender && sender.url && sender.url.startsWith(browser.runtime.getURL(''));
  switch (msg.t) {
    case 'icon':
      return fromExt ? siteIcon(String(msg.url || '')) : undefined;
    case 'as-ended':
      if (sender.tab) {
        scrolling.delete(sender.tab.id);
        badge(sender.tab.id);
      }
      return undefined;
    case 'as-state':
      return Promise.resolve({ on: scrolling.has(Number(msg.tabId)) });
    case 'as-set':
      return fromExt ? setAutoscroll(Number(msg.tabId), !!msg.on) : undefined;
    case 'install-info':
      return fromExt ? installInfo() : undefined;
    case 'shot':
      return fromExt ? screenshot(Number(msg.tabId), !!msg.full) : undefined;
    case 'translate':
      if (!fromExt) return undefined;
      return browser.tabs.get(Number(msg.tabId)).then(translateTab).catch(() => {});
    default:
      return undefined;
  }
});

browser.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.settings) return;
  const s = Object.assign({}, D, ch.settings.newValue || {});
  const old = ch.settings.oldValue || {};
  if (s.theme !== old.theme) applyTheme(s);
  if (JSON.stringify(s.autoscroll) !== JSON.stringify(old.autoscroll)) reapplyAutoscroll();
});

// ---------------------------------------------------------------- скриншот

/** Снимок вкладки (видимая часть или вся страница) — в папку загрузок, как PNG. */
async function screenshot(tabId, full) {
  try {
    let opts = { format: 'png' };
    if (full) {
      const [d] = await browser.tabs.executeScript(tabId, {
        code: '({ w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, innerWidth),'
          + ' h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight),'
          + ' r: devicePixelRatio || 1 })'
      });
      const w = Math.min(d.w, 8000);
      const h = Math.min(d.h, 30000);
      const scale = Math.max(0.25, Math.min(d.r, 16000 / h, 8000 / w));
      opts = { format: 'png', rect: { x: 0, y: 0, width: w, height: h }, scale };
    }
    const data = await browser.tabs.captureTab(tabId, opts);
    const blob = await (await fetch(data)).blob();
    const url = URL.createObjectURL(blob);
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date();
    const name = 'BySS ' + t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' '
      + p(t.getHours()) + '-' + p(t.getMinutes()) + '-' + p(t.getSeconds()) + '.png';
    await browser.downloads.download({ url, filename: name, saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

// ---------------------------------------------------------------- перевод страницы

/* Кнопка «Перевести» рядом со значком BySS (в конце адресной строки) и пункт в меню страницы.
   Страница открывается в Переводчике Google на русском; на переведённой — возврат к оригиналу. */
const TR_HOST = '.translate.goog';

/** Адрес оригинала для переведённой страницы (www-example-com.translate.goog → www.example.com). */
function originalOf(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(TR_HOST)) return null;
    const label = u.hostname.slice(0, -TR_HOST.length);
    u.hostname = label.replace(/--/g, '\u0000').replace(/-/g, '.').replace(/\u0000/g, '-');
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('_x_tr_')) u.searchParams.delete(k);
    return u.toString();
  } catch (e) {
    return null;
  }
}

function translateTab(tab) {
  if (!tab || !/^https?:/.test(tab.url || '')) return;
  const back = originalOf(tab.url);
  const url = back || 'https://translate.google.com/translate?sl=auto&tl=ru&hl=ru&u=' + encodeURIComponent(tab.url);
  browser.tabs.update(tab.id, { url }).catch(() => {});
}

browser.pageAction.onClicked.addListener((tab) => translateTab(tab));
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  const t = originalOf(info.url) ? 'Показать оригинал' : 'Перевести страницу на русский';
  try {
    browser.pageAction.setTitle({ tabId, title: t });
  } catch (e) {
    // вкладка уже закрыта
  }
});

browser.menus.create({
  id: 'byss-translate',
  title: 'Перевести страницу',
  contexts: ['page'],
  documentUrlPatterns: ['http://*/*', 'https://*/*']
}, () => void browser.runtime.lastError);
browser.menus.onShown.addListener((info, tab) => {
  if (!info.menuIds.includes('byss-translate')) return;
  const title = tab && originalOf(tab.url || '') ? 'Показать оригинал' : 'Перевести страницу';
  browser.menus.update('byss-translate', { title }).then(() => browser.menus.refresh()).catch(() => {});
});
browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'byss-translate') translateTab(tab);
});

// ---------------------------------------------------------------- постоянный адрес страниц BySS

/* Домашняя страница в политиках Firefox записана постоянным адресом BySS. Если Firefox выдал
   расширению другой адрес, вкладки с постоянным адресом переводим на настоящий — иначе там пусто. */
const FIXED_BASE = 'moz-extension://a90f5681-e157-4e8e-8725-17a034929c49/';
const OWN_BASE = browser.runtime.getURL('');

function fixAddress(tabId, url) {
  if (FIXED_BASE === OWN_BASE || typeof url !== 'string' || !url.startsWith(FIXED_BASE)) return;
  browser.tabs.update(tabId, { url: OWN_BASE + url.slice(FIXED_BASE.length) }).catch(() => {});
}

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  fixAddress(tabId, info.url || (tab && tab.url));
});
browser.tabs.query({}).then((tabs) => {
  for (const t of tabs) fixAddress(t.id, t.url);
}).catch(() => {});

/* При первом запуске Firefox открывает главную раньше, чем успевает включиться BySS, —
   такая вкладка остаётся пустой. После установки или обновления BySS перезагружаем её. */
browser.runtime.onInstalled.addListener((details) => {
  const home = OWN_BASE + 'home/index.html';
  browser.tabs.query({}).then((tabs) => {
    for (const t of tabs) {
      const url = typeof t.url === 'string' ? t.url : '';
      const title = typeof t.title === 'string' ? t.title : '';
      // не загрузившаяся главная: у вкладки пустой адрес, а в заголовке — адрес BySS
      const failed = url === 'about:blank' && (title.includes('a90f5681') || title.startsWith('moz-extension'));
      if (url.startsWith(OWN_BASE + 'home/')) browser.tabs.reload(t.id).catch(() => {});
      else if (failed || (details.reason === 'install' && url === 'about:blank' && tabs.length === 1)) {
        browser.tabs.update(t.id, { url: home }).catch(() => {});
      }
    }
  }).catch(() => {});
});

// ---------------------------------------------------------------- запуск

(async () => {
  try {
    await importOld();
  } catch (e) {
    // перенос не главное
  }
  applyTheme(await getSettings());
})();

globalThis.BYSS_BG = { getSettings, setSetting };
