'use strict';
// Конвертер валют на главной — третья строка вместо третьего поиска (как на телефоне).
// Курсы: открытый бесплатный API ExchangeRate-API (без ключа, раз в сутки), источник указан в окне.
// Одна таблица «от евро» — любые пары считаем через неё.

const FX_API = 'https://open.er-api.com/v6/latest/EUR';
const FX_SOURCE = 'https://www.exchangerate-api.com';
const FX_FRESH = 6 * 3600 * 1000;
const FX_DEFAULT = ['MDL', 'USD', 'RON', 'UAH', 'CZK', 'GBP'];
const FX_POPULAR = ['EUR', 'USD', 'MDL', 'RON', 'UAH', 'RUB', 'GBP', 'CZK', 'PLN', 'CHF', 'TRY', 'BGN', 'HUF', 'BYN', 'KZT',
  'GEL', 'AMD', 'AZN', 'SEK', 'NOK', 'DKK', 'RSD', 'ILS', 'AED', 'CNY', 'JPY', 'CAD', 'AUD'];
let fxRates = null;
let fxLoading = null;

function fxCfg() {
  const c = (S && S.currency) || {};
  return {
    base: typeof c.base === 'string' && c.base.length === 3 ? c.base : 'EUR',
    list: Array.isArray(c.list) ? c.list.filter((x) => typeof x === 'string' && x.length === 3) : FX_DEFAULT.slice(),
    amount: typeof c.amount === 'number' && isFinite(c.amount) ? c.amount : 1
  };
}

function fxLoad(force) {
  if (!fxRates) {
    try { fxRates = JSON.parse(localStorage.getItem('fx') || 'null'); } catch (e) { fxRates = null; }
  }
  if (!force && fxRates && Date.now() - fxRates.at < FX_FRESH) return Promise.resolve(fxRates);
  if (fxLoading) return fxLoading;
  fxLoading = (async () => {
    try {
      const r = await fetch(FX_API);
      const j = await r.json();
      if (j && j.result === 'success' && j.rates) {
        fxRates = { at: Date.now(), updated: (j.time_last_update_unix || 0) * 1000, rates: j.rates };
        localStorage.setItem('fx', JSON.stringify(fxRates));
      }
    } catch (e) {
      // нет связи — остаются прошлые курсы
    }
    fxLoading = null;
    return fxRates;
  })();
  return fxLoading;
}

function fxConv(a, from, to) {
  const r = fxRates && fxRates.rates;
  if (!r || !r[from] || !r[to]) return NaN;
  return a / r[from] * r[to];
}

let fxNamesRu = null;
function fxName(code) {
  try {
    if (!fxNamesRu) fxNamesRu = new Intl.DisplayNames(['ru'], { type: 'currency' });
    const n = fxNamesRu.of(code);
    return n && n !== code ? n.charAt(0).toUpperCase() + n.slice(1) : code;
  } catch (e) {
    return code;
  }
}

function fxSym(code) {
  const m = { EUR: '€', USD: '$', GBP: '£', RUB: '₽', UAH: '₴', JPY: '¥', CNY: '¥', TRY: '₺', PLN: 'zł', CZK: 'Kč',
    MDL: 'L', RON: 'L', KZT: '₸', GEL: '₾', ILS: '₪', INR: '₹', CHF: '₣' };
  return m[code] || code.charAt(0);
}

