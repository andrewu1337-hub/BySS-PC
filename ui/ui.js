'use strict';
const api = window.byssUI;
const I = window.ICONS;
const HEART = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,21.5 C12,21.5 2,14.6 2,8.4 C2,4.8 4.8,2.8 7.4,2.8 C9.6,2.8 11.2,4.1 12,5.6 C12.8,4.1 14.4,2.8 16.6,2.8 C19.2,2.8 22,4.8 22,8.4 C22,14.6 12,21.5 12,21.5 Z"/></svg>';
const $ = (id) => document.getElementById(id);

$('plus').innerHTML = I.plus;
$('back').innerHTML = I.back;
$('fwd').innerHTML = I.forward;
$('reload').innerHTML = I.reload;
$('tr').innerHTML = I.translate;
$('menu').innerHTML = I.menu;
$('pfind').innerHTML = I.search;
$('pas').innerHTML = I.autoscroll;
$('pcopy').innerHTML = I.link;
$('pprint').innerHTML = I.print;
$('fup').innerHTML = '<svg viewBox="0 0 24 24"><path d="M6,15 L12,9 L18,15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
$('fdown').innerHTML = '<svg viewBox="0 0 24 24"><path d="M6,9 L12,15 L18,9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
$('fclose').innerHTML = I.close;

let state = null;
let dragId = null;

function heart(el) {
  const r = el.getBoundingClientRect();
  const h = document.createElement('div');
  h.className = 'heart';
  h.innerHTML = HEART;
  h.style.left = (r.left + r.width / 2) + 'px';
  h.style.top = (r.top + r.height / 2) + 'px';
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 700);
}

$('plus').onclick = (e) => {
  heart(e.currentTarget);
  api.send('tab:new');
};
$('back').onclick = () => api.send('nav:back');
$('fwd').onclick = () => api.send('nav:forward');
$('reload').onclick = () => api.send('nav:reload');
$('menu').onclick = () => api.send('ui:menu');
$('shield').onclick = () => api.send('ui:shield');
$('tr').onclick = () => api.send('ui:translate');
$('pfind').onclick = () => api.send('ui:find');
$('pas').onclick = () => api.send('ui:autoscroll');
$('pcopy').onclick = () => {
  api.send('ui:copy');
  const b = $('pcopy');
  b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5,12.5 L10,17.5 L19,7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  setTimeout(() => { b.innerHTML = I.link; }, 1200);
};
$('pprint').onclick = () => api.send('ui:print');
$('eng').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  api.send('ui:engine', Math.round(r.left), Math.round(r.bottom + 4));
};
const ENGINES = {
  google: { name: 'Google', where: 'Google', glyph: 'G' },
  yandex: { name: 'Яндекс', where: 'Яндексе', glyph: 'Я' },
  ddg: { name: 'DuckDuckGo', where: 'DuckDuckGo', glyph: 'D' },
  bing: { name: 'Bing', where: 'Bing', glyph: 'B' }
};

const addr = $('addr');
let selectOnUp = false;
let dirty = false;          // пользователь начал печатать — не перебиваем его текст
let shownTab = null;
const addrFocused = () => document.hasFocus() && document.activeElement === addr;
addr.addEventListener('mousedown', () => {
  selectOnUp = !addrFocused();
});
addr.addEventListener('mouseup', (e) => {
  if (selectOnUp) {
    e.preventDefault();
    addr.select();
  }
  selectOnUp = false;
});
addr.addEventListener('input', () => { dirty = true; document.body.classList.add('typing'); });
addr.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = addr.value.trim();
    dirty = false;
    if (v) api.send('nav:go', v);
    addr.blur();
  } else if (e.key === 'Escape') {
    dirty = false;
    showUrl(true);
    addr.blur();
    api.send('ui:focus-page');
  }
});
addr.addEventListener('blur', () => {
  dirty = false;
  document.body.classList.remove('typing');
  setTimeout(() => showUrl(true), 0);
});

