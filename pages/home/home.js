'use strict';
const B = window.byss;
const I = window.ICONS;
let S = null;
const icons = new Map();

const ENGINES = {
  google: { name: 'Google', glyph: 'G' },
  yandex: { name: 'Яндекс', glyph: 'Я' },
  ddg: { name: 'DuckDuckGo', glyph: 'D' },
  bing: { name: 'Bing', glyph: 'B' }
};
const PALETTE = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#64D2FF', '#FF375F', '#5E5CE6', '#FFD60A', '#32D74B', '#AC8E68', '#66D4CF'];

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}
function colorFor(key) {
  let h = 0;
  for (const c of key || '') h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function apply(s) {
  S = s;
  document.body.classList.toggle('light', s.theme === 'light');
  const wall = document.getElementById('wall');
  wall.className = s.wallpaper || 'lines';
  wall.style.backgroundImage = s.wallpaper === 'custom' ? 'url("byss://data/wallpaper?' + (s.wallpaperStamp || 0) + '")' : '';
  const brand = document.getElementById('brand');
  brand.style.display = s.showBrand === false ? 'none' : '';
  // в режиме BySS — название режима и щит, как на телефоне
  renderBrand(brand, s.modeName || s.name || 'BySS', 34);
  document.getElementById('shieldmark').innerHTML = s.modeName ? I.shield : '';
  renderSearch();
  renderGrid();
  renderWeather();
}

// ---------------------------------------------------------------- поиск
function renderSearch() {
  const box = document.getElementById('search');
  box.innerHTML = '';
  (S.engines || ['google', 'yandex', 'currency']).forEach((key, i) => {
    if (key === 'currency') {
      if (i === 2) box.appendChild(fxRow());
      return;
    }
    const e = ENGINES[key] || ENGINES.google;
    const row = document.createElement('div');
    row.className = 'srow';
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = e.glyph;
    const input = document.createElement('input');
    input.placeholder = 'Поиск: ' + e.name;
    input.spellcheck = false;
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && input.value.trim()) B.invoke('search', key, input.value);
    });
    badge.onclick = () => input.focus();
    row.append(badge, input);
    box.appendChild(row);
    if (i === 0) setTimeout(() => { if (document.activeElement === document.body) input.focus(); }, 50);
  });
}

// ---------------------------------------------------------------- сайты
function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const list = (S.shortcuts || []).slice(0, 18);
  list.forEach((sc, i) => grid.appendChild(cell(sc, i)));
  const add = document.getElementById('add');
  add.innerHTML = I.plus;
  add.style.display = (S.shortcuts || []).length >= 18 ? 'none' : '';
  add.onclick = (e) => {
    heart(e.currentTarget);
    edit(-1);
  };
}

function cell(sc, i) {
  const c = document.createElement('div');
  c.className = 'cell';
  c.title = sc.url;
  const tile = document.createElement('div');
  tile.className = 'tile';
  const host = hostOf(sc.url);
  const letter = document.createElement('div');
  letter.className = 'letter';
  letter.textContent = (sc.title || host || '?').trim().charAt(0).toUpperCase();
  const tint = colorFor(host);
  if (S.theme === 'light') {
    tile.style.background = 'linear-gradient(135deg,' + tint + ',' + tint + 'cc)';
    letter.style.color = '#fff';
  } else {
    letter.style.color = tint;
  }
  tile.appendChild(letter);
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = sc.title || host;
  c.append(tile, name);
  c.onclick = (e) => B.invoke('open', sc.url, e.ctrlKey || e.metaKey);
  c.onauxclick = (e) => { if (e.button === 1) B.invoke('open', sc.url, true); };
  c.oncontextmenu = async (e) => {
    e.preventDefault();
    const what = await B.invoke('tile-menu');
    if (what === 'newtab') B.invoke('open', sc.url, true);
    if (what === 'edit') edit(i);
    if (what === 'delete') {
      const list = S.shortcuts.slice();
      list.splice(i, 1);
      B.invoke('set', 'shortcuts', list);
    }
  };
  loadIcon(sc.url).then((src) => {
    if (!src) return;
    const img = document.createElement('img');
    img.src = src.url;
    img.alt = '';
    if (src.bleed) img.className = 'bleed';
    tile.style.background = ''; // цветной фон — только для буквы; под значком — обычная плитка
    tile.innerHTML = '';
    tile.appendChild(img);
  });
  return c;
}

