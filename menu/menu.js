'use strict';
// Меню «⋮»: пункты собраны по группам, как на телефоне.
// Нажатие вне меню, Esc или выбор пункта — меню закрывается.
const api = window.byssMenu;
const I = window.ICONS;
const panel = document.getElementById('panel');
let shownAt = 0;

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

function item(it) {
  const b = el('button', 'it' + (it.color ? ' ' + it.color : ''));
  b.setAttribute('role', 'menuitem');
  b.append(icon(it.icon), el('span', 'lb', it.label));
  if (it.accel) b.appendChild(el('span', 'ac', it.accel));
  if (it.trailing) b.style.paddingRight = '44px';
  b.onclick = () => api.pick(it.id);
  if (!it.trailing) return b;
  const row = el('div', 'row');
  const t = el('button', 'tr');
  t.title = it.trailing.title || '';
  t.innerHTML = I[it.trailing.icon] || '';
  t.onclick = (e) => {
    e.stopPropagation();
    api.pick(it.trailing.id);
  };
  row.append(b, t);
  return row;
}

function group(it) {
  const wrap = el('div');
  const b = el('button', 'it' + (it.color ? ' ' + it.color : ''));
  b.setAttribute('aria-expanded', 'false');
  const ch = el('span', 'ch');
  ch.innerHTML = I.chevron;
  b.append(icon(it.icon), el('span', 'lb', it.label), ch);
  const sub = el('div', 'sub');
  for (const c of it.children || []) sub.appendChild(item(c));
  b.onclick = () => {
    const open = !sub.classList.contains('open');
    sub.classList.toggle('open', open);
    b.classList.toggle('open', open);
    b.setAttribute('aria-expanded', String(open));
    if (open) {
      const first = sub.querySelector('button');
      if (first && document.activeElement === b && b.matches(':focus-visible')) first.focus();
      const r = sub.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      if (r.bottom > p.bottom) panel.scrollTop += r.bottom - p.bottom + 6;
    }
  };
  wrap.append(b, sub);
  return wrap;
}

function toggle(it) {
  const b = el('button', 'it sw');
  b.setAttribute('role', 'menuitemcheckbox');
  b.setAttribute('aria-checked', String(!!it.on));
  const tx = el('span', 'tx');
  tx.append(el('span', null, it.label), el('small', null, it.sub || ''));
  const tg = el('span', 'tg' + (it.on ? ' on' : ''));
  b.append(icon(it.icon), tx, tg);
  b.onclick = () => {
    tg.classList.toggle('on');
    setTimeout(() => api.pick(it.id), 120); // переключатель успевает сдвинуться
  };
  return b;
}

function show(m) {
  document.body.classList.toggle('light', !!m.light);
  panel.innerHTML = '';
  for (const it of m.items || []) {
    if (it.type === 'sep') panel.appendChild(el('div', 'sep'));
    else if (it.type === 'head') panel.appendChild(el('div', 'hd', it.label));
    else if (it.type === 'switch') panel.appendChild(toggle(it));
    else if (it.type === 'group') panel.appendChild(group(it));
    else panel.appendChild(item(it));
  }
  panel.style.top = (m.top || 0) + 'px';
  panel.style.maxHeight = 'calc(100vh - ' + ((m.top || 0) + 10) + 'px)';
  panel.style.display = 'none';
  void panel.offsetWidth; // заново запускаем появление
  panel.style.display = 'block';
  panel.scrollTop = 0;
  shownAt = Date.now();
  panel.focus();
}

document.addEventListener('mousedown', (e) => {
  if (!panel.contains(e.target)) {
    e.preventDefault();
    api.close();
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    api.close();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const all = [...panel.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
  if (!all.length) return;
  const i = all.indexOf(document.activeElement);
  const n = e.key === 'ArrowDown' ? (i + 1) % all.length : (i <= 0 ? all.length - 1 : i - 1);
  all[n].focus();
});
window.addEventListener('blur', () => {
  if (Date.now() - shownAt > 300) api.close(); // ушли в другое окно — закрываем, как обычное меню
});

api.on(show);
