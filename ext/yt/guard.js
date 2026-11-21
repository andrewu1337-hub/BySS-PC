'use strict';
/* BySS: YouTube, отдельный мир скрипта. Рекламные блоки скрыты; если реклама в плеере всё же началась —
   звук выключается, ролик рекламы проматывается, кнопка «Пропустить» нажимается сама.
   Окно «блокировщики рекламы запрещены» убирается, видео продолжается.
   Главное делает yt.js в самой странице — он вырезает рекламу из ответов YouTube. */
(function () {
  if (window.__byssYtGuard) return;
  window.__byssYtGuard = true;

  const YT_CSS = [
    // компьютерная версия
    '#masthead-ad', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', 'ytd-search-pyv-renderer',
    'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer', 'ytd-merch-shelf-renderer',
    'ytd-ads-engagement-panel-content-renderer', 'ytd-video-masthead-ad-v3-renderer', 'ytd-brand-video-singleton-renderer',
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)', 'ytd-rich-item-renderer:has(> ytd-ad-slot-renderer)',
    'ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)', 'ytd-rich-item-renderer:has(ad-badge-view-model)',
    'ytd-rich-item-renderer:has(feed-ad-metadata-view-model)', 'ytd-rich-section-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)', 'ytd-video-renderer:has(ad-badge-view-model)',
    '.ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)', '#shopping-timely-shelf',
    'yt-overlay-product-sticker', 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    '.ytp-ad-overlay-container', '.ytp-ad-image-overlay', '.ytp-featured-product', '.ytp-suggested-action',
    // окно «блокировщики рекламы запрещены»
    'ytd-enforcement-message-view-model', 'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
    // мобильная версия
    'ytm-promoted-sparkles-web-renderer', 'ytm-promoted-video-renderer', 'ytm-companion-ad-renderer',
    'ytm-ad-slot-renderer', 'ad-slot-renderer', 'ytm-paid-content-overlay-renderer', 'ytm-statement-banner-renderer',
    'ytm-mealbar-promo-renderer', 'ytm-companion-slot', 'ytm-rich-item-renderer:has(> ad-slot-renderer)'
    // #player-ads не прячем: YouTube проверяет этот блок и замечает блокировщик
  ].map((sel) => sel + '{display:none!important}').join('\n'); // каждое правило отдельно: одно непонятное браузеру не ломает остальные

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

    function unblock() {
      // окно «блокировщики запрещены» — убрать и продолжить видео
      const m = document.querySelector('ytd-enforcement-message-view-model');
      if (!m) return;
      const dlg = m.closest('tp-yt-paper-dialog') || m;
      dlg.remove();
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
      const v = document.querySelector('#movie_player video, video');
      if (v && v.paused) v.play().catch(() => {});
    }

    function tick() {
      try {
        unblock();
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

  ytGuard();
})();
