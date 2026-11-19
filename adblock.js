'use strict';
// Блокировка рекламы и трекеров: свободные списки EasyList / EasyPrivacy / RU AdList / Peter Lowe.
// Списки скачиваются прямо с их сайтов и обновляются раз в 4 дня. Никаких сторонних сервисов.

const fs = require('fs');
const path = require('path');

const LISTS = [
  ['easylist_ru.txt', 'https://easylist-downloads.adblockplus.org/ruadlist+easylist.txt'],
  ['easyprivacy.txt', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['czech.txt', 'https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt'],
  ['peterlowe.txt', 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext']
];
const MAX_AGE = 4 * 24 * 3600 * 1000;

// типы запросов, для которых правило «||домен^$...» можно считать блокировкой всего домена
const SAFE_OPTS = new Set(['third-party', '3p', 'script', 'image', 'stylesheet', 'xmlhttprequest', 'xhr',
  'subdocument', 'frame', 'media', 'font', 'websocket', 'ping', 'object', 'other', 'important', 'all']);

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'msk', 'spb']);

/** a.b.example.com → example.com, x.example.co.uk → example.co.uk */
function baseDomain(host) {
  if (!host) return '';
  const h = host.toLowerCase();
  if (/^[0-9.]+$/.test(h) || h.includes(':')) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const take = p[p.length - 1].length === 2 && SECOND_LEVEL.has(p[p.length - 2]) ? 3 : 2;
  return p.slice(p.length - take).join('.');
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

class AdBlock {
  constructor(dir, fetchFn) {
    this.dir = path.join(dir, 'filters');
    this.fetch = fetchFn;
    this.reset();
  }

  reset() {
    this.block = new Set();
    this.allow = new Set();
    this.generic = [];
    this.specific = new Map();
    this.unhide = new Map();
    this.cssCache = new Map();
    this.genericCss = null;
  }

  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.load();
    // устаревшие списки — обновить в фоне
    const stale = LISTS.filter(([f]) => {
      try {
        return Date.now() - fs.statSync(path.join(this.dir, f)).mtimeMs > MAX_AGE;
      } catch (e) {
        return true;
      }
    });
    if (stale.length) this.refresh(stale).catch(() => {});
  }

  load() {
    this.reset();
    for (const [f] of LISTS) {
      try {
        this.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
      } catch (e) {
        // ещё не скачан
      }
    }
  }

  async refresh(lists = LISTS) {
    let changed = false;
    for (const [f, url] of lists) {
      try {
        const r = await this.fetch(url);
        if (!r.ok) continue;
        const text = await r.text();
        if (text.length < 1000) continue;
        fs.writeFileSync(path.join(this.dir, f), text);
        changed = true;
      } catch (e) {
        // нет сети — оставим старый список
      }
    }
    if (changed) this.load();
  }

  get size() {
    return this.block.size;
  }

  parse(text) {
    const lines = text.split(/\r?\n/);
    for (let raw of lines) {
      let line = raw.trim();
      if (!line || line[0] === '!' || line[0] === '[') continue;

      // скрытие элементов на странице
      if (line.includes('#@#')) {
        const i = line.indexOf('#@#');
        const sel = line.slice(i + 3);
        for (const d of line.slice(0, i).split(',')) {
          if (!d || d[0] === '~') continue;
          if (!this.unhide.has(d)) this.unhide.set(d, new Set());
          this.unhide.get(d).add(sel);
        }
        continue;
      }
      if (line.includes('#?#') || line.includes('#$#') || line.includes('#%#')) continue;
      const hi = line.indexOf('##');
      if (hi >= 0) {
        const sel = line.slice(hi + 2);
        if (!sel || sel[0] === '+' || sel[0] === '^' || /:(-abp|has-text|xpath|style|upward|remove|matches-|min-text|watch-attr|contains)/.test(sel)) continue;
        const doms = line.slice(0, hi);
        if (!doms) {
          if (sel.length < 160) this.generic.push(sel);
        } else {
          for (const d of doms.split(',')) {
            if (!d || d[0] === '~') continue;
            if (!this.specific.has(d)) this.specific.set(d, []);
            this.specific.get(d).push(sel);
          }
        }
        continue;
      }

      // сетевые правила: только «||домен^» (так надёжнее и быстрее)
      let exc = false;
      if (line.startsWith('@@')) {
        exc = true;
        line = line.slice(2);
      }
      if (!line.startsWith('||')) continue;
      let rest = line.slice(2);
      let opts = '';
      const di = rest.indexOf('$');
      if (di >= 0) {
        opts = rest.slice(di + 1);
        rest = rest.slice(0, di);
      }
      if (!/\^\|?$/.test(rest)) continue;
      rest = rest.replace(/\^\|?$/, '').toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(rest)) continue;
      if (opts && !exc) {
        const ok = opts.split(',').every((o) => SAFE_OPTS.has(o.trim().toLowerCase()));
        if (!ok) continue;
      }
      (exc ? this.allow : this.block).add(rest);
    }
  }

  /** Блокировать ли запрос к host со страницы pageHost. Свой сайт не трогаем никогда. */
  shouldBlock(host, pageHost) {
    if (!host) return false;
    if (pageHost && baseDomain(host) === baseDomain(pageHost)) return false;
    let h = host;
    for (;;) {
      if (this.allow.has(h)) return false;
      if (this.block.has(h)) return true;
      const i = h.indexOf('.');
      if (i < 0) return false;
      h = h.slice(i + 1);
      if (!h.includes('.')) return false;
    }
  }

  /** CSS, который прячет рекламные блоки на этом сайте. */
  cssFor(host) {
    if (!host) return '';
    if (this.cssCache.has(host)) return this.cssCache.get(host);
    const sels = [];
    let h = host;
    const unhide = new Set();
    for (;;) {
      if (this.specific.has(h)) sels.push(...this.specific.get(h));
      if (this.unhide.has(h)) for (const s of this.unhide.get(h)) unhide.add(s);
      const i = h.indexOf('.');
      if (i < 0) break;
      h = h.slice(i + 1);
    }
    let generic = this.genericCss;
    if (unhide.size) {
      generic = chunks(this.generic.filter((s) => !unhide.has(s)));
    } else if (generic == null) {
      generic = this.genericCss = chunks(this.generic);
    }
    const css = generic + chunks(sels.filter((s) => !unhide.has(s)));
    if (this.cssCache.size > 300) this.cssCache.clear();
    this.cssCache.set(host, css);
    return css;
  }
}

// по 150 селекторов в правиле: если какой-то окажется неверным, пропадёт только его кусок
function chunks(list) {
  let out = '';
  for (let i = 0; i < list.length; i += 150) {
    out += list.slice(i, i + 150).join(',\n') + '{display:none!important}\n';
  }
  return out;
}

module.exports = { AdBlock, baseDomain, hostOf };