function fxFmt(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

function fxSummary() {
  if (!fxRates) return '';
  const c = fxCfg();
  const parts = c.list.filter((x) => x !== c.base).slice(0, 2).map((x) => fxFmt(fxConv(1, c.base, x)) + ' ' + x);
  return parts.length ? '1 ' + c.base + ' = ' + parts.join('  ·  ') : '';
}

function fxRow() {
  const c = fxCfg();
  const row = document.createElement('div');
  row.className = 'srow fx';
  row.title = 'Конвертер валют';
  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = fxSym(c.base);
  const sum = document.createElement('div');
  sum.className = 'fxsum';
  sum.textContent = fxSummary() || 'Конвертер валют';
  const tag = document.createElement('div');
  tag.className = 'fxtag';
  tag.textContent = 'Конвертер валют';
  row.append(badge, sum, tag);
  row.onclick = () => openFx();
  fxLoad(false).then(() => {
    const t = fxSummary();
    if (t) sum.textContent = t;
  });
  return row;
}

function fxParse(s) {
  const v = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(v) ? v : 0;
}

function fxAmountText(v) {
  return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace('.', ',');
}

function openFx() {
  const cfg = fxCfg();
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal fxm';
  back.appendChild(m);
  document.body.appendChild(back);

  const close = () => {
    cfg.amount = fxParse(amount.value);
    S.currency = cfg;
    back.remove();
    B.invoke('set', 'currency', cfg); // сохраняем один раз — при закрытии
  };

  m.innerHTML = '<h3>Конвертер валют</h3>'
    + '<div class="fxtop"><input class="fxamt" inputmode="decimal" spellcheck="false"><button class="fxbase"></button></div>'
    + '<div class="fxbname"></div><div class="fxlist"></div>'
    + '<button class="fxadd">+  Добавить валюту</button>'
    + '<div class="fxfoot"><span class="fxsrc"></span><button class="btn p fxok">Готово</button></div>';
  const amount = m.querySelector('.fxamt');
  const baseBtn = m.querySelector('.fxbase');
  const baseName = m.querySelector('.fxbname');
  const list = m.querySelector('.fxlist');
  const src = m.querySelector('.fxsrc');
  amount.value = fxAmountText(cfg.amount);

  const render = () => {
    baseBtn.textContent = fxSym(cfg.base) + '  ' + cfg.base + '  ▾';
    baseName.textContent = fxName(cfg.base);
    list.innerHTML = '';
    if (!fxRates) {
      const w = document.createElement('div');
      w.className = 'fxwait';
      w.textContent = 'Загружаю курсы…';
      list.appendChild(w);
    }
    const a = fxParse(amount.value);
    for (const code of cfg.list) {
      if (code === cfg.base) continue;
      const r = document.createElement('div');
      r.className = 'fxr';
      r.title = 'Сделать основной';
      r.innerHTML = '<div class="fxc"></div><div class="fxn"><b></b><small></small></div><div class="fxv"></div><button class="fxx" title="Убрать из списка"></button>';
      r.querySelector('.fxc').textContent = fxSym(code);
      r.querySelector('b').textContent = code;
      r.querySelector('small').textContent = fxName(code);
      r.querySelector('.fxv').textContent = fxFmt(fxConv(a, cfg.base, code));
      r.querySelector('.fxv').dataset.code = code;
      const x = r.querySelector('.fxx');
      x.innerHTML = I.close;
      x.onclick = (e) => {
        e.stopPropagation();
        cfg.list = cfg.list.filter((c) => c !== code);
        render();
      };
      r.onclick = () => {
        // нажали на валюту — она становится основной, сумма пересчитывается
        const v = fxConv(fxParse(amount.value), cfg.base, code);
        const i = cfg.list.indexOf(code);
        if (i >= 0) cfg.list[i] = cfg.base;
        cfg.base = code;
        if (isFinite(v)) amount.value = fxAmountText(Math.round(v * 100) / 100);
        render();
      };
      list.appendChild(r);
    }
    const when = fxRates && fxRates.updated ? new Date(fxRates.updated).toLocaleString('ru-RU',
      { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
    src.textContent = 'Курсы: ExchangeRate-API' + (when ? ' · обновлены ' + when : '');
  };
  const update = () => {
    const a = fxParse(amount.value);
    list.querySelectorAll('.fxv').forEach((v) => { v.textContent = fxFmt(fxConv(a, cfg.base, v.dataset.code)); });
  };
  amount.addEventListener('input', update);
  baseBtn.onclick = () => fxPick(m, 'Основная валюта', (code) => {
    if (code === cfg.base) return;
    const i = cfg.list.indexOf(code);
    if (i >= 0) cfg.list[i] = cfg.base;
    else if (!cfg.list.includes(cfg.base)) cfg.list.unshift(cfg.base);
    cfg.base = code;
    render();
  });
  m.querySelector('.fxadd').onclick = () => fxPick(m, 'Добавить валюту', (code) => {
    if (code !== cfg.base && !cfg.list.includes(code)) cfg.list.push(code);
    render();
  });
  src.onclick = () => {
    close();
    B.invoke('open', FX_SOURCE, true);
  };
  m.querySelector('.fxok').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !m.querySelector('.fxpick')) close();
  });
  render();
  amount.focus();
  amount.select();
  fxLoad(false).then(() => { if (back.isConnected) render(); });
}

/** Выбор валюты из всех — с поиском по коду и названию. */
function fxPick(m, title, onPick) {
  const codes = Object.keys((fxRates && fxRates.rates) || {});
  if (!codes.length) return;
  codes.sort((a, b) => {
    const pa = FX_POPULAR.indexOf(a), pb = FX_POPULAR.indexOf(b);
    if (pa >= 0 || pb >= 0) return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
    return a.localeCompare(b);
  });
  const p = document.createElement('div');
  p.className = 'fxpick';
  p.innerHTML = '<h3></h3><input class="field fxq" placeholder="Код или название, например MDL" spellcheck="false"><div class="fxpl"></div>'
    + '<div class="fxfoot"><span></span><button class="btn fxback">Назад</button></div>';
  p.querySelector('h3').textContent = title;
  m.appendChild(p);
  const q = p.querySelector('.fxq');
  const pl = p.querySelector('.fxpl');
  const done = () => p.remove();
  const fill = () => {
    const f = q.value.trim().toLowerCase();
    pl.innerHTML = '';
    for (const code of codes) {
      const name = fxName(code);
      if (f && !code.toLowerCase().startsWith(f) && !name.toLowerCase().includes(f)) continue;
      const r = document.createElement('div');
      r.className = 'fxpi';
      r.innerHTML = '<b></b><span></span>';
      r.querySelector('b').textContent = code;
      r.querySelector('span').textContent = name;
      r.onclick = () => {
        done();
        onPick(code);
      };
      pl.appendChild(r);
    }
  };
  q.addEventListener('input', fill);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); done(); }
    if (e.key === 'Enter') {
      const first = pl.querySelector('.fxpi');
      if (first) first.click();
    }
  });
  p.querySelector('.fxback').onclick = done;
  fill();
  q.focus();
}
