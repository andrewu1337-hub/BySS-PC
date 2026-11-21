'use strict';
// Быстрые настройки BySS (кнопка на панели) — как меню «⋮» в прежнем BySS:
// скриншот, автоскролл, перевод, главная, настройки, тема; «Удалить все данные» — красным,
// «Проверить обновления» и «Приватное окно» — синим.
const B = window.byss;
const I = window.ICONS;
const panel = document.getElementById('panel');
let S = null;
let tab = null;
let asOn = false;
let asWhy = '';
let updMsg = null;   // { text, setupUrl } — ответ проверки обновлений
let clearState = ''; // '' | 'ask' | 'done'

const INTERVALS = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60];
const STEPS = [10, 25, 50, 75, 90, 100];
const TICKS = [1, 2, 3, 5, 10];

let opened = new Set();
try {
  opened = new Set(JSON.parse(localStorage.getItem('open') || '[]'));
} catch (e) {
  opened = new Set();
}
function remember() {
  try {
    localStorage.setItem('open', JSON.stringify([...opened]));
  } catch (e) {
    // не страшно
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function icon(name) {
  const d = el('span', 'ic');
  if (name && I[name]) d.innerHTML = I[name];
  return d;
}
function item(o) {
  const b = el('button', 'it' + (o.color ? ' ' + o.color : ''));
  b.setAttribute('role', 'menuitem');
  b.append(icon(o.icon), el('span', 'lb', o.label));
  if (o.badge) b.appendChild(el('span', 'bd', o.badge));
  if (o.accel) b.appendChild(el('span', 'ac', o.accel));
  if (o.disabled) b.disabled = true;
  b.onclick = () => o.onClick && o.onClick(b);
  return b;
}
function group(key, iconName, label, badge, fill) {
  const wrap = el('div');
  const b = el('button', 'it');
  b.append(icon(iconName), el('span', 'lb', label));
  if (badge) b.appendChild(el('span', 'bd', badge));
  const ch = el('span', 'ch');
  ch.innerHTML = I.chevron;
  b.appendChild(ch);
  const sub = el('div', 'sub');
  fill(sub);
  const set = (open) => {
    sub.classList.toggle('open', open);
    b.classList.toggle('open', open);
    if (open) opened.add(key);
    else opened.delete(key);
    remember();
  };
  set(opened.has(key));
  b.onclick = () => set(!sub.classList.contains('open'));
  wrap.append(b, sub);
  return wrap;
}
function seg(label, options) {
  const row = el('div', 'ctl');
  row.appendChild(el('span', 'cl', label));
  const box = el('span', 'seg');
  for (const o of options) {
    const b = el('button', o.on ? 'on' : '', o.label);
    b.onclick = () => { if (!o.on) o.onClick(); };
    box.appendChild(b);
  }
  row.appendChild(box);
  return row;
}
function stepper(label, list, cur, key, fmt) {
  const row = el('div', 'ctl');
  row.appendChild(el('span', 'cl', label));
  const box = el('span', 'stp');
  const i = list.indexOf(cur);
  const dn = el('button', null, '−');
  const up = el('button', null, '+');
  dn.disabled = i <= 0;
  up.disabled = i < 0 || i >= list.length - 1;
  dn.onclick = () => setAs({ [key]: list[Math.max(0, i - 1)] });
  up.onclick = () => setAs({ [key]: list[Math.min(list.length - 1, i + 1)] });
  box.append(dn, el('span', 'sv', fmt(cur)), up);
  row.appendChild(box);
  return row;
}
function ticksWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return n + ' щелчок';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' щелчка';
  return n + ' щелчков';
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}
/** Коротко подтвердить действие на самом пункте и закрыть меню. */
function flash(b, text, close) {
  const lb = b.querySelector('.lb');
  if (lb) lb.textContent = text;
  if (close) setTimeout(() => window.close(), 900);
}

// ---------------------------------------------------------------- автоскролл
function asCfg() {
  return Object.assign({}, window.BYSS_DEFAULTS.autoscroll, S.autoscroll || {});
}
function setAs(patch) {
  const a = Object.assign(asCfg(), patch);
  S.autoscroll = a;
  B.invoke('set', 'autoscroll', a);
  render();
}
function fillAs(sub) {
  const a = asCfg();
  sub.appendChild(item({
    icon: asOn ? 'pause' : 'play',
    label: asOn ? 'Остановить' : 'Запустить',
    onClick: async () => {
      const r = await browser.runtime.sendMessage({ t: 'as-set', tabId: tab.id, on: !asOn }).catch(() => null);
      if (r && r.ok) {
        asOn = r.on;
        if (asOn) return window.close();
        asWhy = '';
      } else {
        asWhy = (r && r.why) || 'Не получилось — обновите страницу (F5)';
      }
      render();
    }
  }));
  sub.appendChild(seg('Режим', [['smooth', 'Плавно'], ['step', 'Шагами'], ['wheel', 'Колесом']]
    .map(([m, label]) => ({ label, on: a.mode === m, onClick: () => setAs({ mode: m }) }))));
  if (a.mode === 'smooth') {
    sub.appendChild(stepper('Скорость', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], a.level, 'level', (v) => v + ' из 10'));
  } else if (a.mode === 'step') {
    sub.appendChild(stepper('Интервал', INTERVALS, a.interval, 'interval', (v) => v + ' с'));
    sub.appendChild(stepper('Шаг', STEPS, a.step, 'step', (v) => v + '% экрана'));
  } else {
    sub.appendChild(stepper('Интервал', INTERVALS, a.interval, 'interval', (v) => v + ' с'));
    sub.appendChild(stepper('Колесо', TICKS, a.ticks || 1, 'ticks', ticksWord));
  }
  sub.appendChild(el('div', 'hint', asWhy || 'Колесо мыши — пауза · Alt+Shift+S — запустить или остановить'));
}