// Все значки — одного размера: рисунок без полей вписываем в одинаковую рамку на плитке.
// Значок «на всю плитку» (свой цветной фон, как у YouTube) в светлой теме показываем целиком.
const TILE_PX = 192;   // плитка 60 точек × до 3× плотности экрана
const CONTENT = 0.6;   // рисунок занимает 60% плитки — как буквы и значки на телефоне

function bbox(data, w, h, isInk) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isInk((y * w + x) * 4)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function fitInto(src, box, out) {
  const cv = document.createElement('canvas');
  cv.width = out;
  cv.height = out;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const room = out * CONTENT;
  const k = Math.min(room / box.w, room / box.h);
  const w = box.w * k, h = box.h * k;
  ctx.drawImage(src, box.x, box.y, box.w, box.h, (out - w) / 2, (out - h) / 2, w, h);
  return cv.toDataURL('image/png');
}

async function loadIcon(url) {
  const key = hostOf(url) + '|' + (S.theme === 'light' ? 'l' : 'd');
  if (icons.has(key)) return icons.get(key);
  const p = (async () => {
    const data = await B.invoke('icon', url).catch(() => null);
    if (!data) return null;
    const img = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = data;
    });
    if (!img || !(img.naturalWidth || img.width)) return null;
    // рисуем исходник крупно (векторный — в полном качестве), сохраняя пропорции
    const N = 256;
    const iw = img.naturalWidth || N, ih = img.naturalHeight || N;
    const k = N / Math.max(iw, ih);
    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (N - iw * k) / 2, (N - ih * k) / 2, iw * k, ih * k);
    let id;
    try {
      id = ctx.getImageData(0, 0, N, N);
    } catch (e) {
      return { url: data };
    }
    const d = id.data;
    const corner = (x, y) => (y * N + x) * 4;
    const cs = [corner(4, 4), corner(N - 5, 4), corner(4, N - 5), corner(N - 5, N - 5)];
    const opaque = cs.every((o) => d[o + 3] > 200);
    if (S.theme === 'light') {
      if (opaque) {
        const o = cs[0];
        const light = (d[o] + d[o + 1] + d[o + 2]) / 3 > 225;
        if (!light) return { url: cv.toDataURL('image/png'), bleed: true }; // свой цветной фон — на всю плитку
        // белая подложка — убираем её из расчёта рамки
        const box = bbox(d, N, N, (i) => d[i + 3] > 24 && Math.abs(d[i] - d[o]) + Math.abs(d[i + 1] - d[o + 1]) + Math.abs(d[i + 2] - d[o + 2]) > 40);
        return box ? { url: fitInto(cv, box, TILE_PX) } : { url: cv.toDataURL('image/png'), bleed: true };
      }
      const box = bbox(d, N, N, (i) => d[i + 3] > 24);
      return box ? { url: fitInto(cv, box, TILE_PX) } : null;
    }
    try {
      const out = blackTile(id);
      const res = new ImageData(out.data, N, N);
      ctx.clearRect(0, 0, N, N);
      ctx.putImageData(res, 0, 0);
      const box = bbox(out.data, N, N, (i) => out.data[i + 3] > 24);
      if (!box) return null;
      return { url: fitInto(cv, box, TILE_PX) };
    } catch (e) {
      return { url: data };
    }
  })();
  icons.set(key, p);
  return p;
}

function edit(i) {
  const isNew = i < 0;
  const sc = isNew ? { title: '', url: '' } : S.shortcuts[i];
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal"><h3></h3><div class="row">'
    + '<input class="field" id="m-url" placeholder="Адрес сайта, например youtube.com" spellcheck="false">'
    + '<input class="field" id="m-title" placeholder="Название (можно не писать)" spellcheck="false">'
    + '</div><div class="btns"><button class="btn" id="m-no">Отмена</button><button class="btn p" id="m-ok">Сохранить</button></div></div>';
  back.querySelector('h3').textContent = isNew ? 'Добавить сайт' : 'Изменить сайт';
  document.body.appendChild(back);
  const url = back.querySelector('#m-url');
  const title = back.querySelector('#m-title');
  url.value = sc.url;
  title.value = sc.title;
  url.focus();
  const close = () => back.remove();
  const save = () => {
    let u = url.value.trim();
    if (!u) return close();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    let t = title.value.trim();
    if (!t) {
      const h = hostOf(u);
      t = h.split('.').slice(-2, -1)[0] || h;
      t = t.charAt(0).toUpperCase() + t.slice(1);
    }
    const list = (S.shortcuts || []).slice();
    if (isNew) list.push({ title: t, url: u });
    else list[i] = { title: t, url: u };
    B.invoke('set', 'shortcuts', list);
    close();
  };
  back.querySelector('#m-no').onclick = close;
  back.querySelector('#m-ok').onclick = save;
  back.onclick = (e) => { if (e.target === back) close(); };
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') close();
  });
}

