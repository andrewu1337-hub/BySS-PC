/* BySS: только для YouTube. Выполняется в самой странице раньше её скриптов.
   Скрыть рекламные блоки и промотать ролик, если реклама всё же началась, —
   это делает preload-page.js (ytGuard).

   Что здесь (то же самое — в youtube.js браузера для Android):
   1. Из ответов YouTube (плеер, лента, поиск, Shorts) вырезается реклама —
      до того, как страница её увидит.
   2. YouTube берёт «чистые» функции из пустого iframe, чтобы обойти пункт 1, —
      в такие iframe сразу ставится та же защита.
   3. Глушится проверка «реклама не показалась», из-за которой YouTube
      останавливает видео, и ускоряется искусственная задержка.
   4. Реклама, вшитая в сам поток видео, проматывается. */
(function () {
  'use strict';
  var W = window;
  if (W.__byssYtAds) return;
  try {
    Object.defineProperty(W, '__byssYtAds', { value: true });
  } catch (e) {
    return;
  }

  var hasOwn = Object.prototype.hasOwnProperty;
  var fnToString = Function.prototype.toString;

  // ключи с рекламой в ответе плеера
  var AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  // рекламные блоки в ленте, поиске, рекомендациях
  var AD_ITEM = /^(adSlotRenderer|displayAdRenderer|promotedVideoRenderer|compactPromotedVideoRenderer|promotedSparklesWebRenderer|promotedSparklesTextSearchRenderer|searchPyvRenderer|inFeedAdLayoutRenderer|bannerPromoRenderer|statementBannerRenderer|brandVideoSingletonRenderer|brandVideoShelfRenderer|actionCompanionAdRenderer|adActionInterstitialRenderer|playerLegacyDesktopWatchAdsRenderer|videoMastheadAdV3Renderer)$/;
  // запросы, в ответе которых приходит реклама к ролику
  var PLAYER_URL = /\/youtubei\/v1\/(player|get_watch|reel\/reel_item_watch)|\/(watch|playlist)\?|\/get_video_info/;

  // ------------------------------------------------------------------ чистка данных

  /** Обёртка вида {adSlotRenderer: {...}} (иногда рядом trackingParams). */
  function isAdWrap(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var n = 0;
    var ad = false;
    for (var k in o) {
      if (!hasOwn.call(o, k)) continue;
      if (++n > 2) return false;
      if (AD_ITEM.test(k)) ad = true;
    }
    return ad;
  }

  function isAdItem(x) {
    if (isAdWrap(x)) return true;
    var w = x.richItemRenderer || x.richSectionRenderer;
    if (w && typeof w === 'object' && isAdWrap(w.content)) return true;
    var r = x.command && x.command.reelWatchEndpoint; // реклама между Shorts
    return !!(r && r.adClientParams && r.adClientParams.isAd);
  }

  /** Убирает рекламу из объекта на месте. Обходит без рекурсии, с ограничением на размер. */
  function clean(root) {
    var stack = [root];
    var budget = 400000;
    while (stack.length && budget-- > 0) {
      var o = stack.pop();
      if (Array.isArray(o)) {
        for (var i = o.length - 1; i >= 0; i--) {
          var x = o[i];
          if (!x || typeof x !== 'object') continue;
          if (isAdItem(x)) o.splice(i, 1);
          else stack.push(x);
        }
        continue;
      }
      for (var j = 0; j < AD_KEYS.length; j++) {
        if (hasOwn.call(o, AD_KEYS[j])) {
          try {
            delete o[AD_KEYS[j]];
          } catch (e) { /* ignore */ }
        }
      }
      for (var k in o) {
        if (!hasOwn.call(o, k)) continue;
        var v = o[k];
        if (!v || typeof v !== 'object') continue;
        if (AD_ITEM.test(k) || isAdWrap(v)) {
          try {
            delete o[k];
          } catch (e) { /* ignore */ }
          continue;
        }
        stack.push(v);
      }
    }
    return root;
  }

  function looksYt(r) {
    if (!r || typeof r !== 'object') return false;
    if (Array.isArray(r)) {
      for (var i = 0; i < r.length && i < 6; i++) {
        var x = r[i];
        if (x && typeof x === 'object' && (x.response || x.playerResponse)) return true;
      }
      return false;
    }
    return !!(r.responseContext || r.playerResponse || r.adPlacements || r.adSlots || r.playerAds
      || r.onResponseReceivedActions || r.onResponseReceivedEndpoints);
  }

  function cleanObj(r) {
    try {
      if (looksYt(r)) clean(r);
    } catch (e) { /* ignore */ }
    return r;
  }

  var AD_TEXT = /"(adPlacements|adSlots|playerAds)"/g;
  function cleanText(s) {
    return typeof s === 'string' ? s.replace(AD_TEXT, '"no_ads"') : s;
  }

  function wrap(obj, name, handler) {
    try {
      var orig = obj[name];
      if (typeof orig !== 'function') return;
      // Proxy снаружи выглядит как родная функция (toString → [native code])
      obj[name] = new Proxy(orig, { apply: handler });
    } catch (e) { /* ignore */ }
  }

  /** Ставит перехватчики в окно (главное или пустой iframe). */
  function hookRealm(win) {
    try {
      if (!win || hasOwn.call(win, '__byssYtRealm')) return;
      Object.defineProperty(win, '__byssYtRealm', { value: true });
    } catch (e) {
      return;
    }

    if (win.JSON) {
      wrap(win.JSON, 'parse', function (t, self, args) {
        return cleanObj(Reflect.apply(t, self, args));
      });
    }

    var RP = win.Response && win.Response.prototype;
    if (RP) {
      wrap(RP, 'json', function (t, self, args) {
        return Reflect.apply(t, self, args).then(cleanObj);
      });
      wrap(RP, 'text', function (t, self, args) {
        var p = Reflect.apply(t, self, args);
        var u = '';
        try {
          u = String(self.url || '');
        } catch (e) { /* ignore */ }
        return PLAYER_URL.test(u) ? p.then(cleanText) : p;
      });
    }

    var XP = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (XP) {
      var urls = new WeakMap();
      var cache = new WeakMap();
      wrap(XP, 'open', function (t, self, args) {
        try {
          urls.set(self, String(args[1] || ''));
          cache.delete(self);
        } catch (e) { /* ignore */ }
        return Reflect.apply(t, self, args);
      });
      ['responseText', 'response'].forEach(function (prop) {
        try {
          var d = Object.getOwnPropertyDescriptor(XP, prop);
          if (!d || typeof d.get !== 'function') return;
          Object.defineProperty(XP, prop, {
            configurable: true,
            enumerable: d.enumerable,
            get: new Proxy(d.get, {
              apply: function (t, self, args) {
                var v = Reflect.apply(t, self, args);
                try {
                  if (!v || self.readyState !== 4) return v;
                  var u = urls.get(self) || self.responseURL || '';
                  if (typeof v === 'string') {
                    if (!PLAYER_URL.test(u)) return v;
                    var c = cache.get(self);
                    if (!c || c.raw !== v) {
                      c = { raw: v, out: cleanText(v) };
                      cache.set(self, c);
                    }
                    return c.out;
                  }
                  if (typeof v === 'object' && self.responseType === 'json') cleanObj(v);
                } catch (e) { /* ignore */ }
                return v;
              }
            })
          });
        } catch (e) { /* ignore */ }
      });
    }

    // новые пустые iframe получают ту же защиту сразу, как попадают на страницу
    var NP = win.Node && win.Node.prototype;
    var EP = win.Element && win.Element.prototype;
    var after = function (t, self, args) {
      var r = Reflect.apply(t, self, args);
      for (var i = 0; i < args.length; i++) frames(args[i]);
      return r;
    };
    if (NP) ['appendChild', 'insertBefore', 'replaceChild'].forEach(function (m) { wrap(NP, m, after); });
    if (EP) {
      ['append', 'prepend', 'after', 'before', 'replaceWith', 'replaceChildren', 'insertAdjacentElement']
        .forEach(function (m) { wrap(EP, m, after); });
    }
  }

  function frame(f) {
    try {
      var w = f.contentWindow;
      if (!w || w === W) return;
      void w.document; // чужой сайт — сюда не попадём
      hookRealm(w);
    } catch (e) { /* ignore */ }
  }

  function frames(n) {
    try {
      if (!n || typeof n !== 'object' || !n.nodeType) return;
      if (n.nodeName === 'IFRAME' || n.nodeName === 'FRAME') {
        frame(n);
      } else if ((n.nodeType === 1 || n.nodeType === 11) && n.firstElementChild && n.querySelectorAll) {
        var l = n.querySelectorAll('iframe,frame');
        for (var i = 0; i < l.length; i++) frame(l[i]);
      }
    } catch (e) { /* ignore */ }
  }

  hookRealm(W);

  // данные, которые YouTube вписывает прямо в страницу
  ['ytInitialPlayerResponse', 'ytInitialData', 'playerResponse'].forEach(function (name) {
    try {
      var value;
      Object.defineProperty(W, name, {
        configurable: true,
        get: function () { return value; },
        set: function (v) {
          value = v && typeof v === 'object' ? clean(v) : v;
        }
      });
    } catch (e) { /* ignore */ }
  });

  // ------------------------------------------------------------------ проверки YouTube

  // «Реклама не показалась» — YouTube останавливает видео. Этот обработчик заменяем пустым.
  try {
    var PT = W.Promise.prototype;
    PT.then = new Proxy(PT.then, {
      apply: function (t, self, args) {
        var f = args[0];
        if (typeof f === 'function') {
          var bad = false;
          try {
            bad = fnToString.call(f).indexOf('onAbnormalityDetected') !== -1;
          } catch (e) { /* ignore */ }
          if (bad) {
            args = Array.prototype.slice.call(args);
            args[0] = function () {};
          }
        }
        return Reflect.apply(t, self, args);
      }
    });
  } catch (e) { /* ignore */ }

  // искусственная пауза на 17 секунд перед роликом — почти без ожидания
  wrap(W, 'setTimeout', function (t, self, args) {
    try {
      if (args[1] === 17000 && typeof args[0] === 'function'
        && fnToString.call(args[0]).indexOf('[native code]') !== -1) {
        args = Array.prototype.slice.call(args);
        args[1] = 17;
      }
    } catch (e) { /* ignore */ }
    return Reflect.apply(t, self, args);
  });

  // Встроенный в страницу скрипт, который сохраняет «чистый» fetch в обход защиты, — не запускаем.
  try {
    var mo = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var add = recs[i].addedNodes;
        for (var j = 0; j < add.length; j++) {
          var n = add[j];
          if (n.nodeName === 'SCRIPT' && !n.src && (n.textContent || '').indexOf('window,"fetch"') !== -1) {
            n.remove();
          }
        }
      }
    });
    mo.observe(document, { childList: true, subtree: true });
    W.addEventListener('load', function () {
      setTimeout(function () { mo.disconnect(); }, 3000);
    });
  } catch (e) { /* ignore */ }

  // ------------------------------------------------------------------ реклама внутри потока

  // Реклама, вшитая в сам поток видео (в «статистике для сисадминов» — «SSAP, AD»): мотаем в конец.
  setInterval(function () {
    try {
      if (!/^\/(watch|embed\/|shorts\/|live\/)/.test(location.pathname)) return;
      var p = document.getElementById('movie_player');
      if (!p || typeof p.getStatsForNerds !== 'function') return;
      var s = p.getStatsForNerds();
      if (!s || typeof s.debug_info !== 'string' || s.debug_info.indexOf('SSAP, AD') !== 0) return;
      var pr = typeof p.getProgressState === 'function' ? p.getProgressState() : null;
      if (pr && pr.duration > 0 && pr.current < pr.duration - 0.2 && typeof p.seekTo === 'function') {
        p.seekTo(pr.duration);
      }
    } catch (e) { /* ignore */ }
  }, 400);

  // метка «защита работает» — её проверяет preload-page.js
  var mark = function () {
    try {
      if (document.documentElement) document.documentElement.setAttribute('data-byss-yt', '1');
    } catch (e) { /* ignore */ }
  };
  mark();
  document.addEventListener('DOMContentLoaded', mark);
})();
