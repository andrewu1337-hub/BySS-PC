'use strict';
// Внутренние страницы браузера (byss://) получают доступ к настройкам. Обычные сайты — нет.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// ------------------------------------------------------------------ автоскролл
// Плавно (пикселей в секунду) или шагами (часть экрана через интервал).
// Колесо мыши, клавиши или касание — пауза на пару секунд. Дошли до конца и
// новое не подгрузилось — останавливаемся и сообщаем браузеру.
function makeAutoscroll(onEnd) {
  let cfg = { mode: 'smooth', speed: 60, interval: 5, step: 75 };
  let on = false;
  let raf = 0;
  let timer = 0;
  let last = 0;
  let acc = 0;
  let hold = 0;
  let touching = false;
  let el = null;
  let picked = 0;
  let stuck = 0;

  const root = () => document.scrollingElement || document.documentElement;
  function scrollable(e) {
    if (!e || e.nodeType !== 1) return false;
    const s = getComputedStyle(e);
    return /(auto|scroll|overlay)/.test(s.overflowY) && e.scrollHeight - e.clientHeight > 8
      && e.clientHeight > innerHeight * 0.3;
  }
  function pick() {
    const se = root();
    if (se && se.scrollHeight - se.clientHeight > 8) return se;
    // страница прокручивается не целиком, а внутренним блоком — ищем самый большой
    let best = null;
    let area = 0;
    for (const [px, py] of [[0.5, 0.5], [0.5, 0.3], [0.5, 0.75], [0.3, 0.5], [0.7, 0.5]]) {
      for (let n = document.elementFromPoint(innerWidth * px, innerHeight * py); n && n !== document.documentElement; n = n.parentElement) {
        if (scrollable(n)) {
          const a = n.clientWidth * n.clientHeight;
          if (a > area) {
            area = a;
            best = n;
          }
          break;
        }
      }
    }
    return best || se;
  }
  const atEnd = (e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2;
  const paused = () => touching || Date.now() < hold || document.hidden;

  function frame(ts) {
    if (!on) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    if (paused()) {
      acc = 0;
      return;
    }
    if (!el || !el.isConnected || ts - picked > 1500) {
      el = pick();
      picked = ts;
    }
    acc += cfg.speed * dt;
    if (acc < 1) return;
    const px = Math.floor(acc);
    acc -= px;
    const before = el.scrollTop;
    el.scrollBy({ top: px, behavior: 'instant' });
    if (el.scrollTop > before) {
      stuck = 0;
    } else if (atEnd(el)) {
      if (!stuck) stuck = Date.now();
      else if (Date.now() - stuck > 5000) finish(); // 5 секунд ждём подгрузки
    } else {
      el = null; // этот блок не прокрутился — поищем другой
    }
  }

  function stepNow() {
    if (!on || paused()) return;
    if (!el || !el.isConnected) el = pick();
    const e = el;
    const before = e.scrollTop;
    const h = e === root() ? innerHeight : e.clientHeight;
    e.scrollBy({ top: Math.max(40, Math.round(h * cfg.step / 100)), behavior: 'smooth' });
    setTimeout(() => {
      if (!on) return;
      if (e.scrollTop > before + 1) stuck = 0;
      else if (atEnd(e)) {
        stuck++;
        if (stuck >= 2) finish();
      } else el = null;
    }, 900);
  }

  function run() {
    cancelAnimationFrame(raf);
    clearInterval(timer);
    if (!on) return;
    stuck = 0;
    if (cfg.mode === 'step') timer = setInterval(stepNow, Math.max(1, cfg.interval) * 1000);
    else {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    on = false;
    cancelAnimationFrame(raf);
    clearInterval(timer);
  }
  function finish() {
    stop();
    try {
      onEnd();
    } catch (e) {
      // ignore
    }
  }

  const userInput = () => {
    hold = Date.now() + 2500;
  };
  addEventListener('wheel', userInput, { passive: true, capture: true });
  addEventListener('mousedown', (e) => {
    if (e.button === 0) userInput();
  }, true);
  addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(e.key)) userInput();
  }, true);
  addEventListener('touchstart', () => {
    touching = true;
  }, { passive: true, capture: true });
  const touchEnd = () => {
    touching = false;
    hold = Date.now() + 1500;
  };
  addEventListener('touchend', touchEnd, { passive: true, capture: true });
  addEventListener('touchcancel', touchEnd, { passive: true, capture: true });

  return {
    start(c) {
      if (c) cfg = Object.assign({}, cfg, c);
      on = true;
      el = null;
      hold = 0;
      run();
    },
    set(c) {
      if (c) cfg = Object.assign({}, cfg, c);
      if (on) run();
    },
    stop
  };
}

