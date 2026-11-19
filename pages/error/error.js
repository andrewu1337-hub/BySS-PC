'use strict';
const q = new URLSearchParams(location.search);
const code = q.get('c') || '';
const url = q.get('u') || '';
const T = {
  '-105': ['Сайт не найден', 'Проверьте, правильно ли написан адрес.'],
  '-137': ['Сайт не найден', 'Проверьте, правильно ли написан адрес.'],
  '-106': ['Нет интернета', 'Проверьте подключение к сети и нажмите «Повторить».'],
  '-21': ['Сеть поменялась', 'Нажмите «Повторить».'],
  '-102': ['Сайт не отвечает', 'Сервер отказал в соединении. Попробуйте позже.'],
  '-118': ['Сайт долго не отвечает', 'Связь слишком медленная или сайт перегружен.'],
  '-7': ['Сайт долго не отвечает', 'Связь слишком медленная или сайт перегружен.'],
  '-109': ['Сайт недоступен', 'Похоже, адрес больше не работает.'],
  crash: ['Страница упала', 'Так бывает с тяжёлыми сайтами. Нажмите «Повторить».']
};
let t = T[code];
if (!t && /^-2\d\d$/.test(code)) t = ['Небезопасное соединение', 'У сайта проблемы с сертификатом — злоумышленники могут перехватить данные. Не вводите здесь пароли.'];
if (!t) t = ['Не удалось открыть сайт', (q.get('d') || 'Неизвестная ошибка') + ' (' + code + ')'];
document.getElementById('h').textContent = t[0];
document.getElementById('p').textContent = t[1];
document.getElementById('u').textContent = url;
document.title = t[0];
document.getElementById('retry').onclick = () => window.byss.invoke('open', url);
document.getElementById('home').onclick = () => window.byss.invoke('open', 'byss://home/');
if (window.matchMedia('(prefers-color-scheme: light)').matches) document.body.classList.add('light');
