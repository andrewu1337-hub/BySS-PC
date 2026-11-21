'use strict';
// window.byss для страниц BySS (главная, настройки) — то же, что было в BySS на Electron,
// только через возможности Firefox: настройки в storage.local, вкладки — browser.tabs.
(function () {
  const D = window.BYSS_DEFAULTS;
  const KEYS = window.BYSS_KEYS;
  const listeners = {};

  async function settings() {
    const { settings: s } = await browser.storage.local.get('settings');
    const out = Object.assign(JSON.parse(JSON.stringify(D)), s || {});
    out.version = browser.runtime.getManifest().version;
    out.wallpaperUrl = out.wallpaper === 'custom' && out.wallpaperData ? out.wallpaperData : '';
    delete out.wallpaperData;
    return out;
  }

  async function set(key, value) {
    if (!KEYS.includes(key) && key !== 'wallpaperData') return false;
    const { settings: s } = await browser.storage.local.get('settings');
    const next = Object.assign(JSON.parse(JSON.stringify(D)), s || {});
    next[key] = value;
    await browser.storage.local.set({ settings: next });
    return true;
  }

  function toUrl(text, engine) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (/^(https?|file):/i.test(s)) return s;
    if (!/\s/.test(s) && /^(localhost|[\d.]+)(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[\p{L}\d-]+(\.[\p{L}\d-]+)+(:\d+)?([/?#].*)?$/u.test(s)) return 'https://' + s;
    return (window.BYSS_ENGINES[engine] || window.BYSS_ENGINES.google) + encodeURIComponent(s);
  }

  async function open(url, newTab) {
    const s = await settings();
    const u = toUrl(url, s.engine);
    if (!u) return;
    if (newTab) {
      await browser.tabs.create({ url: u, active: false });
      return;
    }
    const cur = await browser.tabs.getCurrent();
    if (cur) await browser.tabs.update(cur.id, { url: u });
    else location.href = u;
  }

  // меню плитки: открыть в новой вкладке / изменить / удалить — своё, в стиле BySS
  function tileMenu() {
    return new Promise((resolve) => {
      const pt = window.__byssLastPointer || { x: innerWidth / 2, y: innerHeight / 2 };
      const back = document.createElement('div');
      back.className = 'ctx-back';
      const m = document.createElement('div');
      m.className = 'ctx';
      const items = [['newtab', 'Открыть в новой вкладке'], ['edit', 'Изменить'], ['-'], ['delete', 'Удалить с главной']];
      for (const [id, label] of items) {
        if (id === '-') {
          m.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
          continue;
        }
        const b = document.createElement('button');
        b.textContent = label;
        if (id === 'delete') b.className = 'danger';
        b.onclick = (e) => {
          e.stopPropagation();
          done(id);
        };
        m.appendChild(b);
      }
      back.appendChild(m);
      document.body.appendChild(back);
      const r = m.getBoundingClientRect();
      m.style.left = Math.min(pt.x, innerWidth - r.width - 8) + 'px';
      m.style.top = Math.min(pt.y, innerHeight - r.height - 8) + 'px';
      let finished = false;
      function done(v) {
        if (finished) return;
        finished = true;
        back.remove();
        removeEventListener('keydown', esc, true);
        resolve(v);
      }
      function esc(e) {
        if (e.key === 'Escape') done(null);
      }
      back.onclick = () => done(null);
      back.oncontextmenu = (e) => {
        e.preventDefault();
        done(null);
      };
      addEventListener('keydown', esc, true);
    });
  }
  addEventListener('contextmenu', (e) => {
    window.__byssLastPointer = { x: e.clientX, y: e.clientY };
  }, true);

  const handlers = {
    settings,
    set,
    open,
    search: async (engine, q) => {
      if (!q || !String(q).trim()) return;
      const url = (window.BYSS_ENGINES[engine] || window.BYSS_ENGINES.google) + encodeURIComponent(String(q).trim());
      const cur = await browser.tabs.getCurrent();
      if (cur) await browser.tabs.update(cur.id, { url });
      else location.href = url;
    },
    icon: (url) => browser.runtime.sendMessage({ t: 'icon', url }),
    'tile-menu': tileMenu,
    'open-settings': () => browser.runtime.openOptionsPage()
  };

  window.byss = {
    invoke(ch, ...args) {
      const h = handlers[ch];
      if (!h) return Promise.reject(new Error('нет такого действия: ' + ch));
      try {
        return Promise.resolve(h(...args));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    on(ch, fn) {
      (listeners[ch] = listeners[ch] || []).push(fn);
    }
  };

  browser.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local' || !ch.settings || !listeners.settings) return;
    const s = await settings();
    for (const fn of listeners.settings) fn(s);
  });
})();