// ------------------------------------------------------------------ YouTube
// Реклама в роликах. YouTube защищает страницу (Trusted Types), поэтому главное
// делается отсюда, из отдельного мира скрипта, куда защита не достаёт:
// реклама в плеере сразу глушится и проматывается, рекламные блоки скрыты.
// Дополнительно в саму страницу ставится yt.js — он вырезает рекламу из ответов плеера.
const YT_CSS = [
  // компьютерная версия
  '#masthead-ad', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-banner-promo-renderer',
  'ytd-statement-banner-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', '#player-ads',
  'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer', 'ytd-merch-shelf-renderer',
  'ytd-ads-engagement-panel-content-renderer', 'ytd-video-masthead-ad-v3-renderer',
  'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
  'ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)',
  'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
  '.ytp-ad-overlay-container', '.ytp-ad-image-overlay', '.ytp-featured-product', '.ytp-suggested-action',
  // мобильная версия
  'ytm-promoted-sparkles-web-renderer', 'ytm-promoted-video-renderer', 'ytm-companion-ad-renderer',
  'ytm-ad-slot-renderer', 'ad-slot-renderer', 'ytm-paid-content-overlay-renderer', 'ytm-statement-banner-renderer',
  'ytm-mealbar-promo-renderer', 'ytm-companion-slot'
].join(',') + '{display:none!important;}';

const YT_SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, '
  + '.ytp-ad-skip-button-container button, .ytp-ad-skip-button-slot button, button[id^="skip-button"]';

function ytGuard() {
  let muted = false;
  let rate = null;
  let observed = null;

  function addCss() {
    if (document.getElementById('__byss_yt_css')) return;
    const at = document.head || document.documentElement;
    if (!at) return;
    const st = document.createElement('style');
    st.id = '__byss_yt_css';
    st.textContent = YT_CSS;
    at.appendChild(st);
  }

  function tick() {
    try {
      const p = document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting, #movie_player.ad-showing');
      const v = document.querySelector('#movie_player video.html5-main-video, .html5-video-player video, video');
      if (p && v) {
        if (!v.muted) {
          v.muted = true;
          muted = true;
        }
        if (rate === null) rate = v.playbackRate || 1;
        if (v.playbackRate < 16) v.playbackRate = 16;
        if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.25) v.currentTime = v.duration;
        const b = document.querySelector(YT_SKIP);
        if (b) b.click();
      } else if (v) {
        if (muted) {
          v.muted = false;
          muted = false;
        }
        if (rate !== null) {
          v.playbackRate = rate;
          rate = null;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // плеер на странице появляется не сразу и при переходах может смениться — следим за его классом
  const mo = new MutationObserver(tick);
  setInterval(() => {
    addCss();
    const pl = document.querySelector('.html5-video-player');
    if (pl && pl !== observed) {
      mo.disconnect();
      mo.observe(pl, { attributes: true, attributeFilter: ['class'] });
      observed = pl;
    }
    tick();
  }, 250);
  addCss();
  document.addEventListener('DOMContentLoaded', addCss);
}

// ------------------------------------------------------------------ запуск

if (location.protocol === 'byss:') {
  contextBridge.exposeInMainWorld('byss', {
    invoke: (ch, ...args) => ipcRenderer.invoke('page:' + ch, ...args),
    on: (ch, fn) => ipcRenderer.on('page:' + ch, (e, ...args) => fn(...args))
  });
} else {
  let as = null;
  ipcRenderer.on('byss:autoscroll', (e, m) => {
    if (!as) as = makeAutoscroll(() => ipcRenderer.send('page:autoscroll-end'));
    if (m && m.on) as.start(m.cfg);
    else as.stop();
  });

  if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
    let cfg = null;
    try {
      cfg = ipcRenderer.sendSync('site:yt', location.hostname);
    } catch (e) {
      cfg = null;
    }
    if (cfg) {
      ytGuard();
      if (cfg.code) {
        // так код попадает в страницу в обход Trusted Types; не вышло — работает ytGuard
        try {
          const r = webFrame.executeJavaScript(cfg.code);
          if (r && r.catch) r.catch(() => {});
        } catch (e) {
          // ignore
        }
      }
    }
  }
}