// ---------------------------------------------------------------- действия
async function shot(full, b) {
  flash(b, 'Снимаю…');
  const r = await browser.runtime.sendMessage({ t: 'shot', tabId: tab.id, full }).catch(() => null);
  flash(b, r && r.ok ? 'Сохранено в загрузки' : 'Не получилось снять эту страницу', true);
}

async function addHome(b) {
  const host = hostOf(tab.url);
  const list = (S.shortcuts || []).slice();
  if (list.some((sc) => hostOf(sc.url) === host)) return flash(b, 'Уже есть на главной', true);
  if (list.length >= 18) return flash(b, 'На главной уже 18 сайтов', true);
  let t = host.split('.').slice(-2, -1)[0] || host;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  list.push({ title: t, url: tab.url });
  await B.invoke('set', 'shortcuts', list);
  flash(b, 'Добавлено на главную', true);
}

async function checkUpdate() {
  updMsg = { text: 'Проверяю…' };
  render();
  updMsg = await byssCheckUpdate();
  render();
}

function updateBox() {
  const box = el('div', 'msg', updMsg.text);
  if (!updMsg.setupUrl) return box;
  const row = el('div', 'row2');
  const b = el('button', 'btn blue', 'Скачать установщик');
  b.onclick = async () => {
    b.disabled = true;
    b.textContent = 'Скачиваю…';
    const id = await byssDownloadSetup(updMsg.setupUrl);
    b.disabled = false;
    if (id == null) {
      b.textContent = 'Скачать установщик';
      return;
    }
    b.textContent = 'Запустить установщик';
    b.onclick = () => browser.downloads.open(id).catch(() => browser.downloads.show(id));
  };
  row.appendChild(b);
  box.appendChild(row);
  return box;
}

