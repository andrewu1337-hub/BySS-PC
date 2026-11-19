'use strict';
const B = window.byss;
const I = window.ICONS;
let S = null;
let page = location.hash.slice(1) || 'look';

const ENGINES = [['google', 'Google'], ['yandex', 'Яндекс'], ['ddg', 'DuckDuckGo'], ['bing', 'Bing']];
const PAGES = [['look', 'Внешний вид'], ['home', 'Главная и поиск'], ['privacy', 'Конфиденциальность'], ['modes', 'Режимы BySS'], ['about', 'О браузере']];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function set(key, value) {
  S[key] = value;
  return B.invoke('set', key, value);
}
function row(title, sub, control) {
  const r = el('div', 'row');
  const l = el('div', 'l');
  l.appendChild(el('div', 't', title));
  if (sub) l.appendChild(el('div', 's', sub));
  r.appendChild(l);
  if (control) {
    const c = el('div', 'c');
    c.appendChild(control);
    r.appendChild(c);
  }
  return r;
}
function toggle(on, fn) {
  const b = el('button', 'sw' + (on ? ' on' : ''));
  b.onclick = () => {
    b.classList.toggle('on');
    fn(b.classList.contains('on'));
  };
  return b;
}
function seg(options, value, fn) {
  const s = el('div', 'seg');
  for (const [v, label] of options) {
    const b = el('button', v === value ? 'on' : '', label);
    b.onclick = () => {
      [...s.children].forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      fn(v);
    };
    s.appendChild(b);
  }
  return s;
}
function select(options, value, fn) {
  const s = el('select', 'field');
  for (const [v, label] of options) {
    const o = el('option', '', label);
    o.value = v;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => fn(s.value);
  return s;
}

function render() {
  document.body.classList.toggle('light', S.theme === 'light');
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  const brand = el('div', 'brand');
  nav.appendChild(brand);
  renderBrand(brand, S.name || 'BySS', 26);
  for (const [id, label] of PAGES) {
    const b = el('button', id === page ? 'on' : '', label);
    b.onclick = () => {
      page = id;
      location.hash = id;
      render();
    };
    nav.appendChild(b);
  }
  const box = document.getElementById('pages');
  box.innerHTML = '';
  ({ look, home, privacy, modes, about })[page](box);
}

// ---------------------------------------------------------------- внешний вид
function look(box) {
  box.appendChild(el('h2', '', 'Внешний вид'));
  const g = el('div', 'group');
  const name = el('input', 'field');
  name.value = S.name || 'BySS';
  name.maxLength = 20;
  name.style.width = '200px';
  name.onchange = () => set('name', name.value.trim() || 'BySS').then(render);
  g.appendChild(row('Название браузера', 'Показывается на главной и в заголовке окна', name));
  g.appendChild(row('Надпись на главной', 'Название справа вверху, в стиле GTA', toggle(S.showBrand !== false, (v) => set('showBrand', v))));
  g.appendChild(row('Тема', null, seg([['dark', 'Тёмная'], ['light', 'Светлая']], S.theme, (v) => set('theme', v).then(render))));
  box.appendChild(g);

  const g2 = el('div', 'group');
  g2.appendChild(row('Фон главной', 'Или поставьте свою картинку', null));
  const walls = el('div', 'walls');
  for (const [id, label] of [['lines', 'Линии'], ['waves', 'Волны'], ['dots', 'Точки'], ['black', 'Просто чёрный'], ['custom', 'Своя картинка…']]) {
    const w = el('div', 'wall ' + id + (S.wallpaper === id ? ' on' : ''), label);
    if (id === 'custom' && S.wallpaper === 'custom') w.style.backgroundImage = 'url("byss://data/wallpaper?' + (S.wallpaperStamp || 0) + '")';
    w.onclick = async () => {
      if (id === 'custom') {
        const ok = await B.invoke('pick-wallpaper');
        if (!ok) return;
        S.wallpaper = 'custom';
        S.wallpaperStamp = Date.now();
      } else {
        await set('wallpaper', id);
      }
      render();
    };
    walls.appendChild(w);
  }
  g2.appendChild(walls);
  box.appendChild(g2);
}

// ---------------------------------------------------------------- главная и поиск
function home(box) {
  box.appendChild(el('h2', '', 'Главная и поиск'));
  const g = el('div', 'group');
  g.appendChild(row('Поиск из адресной строки', null, select(ENGINES, S.engine, (v) => set('engine', v))));
  const eng = (S.engines || ['google', 'yandex', 'currency']).slice();
  const THIRD = [['currency', 'Конвертер валют']].concat(ENGINES);
  ['Первая строка поиска', 'Вторая строка поиска', 'Третья строка'].forEach((label, i) => {
    const sub = i === 2 ? 'На главной: конвертер валют или ещё один поиск' : 'На главной странице';
    g.appendChild(row(label, sub, select(i === 2 ? THIRD : ENGINES, eng[i], (v) => {
      eng[i] = v;
      set('engines', eng.slice());
    })));
  });
  box.appendChild(g);

  const g2 = el('div', 'group');
  const cities = (S.cities || []).slice();
  [0, 1].forEach((i) => {
    const wrap = el('div');
    wrap.style.position = 'relative';
    const inp = el('input', 'field');
    inp.placeholder = 'Город';
    inp.value = cities[i] ? cities[i].name : '';
    inp.style.width = '240px';
    let timer = null;
    let sugg = null;
    inp.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = inp.value.trim();
        if (sugg) sugg.remove();
        if (q.length < 2) return;
        try {
          const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=ru&format=json&name=' + encodeURIComponent(q));
          const j = await r.json();
          sugg = el('div', 'sugg');
          for (const c of j.results || []) {
            const d = el('div', '', c.name);
            const sm = el('small', '', [c.admin1, c.country].filter(Boolean).join(', '));
            d.appendChild(sm);
            d.onclick = () => {
              cities[i] = { name: c.name, lat: c.latitude, lon: c.longitude };
              set('cities', cities.slice());
              inp.value = c.name;
              sugg.remove();
            };
            sugg.appendChild(d);
          }
          if (!(j.results || []).length) sugg.appendChild(el('div', '', 'Не нашли такой город'));
          wrap.appendChild(sugg);
        } catch (e) {
          // нет сети
        }
      }, 300);
    };
    inp.onblur = () => setTimeout(() => sugg && sugg.remove(), 200);
    wrap.appendChild(inp);
    const rm = el('button', 'btn', 'Убрать');
    rm.onclick = () => {
      cities[i] = null;
      set('cities', cities.filter(Boolean));
      render();
    };
    const c = el('div');
    c.style.display = 'flex';
    c.style.gap = '8px';
    c.append(wrap, rm);
    g2.appendChild(row(i === 0 ? 'Погода: первый город' : 'Погода: второй город', 'Обновляется раз в 10 минут', c));
  });
  box.appendChild(g2);

  const g3 = el('div', 'group');
  g3.appendChild(row('Открывать прошлые вкладки при запуске', 'Вкладки режимов BySS не сохраняются никогда',
    toggle(S.restoreTabs !== false, (v) => set('restoreTabs', v))));
  box.appendChild(g3);
}

