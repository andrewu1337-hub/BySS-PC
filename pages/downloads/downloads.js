'use strict';
// Скачанные файлы: список с поиском, «Открыть», «Показать в папке», пауза и отмена текущих загрузок.
const B = window.byss;
const I = window.ICONS;
let all = [];
const iconCache = new Map();

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function size(b) {
  if (!b) return '';
  if (b < 1024) return b + ' Б';
  if (b < 1048576) return Math.round(b / 1024) + ' КБ';
  if (b < 1073741824) return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
  return (b / 1073741824).toFixed(2).replace('.', ',') + ' ГБ';
}

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function dayName(t) {
  const d = new Date(t);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function status(d) {
  const time = new Date(d.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const src = host(d.url);
  const tail = (src ? ' · ' + src : '') + ' · ' + time;
  if (d.state === 'progress') return (d.size ? size(d.got) + ' из ' + size(d.size) : size(d.got)) + tail;
  if (d.state === 'paused') return 'Пауза · ' + size(d.got) + (d.size ? ' из ' + size(d.size) : '') + tail;
  if (d.state === 'cancelled') return 'Отменено' + tail;
  if (d.state === 'interrupted') return 'Не скачалось' + tail;
  if (!d.exists) return 'Файл удалён или перемещён' + tail;
  return size(d.size || d.got) + tail;
}

function render() {
  const box = document.getElementById('list');
  const q = document.getElementById('q').value.trim().toLowerCase();
  const list = all.filter((d) => !q || d.name.toLowerCase().includes(q) || host(d.url).includes(q));
  box.innerHTML = '';
  if (!list.length) {
    const e = el('div', 'empty');
    e.innerHTML = I.download;
    e.appendChild(document.createTextNode(q ? 'Ничего не нашлось' : 'Здесь появятся скачанные файлы'));
    box.appendChild(e);
    return;
  }
  let day = null;
  let group = null;
  for (const d of list) {
    const dn = dayName(d.time);
    if (dn !== day) {
      day = dn;
      box.appendChild(el('div', 'day', dn));
      group = el('div', 'group');
      box.appendChild(group);
    }
    group.appendChild(item(d));
  }
}

function item(d) {
  const done = d.state === 'completed';
  const r = el('div', 'd' + (done && !d.exists ? ' gone' : ''));
  const ic = el('div', 'ic');
  ic.innerHTML = I.download;
  if (done && d.exists) {
    const cached = iconCache.get(d.id);
    const put = (src) => {
      if (!src) return;
      ic.innerHTML = '';
      ic.classList.add('has');
      const im = el('img');
      im.src = src;
      ic.appendChild(im);
    };
    if (cached !== undefined) put(cached);
    else B.invoke('dl-icon', d.id).then((src) => { iconCache.set(d.id, src); put(src); }).catch(() => {});
  }
  const info = el('div', 'info');
  const nm = el('div', 'nm' + (done && d.exists ? ' link' : ''), d.name);
  if (d.mode) nm.appendChild(el('span', 'tag', 'BySS'));
  if (done && d.exists) nm.onclick = () => B.invoke('dl-open', d.id);
  info.appendChild(nm);
  info.appendChild(el('div', 'sub', status(d)));
  if ((d.state === 'progress' || d.state === 'paused') && d.size) {
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = Math.round(100 * Math.min(1, d.got / d.size)) + '%';
    bar.appendChild(fill);
    info.appendChild(bar);
  }
  const acts = el('div', 'acts');
  const btn = (label, fn, primary) => {
    const b = el('button', 'btn' + (primary ? ' p' : ''), label);
    b.onclick = fn;
    acts.appendChild(b);
  };
  if (d.live) {
    btn(d.state === 'paused' ? 'Продолжить' : 'Пауза', () => B.invoke('dl-pause', d.id));
    btn('Отмена', () => B.invoke('dl-cancel', d.id));
  } else if (done && d.exists) {
    btn('Показать в папке', () => B.invoke('dl-folder', d.id));
    btn('Открыть', () => B.invoke('dl-open', d.id), true);
  } else if (!done && d.url) {
    btn('Скачать снова', () => B.invoke('dl-retry', d.id));
  }
  if (!d.live) {
    const x = el('button', 'x');
    x.title = 'Убрать из списка (файл останется)';
    x.innerHTML = I.close;
    x.onclick = () => B.invoke('dl-remove', d.id);
    acts.appendChild(x);
  }
  r.append(ic, info, acts);
  return r;
}

function apply(s) {
  document.body.classList.toggle('light', s.theme === 'light');
}

document.getElementById('q').addEventListener('input', render);
document.getElementById('dir').onclick = () => B.invoke('dl-dir');
document.getElementById('clear').onclick = () => B.invoke('dl-clear');
B.on('downloads', (list) => { all = list || []; render(); });
B.on('settings', apply);
B.invoke('settings').then(apply);
B.invoke('downloads').then((list) => { all = list || []; render(); });
