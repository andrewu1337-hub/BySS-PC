'use strict';
// Настройки и данные браузера — обычные JSON-файлы в папке приложения на компьютере.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  name: 'BySS',
  showBrand: true,
  theme: 'dark',              // dark | light
  wallpaper: 'lines',         // lines | waves | dots | black | custom
  engines: ['google', 'yandex', 'ddg'],
  engine: 'google',           // поиск из адресной строки
  cities: [
    { name: 'Роттердам', lat: 51.9225, lon: 4.47917 },
    { name: 'Кишинёв', lat: 47.00556, lon: 28.8575 }
  ],
  shortcuts: null,            // заполняется ниже: обычные сайты + «мои сайты»
  adblock: true,
  allowSites: {},             // сайт → true: трекеры разрешены
  askedSites: {},             // сайт → true: уже спросили про рекламу и трекеры
  translate: {},              // сайт → 'yes' | 'no'
  restoreTabs: true,
  window: null,               // размер и положение окна, развёрнуто ли на весь экран
  installStamp: '',           // какие настройки установщика уже применены
  modes: []                   // режимы BySS: [{ id, name }]
};

// сайты на главной: обычные и «мои» (их можно не ставить — галочка в установщике)
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
DEFAULTS.shortcuts = BASE_SITES.concat(MY_SITES);

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      Object.assign(this.data, saved);
    } catch (e) {
      // первый запуск — настройки по умолчанию
    }
    this.timer = null;
  }

  get(key) {
    return this.data[key];
  }

  all() {
    return this.data;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (e) {
      // нет места или нет доступа — не страшно, попробуем позже
    }
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.flush();
  }
}

module.exports = { Store, DEFAULTS, BASE_SITES, MY_SITES };