// ---------------------------------------------------------------- конфиденциальность
function privacy(box) {
  box.appendChild(el('h2', '', 'Конфиденциальность'));
  const g = el('div', 'group');
  g.appendChild(row('Блокировать рекламу и трекеры', 'Правил в списках: ' + (S.filters || 0).toLocaleString('ru-RU')
    + ' · EasyList, EasyPrivacy, RU AdList, Peter Lowe', toggle(S.adblock !== false, (v) => set('adblock', v))));
  const upd = el('button', 'btn', 'Обновить списки');
  upd.onclick = async () => {
    upd.textContent = 'Обновляю…';
    const n = await B.invoke('reload-filters');
    S.filters = n;
    upd.textContent = 'Готово';
    setTimeout(render, 800);
  };
  g.appendChild(row('Списки блокировки', 'Обновляются сами раз в 4 дня', upd));
  box.appendChild(g);

  const g2 = el('div', 'group');
  g2.appendChild(row('Сайты, где трекеры разрешены', 'Включается кнопкой-щитом в адресной строке', null));
  const list = el('div', 'list');
  const allow = Object.keys(S.allowSites || {});
  if (!allow.length) list.appendChild(el('div', 'empty', 'Пока нет — везде всё блокируется'));
  for (const site of allow) {
    const it = el('div', 'item');
    it.appendChild(el('div', 'n', site));
    const x = el('button', 'x');
    x.innerHTML = I.close;
    x.title = 'Снова блокировать';
    x.onclick = () => {
      const a = Object.assign({}, S.allowSites);
      delete a[site];
      set('allowSites', a).then(render);
    };
    it.appendChild(x);
    list.appendChild(it);
  }
  g2.appendChild(list);
  box.appendChild(g2);

  const g3 = el('div', 'group');
  g3.appendChild(row('Перевод сайтов', 'Где вы ответили «Нет» — больше не предлагаем; «Перевести» — переводим сами', null));
  const tl = el('div', 'list');
  const tr = Object.entries(S.translate || {});
  if (!tr.length) tl.appendChild(el('div', 'empty', 'Пока ничего не выбирали'));
  for (const [site, v] of tr) {
    const it = el('div', 'item');
    it.appendChild(el('div', 'n', site + (v === 'yes' ? ' — переводить всегда' : ' — не предлагать')));
    const x = el('button', 'x');
    x.innerHTML = I.close;
    x.title = 'Забыть выбор';
    x.onclick = () => {
      const a = Object.assign({}, S.translate);
      delete a[site];
      set('translate', a).then(render);
    };
    it.appendChild(x);
    tl.appendChild(it);
  }
  g3.appendChild(tl);
  box.appendChild(g3);

  const g4 = el('div', 'group');
  const del = el('button', 'btn danger', 'Удалить все данные');
  del.onclick = () => B.invoke('clear-data');
  g4.appendChild(row('Удалить все данные', 'Входы на сайтах, куки, кэш и выбор по сайтам. Спросим ещё раз перед удалением.', del));
  box.appendChild(g4);
}

