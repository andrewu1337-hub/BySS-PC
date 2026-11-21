'use strict';
// Настройки BySS по умолчанию — те же, что были в BySS на Electron. Подключается и фоном, и страницами.
(function (root) {
  const BASE_SITES = [
    { title: 'Google', url: 'https://www.google.com/' },
    { title: 'Яндекс', url: 'https://ya.ru/' },
    { title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
    { title: 'Переводчик', url: 'https://translate.google.com/' },
    { title: 'YouTube', url: 'https://www.youtube.com/' }
  ];
  const MY_SITES = [
    { title: 'Sauto', url: 'https://www.sauto.cz/' },
    { title: 'mobile.de', url: 'https://www.mobile.de/' },
    { title: 'AutoScout24', url: 'https://www.autoscout24.de/' }
  ];

  const DEFAULTS = {
    name: 'BySS',
    showBrand: true,
    theme: 'dark',               // dark | light
    wallpaper: 'lines',          // lines | waves | dots | black | custom
    engines: ['google', 'yandex', 'currency'],
    currency: { base: 'EUR', list: ['MDL', 'USD', 'RON', 'UAH', 'CZK', 'GBP'], amount: 1 },
    engine: 'google',
    cities: [
      { name: 'Роттердам', lat: 51.9225, lon: 4.47917 },
      { name: 'Кишинёв', lat: 47.00556, lon: 28.8575 }
    ],
    shortcuts: BASE_SITES.concat(MY_SITES),
    autoscroll: { mode: 'smooth', level: 4, interval: 5, step: 75 },
    ytGuard: true
  };

  // что можно взять из настроек старого BySS (Electron) и что можно менять со страниц
  const KEYS = ['name', 'showBrand', 'theme', 'wallpaper', 'engines', 'currency', 'engine', 'cities', 'shortcuts', 'autoscroll', 'ytGuard'];

  const ENGINE_URLS = {
    google: 'https://www.google.com/search?q=',
    yandex: 'https://yandex.ru/search/?text=',
    ddg: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q='
  };

  root.BYSS_DEFAULTS = DEFAULTS;
  root.BYSS_KEYS = KEYS;
  root.BYSS_ENGINES = ENGINE_URLS;
  root.BYSS_AS_SPEEDS = [15, 25, 40, 60, 85, 120, 170, 240, 340, 480]; // автоскролл, пикселей в секунду
})(typeof window !== 'undefined' ? window : globalThis);
