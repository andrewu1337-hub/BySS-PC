/* BySS: только для YouTube. Выполняется в странице до её собственных скриптов и убирает
   рекламу из ответов плеера. Скрыть рекламные блоки и промотать рекламу, если она всё же
   началась, — это делает preload-page.js (ytGuard), туда защита страницы не достаёт. */
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

})();