function prettyUrl(u) {
  if (!u) return '';
  try {
    const x = new URL(u);
    if (x.protocol === 'https:' || x.protocol === 'http:') {
      let s = x.host.replace(/^www\./, '') + (x.pathname === '/' ? '' : decodeURI(x.pathname)) + x.search + x.hash;
      return s;
    }
  } catch (e) {
    return u;
  }
  return u;
}

function showUrl(force) {
  if (!state) return;
  if (!force && dirty && addrFocused()) return;
  const u = state.nav.url;
  const v = u ? (addrFocused() ? u : prettyUrl(u)) : '';
  if (addr.value !== v) addr.value = v;
}
addr.addEventListener('focus', () => {
  if (state && state.nav.url && !dirty) addr.value = state.nav.url;
});

api.on('focus-address', () => {
  dirty = false;
  if (state) addr.value = state.nav.url || '';
  addr.focus();
  addr.select();
});

// ---------------------------------------------------------------- поиск по странице
const fq = $('fq');
fq.addEventListener('input', () => api.send('find:query', fq.value, true, false));
fq.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') api.send('find:query', fq.value, !e.shiftKey, true);
  if (e.key === 'Escape') api.send('find:close');
});
$('fup').onclick = () => api.send('find:query', fq.value, false, true);
$('fdown').onclick = () => api.send('find:query', fq.value, true, true);
$('fclose').onclick = () => api.send('find:close');
api.on('find-open', () => {
  $('find').hidden = false;
  fq.focus();
  fq.select();
  if (fq.value) api.send('find:query', fq.value, true, false);
});
api.on('find-result', (active, total) => {
  $('fcount').textContent = total ? active + ' из ' + total : (fq.value ? 'нет' : '');
});

// ---------------------------------------------------------------- вкладки
// Вкладки не пересоздаются при каждом обновлении — иначе нажатие на «×» терялось:
// кнопка исчезала между нажатием и отпусканием мыши, и вкладка не закрывалась.
const tabEls = new Map();

function makeTab(id) {
  const el = document.createElement('div');
  el.draggable = true;
  const fav = document.createElement('div');
  fav.className = 'fav';
  const title = document.createElement('div');
  title.className = 'title';
  const x = document.createElement('button');
  x.className = 'x';
  x.innerHTML = I.close;
  x.title = 'Закрыть (Ctrl+W)';
  x.addEventListener('mousedown', (e) => e.stopPropagation());
  x.onclick = (e) => {
    e.stopPropagation();
    api.send('tab:close', id);
  };
  el.append(fav, title, x);
  el.onmousedown = (e) => {
    if (e.button === 0) api.send('tab:activate', id);
    if (e.button === 1) e.preventDefault(); // без «автопрокрутки» колёсиком
  };
  el.onauxclick = (e) => {
    if (e.button === 1) api.send('tab:close', id);
  };
  el.oncontextmenu = (e) => {
    e.preventDefault();
    api.send('tab:menu', id);
  };
  el.ondragstart = (e) => {
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
  };
  el.ondragover = (e) => {
    if (dragId == null) return;
    e.preventDefault();
    el.classList.add('drop-before');
  };
  el.ondragleave = () => el.classList.remove('drop-before');
  el.ondrop = (e) => {
    e.preventDefault();
    el.classList.remove('drop-before');
    if (dragId == null || dragId === id || !state) return;
    const ids = state.tabs.map((z) => z.id);
    let to = ids.indexOf(id);
    if (ids.indexOf(dragId) < to) to -= 1;
    api.send('tab:move', dragId, to);
    dragId = null;
  };
  el.ondragend = () => { dragId = null; };
  const r = { el, fav, title, favKey: null };
  tabEls.set(id, r);
  return r;
}

