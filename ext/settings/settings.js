'use strict';
const B = window.byss;
const I = window.ICONS;
let S = null;
let page = location.hash.slice(1) || 'look';

const ENGINES = [['google', 'Google'], ['yandex', 'Яндекс'], ['ddg', 'DuckDuckGo'], ['bing', 'Bing']];
const PAGES = [['look', 'Внешний вид'], ['home', 'Главная и поиск'], ['privacy', 'Конфиденциальность'], ['about', 'О браузере']];

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
  ({ look, home, privacy, about })[page] ? ({ look, home, privacy, about })[page](box) : look(box);
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
  g.appendChild(row('Название браузера', 'Показывается на главной', name));
  g.appendChild(row('Надпись на главной', 'Название справа вверху, в стиле GTA', toggle(S.showBrand !== false, (v) => set('showBrand', v))));
  g.appendChild(row('Тема', 'Окно браузера и страницы BySS', seg([['dark', 'Тёмная'], ['light', 'Светлая']], S.theme, (v) => set('theme', v).then(render))));
  box.appendChild(g);

  const g2 = el('div', 'group');
  g2.appendChild(row('Фон главной', 'Или поставьте свою картинку', null));
  const walls = el('div', 'walls');
  for (const [id, label] of [['lines', 'Линии'], ['waves', 'Волны'], ['dots', 'Точки'], ['night', 'Ночь'], ['aurora', 'Сияние'],
    ['graphite', 'Графит'], ['black', 'Просто чёрный'], ['custom', 'Своя картинка…']]) {
    const w = el('div', 'wall ' + id + (S.wallpaper === id ? ' on' : ''), label);
    if (id === 'custom' && S.wallpaperUrl) w.style.backgroundImage = 'url("' + S.wallpaperUrl + '")';
    w.onclick = async () => {
      if (id === 'custom') {
        const data = await pickWallpaper();
        if (!data) return;
        await B.invoke('set', 'wallpaperData', data);
        await set('wallpaper', 'custom');
        S.wallpaperUrl = data;
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
  g.appendChild(row('Поиск из адресной строки', 'Выбирается в настройках Firefox: меню ☰ → Настройки → Поиск', null));
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
  g3.appendChild(row('Открывать прошлые вкладки при запуске', 'Меню ☰ → Настройки → Основные → «Открывать предыдущие окна и вкладки»', null));
  box.appendChild(g3);
}

// ---------------------------------------------------------------- конфиденциальность
function privacy(box) {
  box.appendChild(el('h2', '', 'Конфиденциальность'));
  const g = el('div', 'group');
  g.appendChild(row('История не сохраняется', 'BySS не запоминает посещённые сайты, поиски и то, что вводили в формы. '
    + 'Входы на сайтах и куки сохраняются — выходить из Google после закрытия не придётся.', null));
  g.appendChild(row('Реклама и трекеры', 'Блокирует uBlock Origin — его кнопка на панели справа. '
    + 'Нажмите её на сайте, чтобы выключить блокировку только там. Списки: EasyList, EasyPrivacy, RU AdList, Peter Lowe и другие.', null));
  g.appendChild(row('Реклама на YouTube', 'Кроме uBlock Origin работает своя защита BySS: вырезает рекламу из роликов и ленты, '
    + 'проматывает рекламу, если она всё же началась.', null));
  box.appendChild(g);

  const g2 = el('div', 'group');
  const priv = el('button', 'btn', 'Открыть');
  priv.onclick = () => browser.windows.create({ incognito: true }).catch(() => alertBox('Не получилось открыть приватное окно', 'Нажмите Ctrl+Shift+P.'));
  g2.appendChild(row('Вкладки без следов', 'Приватное окно: входы и данные живут только до его закрытия · Ctrl+Shift+P', priv));
  box.appendChild(g2);

  const g4 = el('div', 'group');
  const del = el('button', 'btn danger', 'Удалить все данные');
  del.onclick = () => confirmBox('Удалить все данные?', 'Выйдете из всех сайтов, удалятся куки, кэш и данные сайтов. Настройки BySS и плитки на главной останутся.',
    'Удалить', async () => {
      await browser.browsingData.remove({}, {
        cache: true, cookies: true, downloads: true, formData: true, history: true,
        indexedDB: true, localStorage: true, serviceWorkers: true, pluginData: true
      });
      alertBox('Готово', 'Данные сайтов удалены.');
    });
  g4.appendChild(row('Удалить все данные', 'Входы на сайтах, куки, кэш. Спросим ещё раз перед удалением.', del));
  box.appendChild(g4);
}

function confirmBox(title, text, okLabel, onOk) {
  const back = el('div', 'modal-back');
  const m = el('div', 'modal');
  m.appendChild(el('h3', '', title));
  m.appendChild(el('div', 's', text));
  const btns = el('div', 'btns');
  const no = el('button', 'btn', 'Отмена');
  const ok = el('button', 'btn p', okLabel);
  no.onclick = () => back.remove();
  ok.onclick = () => {
    back.remove();
    onOk();
  };
  btns.append(no, ok);
  m.appendChild(btns);
  back.appendChild(m);
  back.onclick = (e) => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
}

function alertBox(title, text) {
  confirmBox(title, text, 'Хорошо', () => {});
  const btns = document.querySelector('.modal-back:last-child .btns');
  if (btns && btns.firstChild) btns.firstChild.remove();
}

/** Своя картинка для фона: уменьшаем до 2560 точек, чтобы главная открывалась быстро. */
function pickWallpaper() {
  return new Promise((resolve) => {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/webp';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return resolve(null);
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * k);
        cv.height = Math.round(img.naturalHeight * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    };
    inp.click();
  });
}

// ---------------------------------------------------------------- о браузере
function about(box) {
  box.appendChild(el('h2', '', 'О браузере'));
  const g = el('div', 'group');
  const upd = el('button', 'btn p', 'Проверить обновления');
  const status = el('div', 's', 'BySS обновляется сам. Движок — Firefox ESR от Mozilla, он тоже обновляется сам.');
  upd.onclick = async () => {
    upd.disabled = true;
    upd.textContent = 'Проверяю…';
    const r = await byssCheckUpdate();
    upd.disabled = false;
    upd.textContent = 'Проверить обновления';
    status.textContent = r.text;
    if (r.setupUrl) {
      const get = el('button', 'btn p', 'Скачать установщик');
      get.onclick = async () => {
        get.disabled = true;
        get.textContent = 'Скачиваю…';
        const id = await byssDownloadSetup(r.setupUrl);
        get.disabled = false;
        if (id == null) {
          get.textContent = 'Скачать установщик';
          return;
        }
        get.textContent = 'Запустить установщик';
        get.onclick = () => browser.downloads.open(id).catch(() => browser.downloads.show(id));
      };
      upd.replaceWith(get);
    }
  };
  const r1 = row((S.name || 'BySS') + ' ' + (S.version || ''), null, upd);
  r1.querySelector('.l').appendChild(status);
  g.appendChild(r1);
  g.appendChild(row('Сочетания клавиш', 'Ctrl+T — новая вкладка · Ctrl+W — закрыть · Ctrl+Shift+T — вернуть закрытую · '
    + 'Ctrl+L — адресная строка · Ctrl+F — поиск по странице · Ctrl+Shift+S — скриншот · Ctrl+J — загрузки · '
    + 'Ctrl+Shift+P — приватное окно · Alt+Shift+S — автоскролл · F11 — во весь экран', null));
  g.appendChild(row('Настройки Firefox', 'Пароли, загрузки, масштаб, язык — меню ☰ → Настройки', null));
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
