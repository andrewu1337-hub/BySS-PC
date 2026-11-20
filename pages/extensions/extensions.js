'use strict';
// Расширения: список установленных, вкл/выкл, настройки, удаление; uBlock Origin с GitHub.
const B = window.byss;
const I = window.ICONS;
let data = null;
let busy = false;
let note = null; // { text, err, restart }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function icon(src) {
  const ic = el('div', 'ic');
  if (src) {
    ic.classList.add('has');
    const im = el('img');
    im.src = src;
    im.alt = '';
    ic.appendChild(im);
  } else {
    ic.innerHTML = I.puzzle || '';
  }
  return ic;
}

function showMsg() {
  const m = document.getElementById('msg');
  let n = note;
  if (!n && data && data.busy) n = { text: data.busy };
  if (!n && data && data.state === 'loading') n = { text: 'Расширения запускаются…' };
  if (!n && data && data.state === 'error') n = { text: data.failure || 'Расширения не запустились.', err: true };
  if (!n && data && data.ubo && data.ubo.pending) {
    n = { text: 'Скачана новая версия uBlock Origin ' + data.ubo.pending + ' — поставится при следующем запуске браузера.', restart: true };
  }
  m.hidden = !n;
  if (!n) return;
  m.className = n.err ? 'err' : '';
  m.textContent = n.text;
  if (n.restart) {
    const b = el('button', 'btn', 'Перезапустить сейчас');
    b.onclick = () => B.invoke('ext-restart');
    m.appendChild(b);
  }
}

function row(x) {
  const r = el('div', 'row');
  const info = el('div', 'info');
  const nm = el('div', 'nm', x.name || 'Без названия');
  if (x.version) nm.appendChild(el('span', 'ver', x.version));
  info.appendChild(nm);
  if (x.desc) info.appendChild(el('div', 'sub', x.desc));
  if (x.dnr) info.appendChild(el('div', 'warn', 'Похоже на блокировщик рекламы на правилах Chrome — здесь он не блокирует.'));
  const acts = el('div', 'acts');
  if (x.options) {
    const o = el('button', 'btn', 'Настройки');
    o.onclick = () => B.invoke('ext-options', x.id);
    acts.appendChild(o);
  }
  const del = el('button', 'btn danger', 'Удалить');
  let armed = 0;
  del.onclick = async () => {
    if (!armed) {
      del.textContent = 'Точно удалить?';
      armed = setTimeout(() => { armed = 0; del.textContent = 'Удалить'; }, 3500);
      return;
    }
    clearTimeout(armed);
    del.disabled = true;
    try {
      await B.invoke('ext-remove', x.id);
    } catch (e) {
      note = { text: 'Не удалось удалить: ' + (e && e.message ? e.message : e), err: true };
    }
    refresh();
  };
  acts.appendChild(del);
  const sw = el('button', 'sw' + (x.on ? ' on' : ''));
  sw.title = x.on ? 'Выключить' : 'Включить';
  sw.disabled = !data || data.state !== 'ready';
  sw.onclick = async () => {
    sw.disabled = true;
    try {
      const ok = await B.invoke('ext-set', x.id, !x.on);
      note = ok === false ? { text: 'Не получилось включить «' + x.name + '».', err: true } : null;
    } catch (e) {
      note = { text: String(e && e.message ? e.message : e), err: true };
    }
    refresh();
  };
  acts.appendChild(sw);
  r.append(icon(x.icon), info, acts);
  return r;
}

function render() {
  showMsg();
  const ubo = document.getElementById('ubo');
  const get = document.getElementById('uboGet');
  const ready = data && data.state === 'ready';
  ubo.hidden = !data || (data.ubo && data.ubo.installed);
  get.disabled = !ready || busy || !!(data && data.busy);
  get.textContent = busy || (data && data.busy) ? 'Скачиваю…' : 'Установить';
  const ic = document.getElementById('uboIc');
  if (!ic.innerHTML) ic.innerHTML = I.shield || '';

  const box = document.getElementById('list');
  box.innerHTML = '';
  const list = (data && data.list) || [];
  if (!list.length) {
    const e = el('div', 'empty');
    e.innerHTML = I.puzzle || '';
    e.appendChild(document.createTextNode('Пока ничего не установлено'));
    box.appendChild(e);
    return;
  }
  const g = el('div', 'group');
  for (const x of list) g.appendChild(row(x));
  box.appendChild(g);
}

async function refresh() {
  try {
    data = await B.invoke('ext-list');
  } catch (e) {
    data = { state: 'error', failure: String(e && e.message ? e.message : e), list: [] };
  }
  render();
}

function apply(s) {
  document.body.classList.toggle('light', s.theme === 'light');
}

document.getElementById('store').onclick = () => B.invoke('ext-store');
document.getElementById('uboGet').onclick = async () => {
  busy = true;
  note = null;
  render();
  let r = null;
  try {
    r = await B.invoke('ext-ubo');
  } catch (e) {
    r = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  busy = false;
  note = r && r.ok ? { text: 'uBlock Origin установлен. Обновите открытые страницы, чтобы он заработал на них.' }
    : { text: 'Не получилось установить uBlock Origin: ' + ((r && r.error) || 'ошибка'), err: true };
  refresh();
};
B.on('ext', (d) => { data = d; render(); });
B.on('settings', apply);
B.invoke('settings').then(apply);
refresh();