function setFav(r, t) {
  const key = t.loading ? 'load' : t.mode ? 'mode' : t.favicon ? 'img:' + t.favicon
    : t.url.startsWith('byss://home') ? 'home' : 'search';
  if (r.favKey === key) return;
  r.favKey = key;
  const fav = r.fav;
  if (key === 'load') fav.innerHTML = '<div class="spin"></div>';
  else if (key === 'mode') fav.innerHTML = I.shield;
  else if (key === 'home') fav.innerHTML = I.home;
  else if (key === 'search') fav.innerHTML = I.search;
  else {
    fav.innerHTML = '';
    const img = document.createElement('img');
    img.src = t.favicon;
    img.onerror = () => { fav.innerHTML = I.home; };
    fav.appendChild(img);
  }
}

function render() {
  const s = state;
  document.body.classList.toggle('light', s.theme === 'light');
  document.body.classList.toggle('mac', s.platform === 'darwin');
  document.body.classList.toggle('inmode', !!s.nav.mode);
  $('find').hidden = !s.findOpen;

  const box = $('tabs');
  const width = Math.max(120, $('strip').clientWidth - (s.platform === 'darwin' ? 130 : 200));
  const narrow = s.tabs.length * 120 > width;
  const alive = new Set();
  s.tabs.forEach((t, i) => {
    alive.add(t.id);
    const r = tabEls.get(t.id) || makeTab(t.id);
    const cls = 'tab' + (t.id === s.active ? ' active' : '') + (t.mode ? ' mode' : '') + (narrow ? ' narrow' : '');
    if (r.el.className.replace(' drop-before', '') !== cls) r.el.className = cls;
    const tip = (t.mode ? t.modeName + ' · ' : '') + t.title;
    if (r.el.title !== tip) r.el.title = tip;
    if (r.title.textContent !== t.title) r.title.textContent = t.title;
    setFav(r, t);
    if (box.children[i] !== r.el) box.insertBefore(r.el, box.children[i] || null);
  });
  for (const [id, r] of tabEls) {
    if (!alive.has(id)) {
      r.el.remove();
      tabEls.delete(id);
    }
  }

  const e = ENGINES[s.engine] || ENGINES.google;
  $('engG').textContent = e.glyph;
  $('eng').title = 'Поиск из адресной строки: ' + e.name + ' — нажмите, чтобы сменить';

  const n = s.nav;
  $('back').disabled = !n.canBack;
  $('fwd').disabled = !n.canFwd;
  $('reload').innerHTML = n.loading ? I.close : I.reload;
  $('reload').title = n.loading ? 'Остановить' : 'Обновить (F5)';
  const sh = $('shield');
  sh.style.visibility = n.site ? 'visible' : 'hidden';
  const on = n.adblock && !n.allowed;
  sh.innerHTML = (on ? I.shield : I.shield_off) + '<span id="count">' + (on && n.blocked ? (n.blocked > 99 ? '99+' : n.blocked) : '') + '</span>';
  sh.classList.toggle('on', on);
  sh.title = on ? 'Реклама и трекеры блокируются' + (n.blocked ? ' · заблокировано: ' + n.blocked : '') : 'Блокировка выключена для этого сайта';
  $('tr').style.display = n.site ? '' : 'none';
  for (const k of ['pfind', 'pcopy', 'pprint']) $(k).style.display = n.site ? '' : 'none';
  $('pas').style.display = n.site && n.autoscroll ? '' : 'none';
  $('pfind').classList.toggle('on', !!s.findOpen);
  $('tr').classList.toggle('on', n.translated);
  $('tr').title = n.translated ? 'Показать оригинал' : 'Перевести страницу';
  addr.placeholder = (n.mode ? n.modeName + ' · ' : '') + 'Поиск в ' + e.where + ' или адрес';
  showUrl(false);
}

api.on('state', (s) => {
  // другая вкладка — недопечатанный текст из прошлой не нужен
  if (s.active !== shownTab) {
    shownTab = s.active;
    dirty = false;
  }
  state = s;
  render();
});
window.addEventListener('resize', () => state && render());
api.send('ui:ready');
