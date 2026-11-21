'use strict';
// Кнопка BySS на панели: автоскролл для открытой вкладки, приватное окно, главная, настройки, обновления.
const B = window.byss;
const I = window.ICONS;
let S = null;
let tab = null;
let asOn = false;

const INTERVALS = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60];
const STEPS = [10, 25, 50, 75, 90, 100];
const TICKS = [1, 2, 3, 5, 10];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function ticksWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return n + ' щелчок';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' щелчка';
  return n + ' щелчков';
}
function asCfg() {
  return Object.assign({}, window.BYSS_DEFAULTS.autoscroll, S.autoscroll || {});
}
function setAs(patch) {
  const a = Object.assign(asCfg(), patch);
  S.autoscroll = a;
  B.invoke('set', 'autoscroll', a);
  renderAs();
}

function stepper(label, list, cur, key, fmt) {
  const r = el('div', 'stepper');
  r.appendChild(el('div', 'l', label));
  const i = list.indexOf(cur);
  const dn = el('button', '', '−');
  const v = el('div', 'v', fmt(cur));
  const up = el('button', '', '+');
  dn.disabled = i <= 0;
  up.disabled = i < 0 || i >= list.length - 1;
  dn.onclick = () => setAs({ [key]: list[Math.max(0, i - 1)] });
  up.onclick = () => setAs({ [key]: list[Math.min(list.length - 1, i + 1)] });
  r.append(dn, v, up);
  return r;
}

function renderAs() {
  const box = document.getElementById('as');
  box.innerHTML = '';
  const a = asCfg();
  const site = tab && /^https?:/.test(tab.url || '');
  const head = el('div', 'ashead');
  const ic = el('span', 'ic');
  ic.innerHTML = I.play;
  ic.style.cssText = 'width:20px;height:20px;display:inline-block';
  head.appendChild(ic);
  head.appendChild(el('div', 'n', 'Автоскролл'));
  if (asOn) head.appendChild(el('div', 'badge', 'идёт'));
  const go = el('button', 'go' + (asOn ? ' stop' : ''), asOn ? 'Стоп' : 'Запустить');
  go.disabled = !site;
  go.onclick = async () => {
    const r = await browser.runtime.sendMessage({ t: 'as-set', tabId: tab.id, on: !asOn });
    if (r && r.ok) {
      asOn = r.on;
      if (asOn) window.close();
      else renderAs();
    } else if (r && r.why) {
      box.appendChild(el('div', 'hint', r.why));
    }
  };
  head.appendChild(go);
  box.appendChild(head);
  const seg = el('div', 'seg');
  for (const [m, label] of [['smooth', 'Плавно'], ['step', 'Шагами'], ['wheel', 'Колесом']]) {
    const b = el('button', a.mode === m ? 'on' : '', label);
    b.onclick = () => setAs({ mode: m });
    seg.appendChild(b);
  }
  box.appendChild(seg);
  if (a.mode === 'smooth') {
    box.appendChild(stepper('Скорость', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], a.level, 'level', (v) => v + ' из 10'));
  } else if (a.mode === 'step') {
    box.appendChild(stepper('Интервал', INTERVALS, a.interval, 'interval', (v) => v + ' с'));
    box.appendChild(stepper('Шаг', STEPS, a.step, 'step', (v) => v + '% экрана'));
  } else {
    box.appendChild(stepper('Интервал', INTERVALS, a.interval, 'interval', (v) => v + ' с'));
    box.appendChild(stepper('Колесо', TICKS, a.ticks || 1, 'ticks', ticksWord));
  }
  box.appendChild(el('div', 'hint', site ? 'Колесо мыши — пауза · Alt+Shift+S — запустить или остановить'
    : 'Откройте сайт — и автоскролл можно будет запустить'));
}

document.querySelectorAll('[data-i]').forEach((e) => { e.innerHTML = I[e.dataset.i] || ''; });

document.getElementById('private').onclick = () => {
  browser.windows.create({ incognito: true }).catch(() => {});
  window.close();
};
document.getElementById('home').onclick = async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('home/index.html') });
  window.close();
};
document.getElementById('settings').onclick = () => {
  browser.runtime.openOptionsPage();
  window.close();
};
document.getElementById('update').onclick = async () => {
  const msg = document.getElementById('updmsg');
  msg.hidden = false;
  msg.textContent = 'Проверяю…';
  const r = await byssCheckUpdate();
  msg.textContent = r.text;
  if (r.setupUrl) {
    const b = el('button', 'btn', 'Скачать установщик');
    b.style.marginTop = '8px';
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Скачиваю…';
      const id = await byssDownloadSetup(r.setupUrl);
      b.disabled = false;
      if (id == null) {
        b.textContent = 'Скачать установщик';
        return;
      }
      b.textContent = 'Запустить установщик';
      b.onclick = () => browser.downloads.open(id).catch(() => browser.downloads.show(id));
    };
    msg.appendChild(el('br'));
    msg.appendChild(b);
  }
};
document.getElementById('clear').onclick = () => { document.getElementById('clearask').hidden = false; };
document.getElementById('clearno').onclick = () => { document.getElementById('clearask').hidden = true; };
document.getElementById('clearyes').onclick = async () => {
  await browser.browsingData.remove({}, {
    cache: true, cookies: true, downloads: true, formData: true, history: true,
    indexedDB: true, localStorage: true, serviceWorkers: true, pluginData: true
  });
  const ask = document.getElementById('clearask');
  ask.textContent = 'Готово — данные сайтов удалены.';
};

(async () => {
  S = await B.invoke('settings');
  document.body.classList.toggle('light', S.theme === 'light');
  renderBrand(document.getElementById('brand'), S.name || 'BySS', 22);
  document.getElementById('ver').textContent = S.version;
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    const r = await browser.runtime.sendMessage({ t: 'as-state', tabId: tab.id }).catch(() => null);
    asOn = !!(r && r.on);
  }
  renderAs();
})();
