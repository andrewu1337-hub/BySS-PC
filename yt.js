/* BySS: только для YouTube. Выполняется в странице до её собственных скриптов.
   Убирает рекламу из ответов плеера, прячет рекламные блоки, а если ролик всё же
   начался — глушит его, проматывает и нажимает «Пропустить». То же самое, что в BySS на Android. */
(function () {
  if (window.__byssYt) return;
  window.__byssYt = true;

  var KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  function prune(o, depth) {
    if (!o || typeof o !== 'object' || depth > 5) return o;
    for (var i = 0; i < KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(o, KEYS[i])) {
        try { delete o[KEYS[i]]; } catch (e) { /* ignore */ }
      }
    }
    if (o.playerResponse) prune(o.playerResponse, depth + 1);
    if (o.response) prune(o.response, depth + 1);
    if (Array.isArray(o)) {
      for (var j = 0; j < o.length && j < 12; j++) prune(o[j], depth + 1);
    }
    return o;
  }

  var origParse = JSON.parse;
  JSON.parse = function () {
    var r = origParse.apply(this, arguments);
    try {
      if (r && typeof r === 'object' && (r.adPlacements || r.playerAds || r.adSlots || r.playerResponse || Array.isArray(r))) prune(r, 0);
    } catch (e) { /* ignore */ }
    return r;
  };
  try {
    var origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.apply(this, arguments).then(function (r) {
        try { prune(r, 0); } catch (e) { /* ignore */ }
        return r;
      });
    };
  } catch (e) { /* ignore */ }
  ['ytInitialPlayerResponse', 'playerResponse'].forEach(function (name) {
    try {
      var value;
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return value; },
        set: function (v) { value = prune(v, 0); }
      });
    } catch (e) { /* ignore */ }
  });

  var css = [
    // компьютерная версия
    '#masthead-ad', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', '#player-ads',
    'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer', 'ytd-merch-shelf-renderer',
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    '.ytp-ad-overlay-container', '.ytp-ad-image-overlay', '.ytp-featured-product', '.ytp-suggested-action',
    // мобильная версия
    'ytm-promoted-sparkles-web-renderer', 'ytm-promoted-video-renderer', 'ytm-companion-ad-renderer',
    'ytm-ad-slot-renderer', 'ad-slot-renderer', 'ytm-paid-content-overlay-renderer', 'ytm-statement-banner-renderer',
    'ytm-mealbar-promo-renderer', 'ytm-companion-slot'
  ].join(',') + '{display:none!important;}';
  function addCss() {
    if (document.getElementById('__byss_yt')) return;
    var root = document.head || document.documentElement;
    if (!root) return;
    var st = document.createElement('style');
    st.id = '__byss_yt';
    st.textContent = css;
    root.appendChild(st);
  }
  addCss();
  document.addEventListener('DOMContentLoaded', addCss);

  var mutedByUs = false;
  setInterval(function () {
    try {
      addCss();
      var p = document.querySelector('.ad-showing, .ad-interrupting');
      var v = document.querySelector('#movie_player video, video');
      if (p && v) {
        if (!v.muted) { v.muted = true; mutedByUs = true; }
        if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.3) v.currentTime = v.duration;
        var b = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button,'
          + ' .ytp-ad-skip-button-container button, button.ytp-ad-skip-button-modern');
        if (b) b.click();
      } else if (mutedByUs && v) {
        v.muted = false;
        mutedByUs = false;
      }
    } catch (e) { /* ignore */ }
  }, 300);
})();
