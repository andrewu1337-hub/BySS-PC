'use strict';
/* BySS: автоскролл. Плавно (пикселей в секунду), шагами (часть экрана через интервал)
   или «колесом» (как будто крутят колёсико). Колесо мыши, клавиши или касание — пауза на пару секунд.
   Дошли до конца и новое не подгрузилось — останавливаемся. Управление — кнопка BySS и Alt+Shift+S. */
(function () {
  if (window.__byssAutoscroll) return;
  window.__byssAutoscroll = true;

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

  // «колесом»: прокрутка на высоту щелчков колёсика через интервал; сайтам — настоящее событие колёсика
  function makeWheel(onEnd) {
    let timer = 0;
    let hold = 0;
    let stuck = 0;
    let cfg = { interval: 5, ticks: 1 };
    const root = () => document.scrollingElement || document.documentElement;
    const userInput = (e) => {
      if (e && e.isTrusted === false) return;
      hold = Date.now() + 2500;
    };
    addEventListener('wheel', userInput, { passive: true, capture: true });
    addEventListener('keydown', userInput, true);
    function tick() {
      if (Date.now() < hold || document.hidden) return;
      const x = innerWidth / 2;
      const y = innerHeight / 2;
      const target = document.elementFromPoint(x, y) || document.body;
      const dy = 120 * (cfg.ticks || 1);
      try {
        target.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      } catch (e) {
        // ignore
      }
      let el = target;
      while (el && el !== document.documentElement) {
        const s = getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight - el.clientHeight > 8) break;
        el = el.parentElement;
      }
      if (!el || el === document.documentElement || el === document.body) el = root();
      const before = el.scrollTop;
      el.scrollBy({ top: dy, behavior: 'smooth' });
      setTimeout(() => {
        if (el.scrollTop > before + 1) stuck = 0;
        else if (++stuck >= 3) {
          stop();
          try {
            onEnd();
          } catch (e) {
            // ignore
          }
        }
      }, 900);
    }
    function stop() {
      clearInterval(timer);
      timer = 0;
    }
    return {
      start(c) {
        if (c) cfg = Object.assign({}, cfg, c);
        stop();
        stuck = 0;
        timer = setInterval(tick, Math.max(1, cfg.interval) * 1000);
      },
      set(c) {
        if (c) cfg = Object.assign({}, cfg, c);
        if (timer) this.start();
      },
      stop
    };
  }

  const ended = () => browser.runtime.sendMessage({ t: 'as-ended' }).catch(() => {});
  let smooth = null;
  let wheel = null;
  function stopAll() {
    if (smooth) smooth.stop();
    if (wheel) wheel.stop();
  }
  function startWith(cfg) {
    stopAll();
    if (cfg.mode === 'wheel') {
      if (!wheel) wheel = makeWheel(ended);
      wheel.start(cfg);
    } else {
      if (!smooth) smooth = makeAutoscroll(ended);
      smooth.start(cfg);
    }
  }
  let running = false;
  browser.runtime.onMessage.addListener((m) => {
    if (!m || !m.as) return undefined;
    if (m.as === 'start') {
      running = true;
      startWith(m.cfg || {});
    } else if (m.as === 'set') {
      if (running) startWith(m.cfg || {});
    } else if (m.as === 'stop') {
      running = false;
      stopAll();
    }
    return Promise.resolve(true);
  });
})();
