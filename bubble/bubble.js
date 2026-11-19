'use strict';
const api = window.byssBubble;
const I = window.ICONS;
const MAP = { lock: 'shield', translate: 'translate', download: 'download', shot: 'screenshot', update: 'reload', tabs: 'tabs' };
let current = null;
document.getElementById('x').innerHTML = I.close;
document.getElementById('x').onclick = () => current && api.click(current.id, '__close');

function report() {
  const c = document.getElementById('card');
  api.size(c.getBoundingClientRect().height + 16);
}

api.on((m) => {
  current = m;
  document.body.classList.toggle('light', !!m.light);
  const c = document.getElementById('card');
  c.style.display = 'block';
  document.getElementById('ic').innerHTML = m.icon && I[MAP[m.icon] || m.icon] ? I[MAP[m.icon] || m.icon] : '';
  document.getElementById('t').textContent = m.text || '';
  document.getElementById('s').textContent = m.sub || '';
  const bar = document.getElementById('bar');
  if (m.progress == null) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'block';
    bar.classList.toggle('ind', m.progress < 0);
    document.getElementById('fill').style.width = m.progress < 0 ? '' : Math.round(Math.max(0, Math.min(1, m.progress)) * 100) + '%';
  }
  const btns = document.getElementById('btns');
  btns.innerHTML = '';
  for (const b of m.buttons || []) {
    const el = document.createElement('button');
    el.className = 'b' + (b.primary ? ' p' : '');
    el.textContent = b.label;
    el.onclick = () => api.click(m.id, b.id);
    btns.appendChild(el);
  }
  requestAnimationFrame(report);
});
new ResizeObserver(report).observe(document.getElementById('card'));
