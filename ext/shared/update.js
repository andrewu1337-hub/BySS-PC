'use strict';
// Проверка обновлений BySS. Само расширение BySS Firefox обновляет сам (раз в несколько часов).
// Установщик нужен заново, только если поменялись настройки самого Firefox (номер «setup» в byss.json).
(function () {
  const REPO = 'andrewu1337-hub/BySS-PC';
  const INFO = 'https://github.com/' + REPO + '/releases/latest/download/byss.json';
  const SETUP = 'https://github.com/' + REPO + '/releases/latest/download/BySS-Setup.exe';

  function cmp(a, b) {
    const x = String(a || '0').split('.').map(Number);
    const y = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  window.byssCheckUpdate = async function () {
    const cur = browser.runtime.getManifest().version;
    let info = { version: '', setup: 0 };
    try {
      info = await browser.runtime.sendMessage({ t: 'install-info' });
    } catch (e) {
      // нет данных установщика
    }
    let latest;
    try {
      const r = await fetch(INFO + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
      latest = await r.json();
    } catch (e) {
      return { text: 'Нет связи с GitHub — проверьте интернет и попробуйте ещё раз.' };
    }
    if (info.setup && Number(latest.setup || 0) > info.setup) {
      return {
        text: 'Есть новая версия ' + latest.version + ' с изменениями в самом браузере. Скачайте установщик и запустите его — '
          + 'входы на сайтах и настройки сохранятся.',
        setupUrl: SETUP
      };
    }
    if (cmp(latest.version, cur) > 0) {
      let started = false;
      try {
        if (browser.runtime.requestUpdateCheck) {
          const r = await browser.runtime.requestUpdateCheck();
          started = !!r;
        }
      } catch (e) {
        started = false;
      }
      return {
        text: 'Есть новая версия ' + latest.version + ' (у вас ' + cur + '). '
          + (started ? 'Скачиваю — BySS обновится через минуту.' : 'BySS обновится сам в ближайшие часы.')
      };
    }
    return { text: 'У вас последняя версия — ' + cur + '.' };
  };

  /** Скачать установщик. Возвращает номер загрузки (открыть его можно только по нажатию — так требует Firefox). */
  window.byssDownloadSetup = async function (url) {
    try {
      const id = await browser.downloads.download({ url: url || SETUP, filename: 'BySS-Setup.exe', conflictAction: 'overwrite' });
      const ok = await new Promise((resolve) => {
        const on = (d) => {
          if (d.id !== id || !d.state) return;
          if (d.state.current === 'complete' || d.state.current === 'interrupted') {
            browser.downloads.onChanged.removeListener(on);
            resolve(d.state.current === 'complete');
          }
        };
        browser.downloads.onChanged.addListener(on);
      });
      return ok ? id : null;
    } catch (e) {
      browser.tabs.create({ url: 'https://github.com/' + REPO + '/releases/latest' });
      return null;
    }
  };

})();
