'use strict';
// Надпись «BySS» в стиле GTA (наклон, чёрная обводка, тень) — как выбрано на телефоне.
(function () {
  const HEART = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,21.5 C12,21.5 2,14.6 2,8.4 C2,4.8 4.8,2.8 7.4,2.8 C9.6,2.8 11.2,4.1 12,5.6 C12.8,4.1 14.4,2.8 16.6,2.8 C19.2,2.8 22,4.8 22,8.4 C22,14.6 12,21.5 12,21.5 Z"/></svg>';
  window.heart = function (el) {
    const r = el.getBoundingClientRect();
    const h = document.createElement('div');
    h.className = 'heart';
    h.innerHTML = HEART;
    h.style.left = (r.left + r.width / 2) + 'px';
    h.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 700);
  };

  window.renderBrand = function (box, text, size) {
    const NS = 'http://www.w3.org/2000/svg';
    box.innerHTML = '';
    const svg = document.createElementNS(NS, 'svg');
    const id = 'g' + Math.random().toString(36).slice(2);
    svg.innerHTML = '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#CFCFD4"/></linearGradient>'
      + '<filter id="s' + id + '" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="' + (size * 0.06)
      + '" dy="' + (size * 0.08) + '" stdDeviation="' + (size * 0.06) + '" flood-color="#000" flood-opacity=".75"/></filter></defs>';
    const t = document.createElementNS(NS, 'text');
    t.textContent = text;
    t.setAttribute('x', String(size * 0.3));
    t.setAttribute('y', String(size * 1.05));
    t.setAttribute('font-family', '"BySS Brand", "Arial Black", "Segoe UI Black", sans-serif');
    t.setAttribute('font-size', String(size));
    t.setAttribute('fill', 'url(#' + id + ')');
    t.setAttribute('stroke', '#000');
    t.setAttribute('stroke-width', String(size * 0.13));
    t.setAttribute('stroke-linejoin', 'round');
    t.setAttribute('paint-order', 'stroke');
    t.setAttribute('filter', 'url(#s' + id + ')');
    t.setAttribute('transform', 'skewX(-12)');
    svg.appendChild(t);
    box.appendChild(svg);
    const fit = () => {
      try {
        const b = t.getBBox();
        const pad = size * 0.3;
        svg.setAttribute('viewBox', (b.x - pad) + ' ' + (b.y - pad) + ' ' + (b.width + pad * 2.4) + ' ' + (b.height + pad * 2));
        svg.setAttribute('width', String(b.width + pad * 2.4));
        svg.setAttribute('height', String(b.height + pad * 2));
      } catch (e) {
        // ещё не видно
      }
    };
    fit();
    if (document.fonts) document.fonts.ready.then(fit);
  };
})();