// ---------------------------------------------------------------- режимы BySS
function modes(box) {
  box.appendChild(el('h2', '', 'Режимы BySS'));
  const g = el('div', 'group');
  g.appendChild(row('Что это', 'Вкладки без следов: входы, история и данные живут только в памяти. Можно держать несколько режимов сразу. '
    + 'Режим удаляется вручную — после удаления от него ничего не остаётся.', null));
  const list = el('div', 'list');
  const ms = S.modes || [];
  if (!ms.length) list.appendChild(el('div', 'empty', 'Режимов пока нет'));
  for (const m of ms) {
    const it = el('div', 'item');
    const ic = el('span');
    ic.innerHTML = I.shield;
    ic.style.cssText = 'width:20px;height:20px;color:#D9CCFF;display:inline-block';
    it.appendChild(ic);
    const inp = el('input', 'field');
    inp.value = m.name;
    inp.maxLength = 30;
    inp.onchange = () => B.invoke('mode-rename', m.id, inp.value.trim());
    it.appendChild(inp);
    const open = el('button', 'btn', 'Открыть вкладку');
    open.onclick = () => B.invoke('mode-open', m.id);
    const del = el('button', 'btn danger', 'Удалить');
    del.onclick = async () => {
      await B.invoke('mode-delete', m.id);
    };
    it.append(open, del);
    list.appendChild(it);
  }
  g.appendChild(list);
  const add = el('button', 'btn p', 'Новый режим BySS');
  add.onclick = async () => {
    const id = await B.invoke('mode-new');
    B.invoke('mode-open', id);
  };
  g.appendChild(row('Новый режим', 'Сочетание клавиш: Ctrl+Shift+N', add));
  box.appendChild(g);
}

// ---------------------------------------------------------------- о браузере
function about(box) {
  box.appendChild(el('h2', '', 'О браузере'));
  const g = el('div', 'group');
  const upd = el('button', 'btn p', 'Обновить браузер');
  upd.onclick = () => B.invoke('update');
  g.appendChild(row((S.name || 'BySS') + ' ' + (S.version || ''), 'Без рекламы, без слежки, без лишнего. Обновления — с GitHub.', upd));
  g.appendChild(row('Сочетания клавиш', 'Ctrl+T — новая вкладка · Ctrl+W — закрыть · Ctrl+Shift+T — вернуть закрытую · '
    + 'Ctrl+L — адресная строка · Ctrl+F — поиск по странице · Ctrl+D — на главную · Ctrl+Shift+N — вкладка BySS · F11 — во весь экран', null));
  box.appendChild(g);
}

B.on('settings', (s) => {
  S = s;
  render();
});
B.invoke('settings').then((s) => {
  S = s;
  render();
});