// ---------------------------------------------------------------- погода
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z"/></svg>';
const CLOUD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 18.5h10.2a4 4 0 0 0 .5-7.97A5.6 5.6 0 0 0 6.9 9.3 4.6 4.6 0 0 0 7 18.5Z"/></svg>';
const RAIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10.2a3.6 3.6 0 0 0 .4-7.2A5.2 5.2 0 0 0 7.5 6.6 4.2 4.2 0 0 0 7 15Z"/><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/></svg>';
const SNOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10.2a3.6 3.6 0 0 0 .4-7.2A5.2 5.2 0 0 0 7.5 6.6 4.2 4.2 0 0 0 7 15Z"/><path d="M9 19h.01M13 19h.01M17 19h.01M11 21.5h.01M15 21.5h.01"/></svg>';
const STORM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10.2a3.6 3.6 0 0 0 .4-7.2A5.2 5.2 0 0 0 7.5 6.6 4.2 4.2 0 0 0 7 15Z"/><path d="M12.5 15.5 10.5 19h3l-2 3"/></svg>';
const FOG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 9h16M6 13h12M4 17h16"/></svg>';

function wText(c) {
  if (c === 0) return 'ясно';
  if (c === 1) return 'малооблачно';
  if (c === 2) return 'переменная облачность';
  if (c === 3) return 'пасмурно';
  if (c === 45 || c === 48) return 'туман';
  if (c >= 51 && c <= 55) return 'морось';
  if (c === 56 || c === 57) return 'ледяная морось';
  if (c >= 61 && c <= 65) return c === 65 ? 'сильный дождь' : 'дождь';
  if (c === 66 || c === 67) return 'ледяной дождь';
  if (c >= 71 && c <= 75) return c === 75 ? 'сильный снег' : 'снег';
  if (c === 77) return 'снежная крупа';
  if (c >= 80 && c <= 82) return 'ливень';
  if (c === 85 || c === 86) return 'снегопад';
  if (c === 95) return 'гроза';
  if (c === 96 || c === 99) return 'гроза с градом';
  return '';
}
function wIcon(c, day) {
  if (c === 0) return day ? SUN : MOON;
  if (c === 1 || c === 2) return day ? SUN : MOON;
  if (c === 45 || c === 48) return FOG;
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return SNOW;
  if (c >= 95) return STORM;
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return RAIN;
  return CLOUD;
}

const FRESH = 10 * 60 * 1000;

async function weatherFor(city) {
  const key = 'w:' + city.lat + ',' + city.lon;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { cached = null; }
  if (cached && Date.now() - cached.at < FRESH) return cached;
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + city.lat + '&longitude=' + city.lon
      + '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1');
    const j = await r.json();
    const d = {
      at: Date.now(),
      t: j.current.temperature_2m,
      code: j.current.weather_code,
      day: j.current.is_day === 1,
      max: j.daily && j.daily.temperature_2m_max[0],
      min: j.daily && j.daily.temperature_2m_min[0]
    };
    localStorage.setItem(key, JSON.stringify(d));
    return d;
  } catch (e) {
    return cached;
  }
}

async function renderWeather() {
  const box = document.getElementById('weather');
  const cities = (S.cities || []).filter((c) => c && c.name);
  const rows = await Promise.all(cities.slice(0, 2).map(async (c) => ({ c, d: await weatherFor(c) })));
  box.innerHTML = '';
  for (const { c, d } of rows) {
    const el = document.createElement('div');
    el.className = 'w';
    el.title = 'Города меняются в настройках';
    if (!d) {
      el.innerHTML = CLOUD + '<div><div class="t">—</div><div class="d"></div></div>';
      el.querySelector('.d').textContent = c.name + ' · нет связи';
    } else {
      const r = (x) => Math.round(x) + '°';
      el.innerHTML = wIcon(d.code, d.day) + '<div><div class="t"></div><div class="d"></div></div>';
      el.querySelector('.t').textContent = r(d.t);
      el.querySelector('.d').textContent = c.name + ' · ' + wText(d.code) + (d.max != null ? ' · ' + r(d.max) + ' / ' + r(d.min) : '');
    }
    el.onclick = () => B.invoke('open-settings');
    box.appendChild(el);
  }
}
setInterval(() => S && renderWeather(), 60 * 1000);

B.on('settings', apply);
B.invoke('settings').then(apply);
