// Перевод прямо на странице: сайт остаётся настоящим (входы, видео, кнопки работают),
// меняются только тексты. Работает в отдельном «мире» скриптов — сайт его не видит.
// Главный процесс забирает тексты через take(), переводит и возвращает через put().
(() => {
  if (window.__byssTr) return true;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'KBD',
    'SAMP', 'VAR', 'SVG', 'MATH', 'TEMPLATE', 'IFRAME', 'CANVAS', 'OBJECT']);
  const info = new WeakMap();   // текстовый узел → { src, tr }
  const touched = new Set();    // узлы, которые мы перевели (чтобы вернуть оригинал)
  const queue = new Map();      // текст → узлы, ждут перевода
  const inflight = new Map();   // текст → узлы, перевод уже запрошен
  const cache = new Map();      // текст → перевод
  let on = true;

  function skipEl(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (SKIP.has(e.tagName.toUpperCase())) return true;
      if (e.isContentEditable) return true;
      if (e.getAttribute('translate') === 'no' || e.classList.contains('notranslate')) return true;
    }
    return false;
  }

  const norm = (v) => v.replace(/\s+/g, ' ').trim();

  function consider(n) {
    if (!on || n.nodeType !== 3) return;
    const v = n.nodeValue;
    if (!v || v.length > 3000 || !/\p{L}/u.test(v)) return;
    const st = info.get(n);
    if (st && v === st.tr) return; // уже наш перевод
    const key = norm(v);
    if (key.length < 2 || !n.parentElement || skipEl(n.parentElement)) return;
    // коды и названия не переводим: NL, USA, YouTube, AutoScout24
    if (key.length <= 4 && !/\p{Ll}/u.test(key)) return;
    if (/^[A-Z][a-z]+[A-Z][\w-]*$/.test(key)) return;
    if (cache.has(key)) {
      apply(n, v, key, cache.get(key));
      return;
    }
    const map = inflight.has(key) ? inflight : queue;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(n);
  }

  function apply(n, v, key, tr) {
    if (!tr || tr === key) return;
    const lead = v.match(/^\s*/)[0];
    const trail = v.match(/\s*$/)[0];
    const out = lead + tr + trail;
    info.set(n, { src: v, tr: out });
    touched.add(n);
    n.nodeValue = out;
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      consider(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && skipEl(root)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) consider(n);
  }

  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') consider(m.target);
      else for (const n of m.addedNodes) scan(n);
    }
  });

  function start() {
    if (document.documentElement) document.documentElement.setAttribute('data-byss-translated', '1');
    if (document.title) {
      const t = document.querySelector('title');
      if (t && t.firstChild) consider(t.firstChild);
    }
    scan(document.body);
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  window.__byssTr = {
    // до maxChars символов текста на перевод
    take(maxChars) {
      const out = [];
      let size = 0;
      for (const [key, nodes] of queue) {
        if (out.length && size + key.length > maxChars) break;
        out.push(key);
        size += key.length + 1;
        inflight.set(key, nodes);
        queue.delete(key);
        if (out.length >= 120) break;
      }
      return out;
    },
    put(pairs) {
      for (const [key, tr] of pairs) {
        cache.set(key, tr);
        const nodes = inflight.get(key);
        inflight.delete(key);
        if (!nodes || !on) continue;
        for (const n of nodes) {
          if (n.isConnected && norm(n.nodeValue || '') === key) apply(n, n.nodeValue, key, tr);
        }
      }
      // узлы, которые давно убраны со страницы, больше не держим
      if (touched.size > 20000) for (const n of touched) if (!n.isConnected) touched.delete(n);
      return queue.size;
    },
    pending() {
      return queue.size + inflight.size;
    },
    restore() {
      on = false;
      mo.disconnect();
      for (const n of touched) {
        const st = info.get(n);
        if (st && n.nodeValue === st.tr) n.nodeValue = st.src;
      }
      touched.clear();
      queue.clear();
      inflight.clear();
      if (document.documentElement) document.documentElement.removeAttribute('data-byss-translated');
      delete window.__byssTr;
      return true;
    }
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  return true;
})();