function clearBox() {
  if (clearState === 'done') return el('div', 'msg', 'Готово — данные сайтов удалены.');
  const box = el('div', 'msg', 'Выйдете из всех сайтов, удалятся куки и кэш. Настройки BySS останутся.');
  const row = el('div', 'row2');
  const no = el('button', 'btn', 'Отмена');
  const yes = el('button', 'btn danger', 'Удалить');
  no.onclick = () => { clearState = ''; render(); };
  yes.onclick = async () => {
    await browser.browsingData.remove({}, {
      cache: true, cookies: true, downloads: true, formData: true, history: true,
      indexedDB: true, localStorage: true, serviceWorkers: true, pluginData: true
    }).catch(() => {});
    clearState = 'done';
    render();
  };
  row.append(no, yes);
  box.appendChild(row);
  return box;
}

// ---------------------------------------------------------------- меню
function render() {
  document.body.classList.toggle('light', S.theme === 'light');
  panel.innerHTML = '';
  const site = tab && /^https?:/.test(tab.url || '');
  if (site) {
    panel.appendChild(group('shot', 'screenshot', 'Скриншот', null, (sub) => {
      sub.appendChild(item({ label: 'Видимая часть', onClick: (b) => shot(false, b) }));
      sub.appendChild(item({ label: 'Вся страница', onClick: (b) => shot(true, b) }));
    }));
    panel.appendChild(group('as', 'autoscroll', 'Автоскролл', asOn ? 'идёт' : null, fillAs));
    const translated = hostOf(tab.url).endsWith('.translate.goog');
    panel.appendChild(item({
      icon: 'translate',
      label: translated ? 'Показать оригинал' : 'Перевести страницу',
      onClick: () => {
        browser.runtime.sendMessage({ t: 'translate', tabId: tab.id }).catch(() => {});
        window.close();
      }
    }));
    panel.appendChild(item({ icon: 'plus', label: 'Добавить на главную', onClick: addHome }));
  }
  panel.appendChild(item({
    icon: 'home',
    label: 'Главная',
    onClick: async () => {
      await browser.tabs.create({ url: browser.runtime.getURL('home/index.html') });
      window.close();
    }
  }));
  panel.appendChild(item({
    icon: 'download',
    label: 'Папка загрузок',
    onClick: () => {
      browser.downloads.showDefaultFolder();
      window.close();
    }
  }));
  panel.appendChild(item({
    icon: 'settings',
    label: 'Настройки BySS',
    onClick: () => {
      browser.runtime.openOptionsPage();
      window.close();
    }
  }));
  panel.appendChild(item({
    icon: 'theme',
    label: S.theme === 'light' ? 'Тёмная тема' : 'Светлая тема',
    onClick: async () => {
      S.theme = S.theme === 'light' ? 'dark' : 'light';
      await B.invoke('set', 'theme', S.theme);
      render();
    }
  }));
  panel.appendChild(el('div', 'sep'));
  panel.appendChild(item({
    icon: 'trash',
    label: 'Удалить все данные',
    color: 'danger',
    onClick: () => { clearState = clearState ? '' : 'ask'; render(); }
  }));
  if (clearState) panel.appendChild(clearBox());
  panel.appendChild(item({ icon: 'reload', label: 'Проверить обновления', color: 'accent', onClick: checkUpdate }));
  if (updMsg) panel.appendChild(updateBox());
  panel.appendChild(item({
    icon: 'incognito',
    label: 'Приватное окно',
    color: 'accent',
    accel: 'Ctrl+Shift+P',
    onClick: () => {
      browser.windows.create({ incognito: true }).catch(() => {});
      window.close();
    }
  }));
}

(async () => {
  S = await B.invoke('settings');
  renderBrand(document.getElementById('brand'), S.name || 'BySS', 22);
  document.getElementById('ver').textContent = S.version;
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    const r = await browser.runtime.sendMessage({ t: 'as-state', tabId: tab.id }).catch(() => null);
    asOn = !!(r && r.on);
  }
  render();
})();
