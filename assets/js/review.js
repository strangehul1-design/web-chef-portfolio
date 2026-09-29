/* Отзыв под контактами: та же форма, что на отдельной странице review-form.
   Отправляет отзыв на сервер digital-reviews (Cloudflare Worker), тот пересылает его в Telegram.
   Сервер принимает запросы только с https://strangehul1-design.github.io - там же живёт портфолио.
   Если отправка не удалась, текст не теряется: форма предлагает отправить его в Telegram или на почту.
   Язык берётся из <html lang>: ru - русские тексты, иначе английские.
   Значения отметок «что понравилось» уходят на сервер по-русски: список должен совпадать с LIKED в worker.js. */
(function () {
  const form = document.getElementById('rv-form');
  if (!form) return;

  const ENDPOINT = 'https://digital-reviews.asiyatort.workers.dev/submit';
  const TELEGRAM = 'tacokingGL1';
  const EMAIL = 'digitalgl1@mail.ru';
  const MIN = 30;
  const BAD_MAX = 2;
  const LIKED_VALUES = ['Сроки', 'Дизайн', 'Общение', 'Результат'];

  const ru = (document.documentElement.lang || '').toLowerCase().startsWith('ru');
  const T = ru ? {
    words: ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично'],
    of5: (i) => `${i} из 5`,
    liked: ['Сроки', 'Дизайн', 'Общение', 'Результат'],
    likedTitle: 'Что понравилось больше всего', badTitle: 'Что не понравилось',
    questions: [
      ['С какой задачей пришли?', 'С какой задачей пришли: какой нужен был сайт и зачем'],
      ['Что получилось?', 'Что получилось в итоге и что изменилось после запуска'],
      ['Что бы улучшили?', 'Что можно было сделать лучше - это тоже важно'],
    ],
    placeholder: 'Расскажите своими словами, как всё прошло',
    empty: `Не короче ${MIN} символов`, enough: 'Длины хватает',
    more: (n) => `Ещё ${n} ${plural(n)}`,
    errRating: 'Поставьте оценку от 1 до 5',
    errShort: (n) => `Отзыв короткий: добавьте ещё ${n} ${plural(n)}`,
    errEmpty: 'Напишите пару слов о том, как всё прошло',
    errName: 'Напишите, как вас подписать',
    send: 'Отправить отзыв', sending: 'Отправляем…',
    msg: { title: 'Отзыв', rating: 'Оценка', liked: 'Понравилось: ', bad: 'Не понравилось: ', site: 'Сайт: ', yes: 'Можно опубликовать в канале', no: 'Не публиковать' },
  } : {
    words: ['', 'Poor', 'So-so', 'Okay', 'Good', 'Excellent'],
    of5: (i) => `${i} of 5`,
    liked: ['Timing', 'Design', 'Communication', 'Result'],
    likedTitle: 'What you liked most', badTitle: 'What you did not like',
    questions: [
      ['What was the task?', 'What task you came with: what website you needed and why'],
      ['How did it turn out?', 'What you got in the end and what changed after launch'],
      ['What would you improve?', 'What could have been done better - that matters too'],
    ],
    placeholder: 'Tell in your own words how it went',
    empty: `At least ${MIN} characters`, enough: 'Long enough',
    more: (n) => `${n} more character${n === 1 ? '' : 's'}`,
    errRating: 'Choose a rating from 1 to 5',
    errShort: (n) => `A bit short: add ${n} more character${n === 1 ? '' : 's'}`,
    errEmpty: 'Write a few words about how it went',
    errName: 'Tell me how to sign your review',
    send: 'Send review', sending: 'Sending…',
    msg: { title: 'Review', rating: 'Rating', liked: 'Liked: ', bad: 'Did not like: ', site: 'Website: ', yes: 'You can publish it in the channel', no: 'Do not publish' },
  };

  function plural(n) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'символ';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'символа';
    return 'символов';
  }

  const $ = (id) => document.getElementById('rv-' + id);
  const text = $('text'), nameEl = $('name'), publish = $('publish'), send = $('send'), stars = $('stars');
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';
  const openedAt = Date.now();
  let rating = 0;
  const isBad = () => rating > 0 && rating <= BAD_MAX;

  // Звёзды - радиокнопки: работают с клавиатуры и экранным диктором
  for (let i = 1; i <= 5; i++) {
    stars.insertAdjacentHTML('beforeend',
      `<input type="radio" name="rating" id="rv-r${i}" value="${i}">` +
      `<label for="rv-r${i}" data-v="${i}" title="${T.words[i]}" aria-label="${T.of5(i)}">${STAR}</label>`);
  }
  function paintStars(v) {
    stars.querySelectorAll('label').forEach((l) => l.classList.toggle('on', +l.dataset.v <= v));
    $('stars-word').textContent = v ? '- ' + T.words[v].toLowerCase() : '';
  }
  stars.addEventListener('change', (e) => {
    const wasBad = isBad();
    rating = +e.target.value;
    paintStars(rating);
    $('err-rating').textContent = '';
    // блок сменил смысл - прежние отметки сбрасываем, чтобы «понравилось» не стало «не понравилось»
    if (isBad() !== wasBad) {
      $('liked-title').textContent = isBad() ? T.badTitle : T.likedTitle;
      $('liked').querySelectorAll('.rv-chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    }
  });
  stars.addEventListener('mouseover', (e) => { const l = e.target.closest('label'); if (l) paintStars(+l.dataset.v); });
  stars.addEventListener('mouseleave', () => paintStars(rating));

  // Отметки: подпись на языке страницы, значение для сервера - по-русски
  $('liked').innerHTML = T.liked.map((s, i) =>
    `<button type="button" class="rv-chip" data-value="${LIKED_VALUES[i]}" aria-pressed="false">${s}</button>`).join('');
  $('liked').addEventListener('click', (e) => {
    const chip = e.target.closest('.rv-chip');
    if (chip) chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
  });
  const likedValues = () => [...$('liked').querySelectorAll('[aria-pressed="true"]')].map((c) => c.dataset.value);
  const likedLabels = () => [...$('liked').querySelectorAll('[aria-pressed="true"]')].map((c) => c.textContent);

  // Вопросы-подсказки меняют только подсказку в поле, в текст ничего не вставляют
  text.placeholder = T.placeholder;
  $('questions').innerHTML = T.questions.map(([q], i) =>
    `<button type="button" class="rv-chip rv-chip--q" data-i="${i}" aria-pressed="false">${q}</button>`).join('');
  $('questions').addEventListener('click', (e) => {
    const chip = e.target.closest('.rv-chip');
    if (!chip) return;
    const on = chip.getAttribute('aria-pressed') !== 'true';
    $('questions').querySelectorAll('.rv-chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', on);
    text.placeholder = on ? T.questions[chip.dataset.i][1] : T.placeholder;
    if (on && text.value.trim() && !/\n\s*$/.test(text.value)) text.value = text.value.replace(/\s+$/, '') + '\n\n';
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  });

  function onText() {
    const len = text.value.trim().length;
    const ok = len >= MIN;
    $('meter').classList.toggle('ok', ok);
    $('meter').firstElementChild.style.width = Math.min(100, len / MIN * 100) + '%';
    $('count').classList.toggle('ok', ok);
    $('count').textContent = len === 0 ? T.empty : ok ? T.enough : T.more(MIN - len);
    if (ok) { $('err-text').textContent = ''; text.classList.remove('invalid'); }
  }
  text.addEventListener('input', onText);
  nameEl.addEventListener('input', () => {
    if (nameEl.value.trim()) { $('err-name').textContent = ''; nameEl.classList.remove('invalid'); }
  });

  function validate() {
    let first = null;
    if (!rating) { $('err-rating').textContent = T.errRating; first = first || $('r1'); }
    const len = text.value.trim().length;
    if (len < MIN) {
      $('err-text').textContent = len ? T.errShort(MIN - len) : T.errEmpty;
      text.classList.add('invalid');
      first = first || text;
    }
    if (!nameEl.value.trim()) {
      $('err-name').textContent = T.errName;
      nameEl.classList.add('invalid');
      first = first || nameEl;
    }
    if (first) first.focus();
    return !first;
  }

  // Текст для запасного пути через Telegram или почту
  function message() {
    const m = T.msg;
    return [
      m.title,
      `${m.rating}: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${T.of5(rating)})`,
      likedLabels().length ? (isBad() ? m.bad : m.liked) + likedLabels().join(', ').toLowerCase() : null,
      '',
      text.value.trim(),
      '',
      `- ${nameEl.value.trim()}`,
      $('site').value.trim() ? m.site + $('site').value.trim() : null,
      publish.checked ? m.yes : m.no,
    ].filter((line) => line !== null).join('\n');
  }

  async function post() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      // обычные поля формы: браузер отправляет их без предварительного запроса
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        body: new URLSearchParams({
          rating,
          text: text.value.trim(),
          name: nameEl.value.trim(),
          liked: likedValues().join(','),
          site: $('site').value.trim(),
          publish: publish.checked ? '1' : '',
          website: $('website').value,
          t: Date.now() - openedAt,
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'not ok');
    } finally {
      clearTimeout(timer);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (send.disabled || !validate()) return;
    $('fail').hidden = true;
    send.disabled = true;
    send.textContent = T.sending;
    try {
      await post();
      form.hidden = true;
      $('done').hidden = false;
      $('done').querySelector('.rv-done__title').focus();
    } catch (err) {
      console.warn('Отзыв не отправлен:', err);
      $('fail-tg').href = `https://t.me/${TELEGRAM}?text=${encodeURIComponent(message())}`;
      $('fail-mail').href = `mailto:${EMAIL}?subject=${encodeURIComponent(T.msg.title)}&body=${encodeURIComponent(message())}`;
      $('fail').hidden = false;
    } finally {
      send.disabled = false;
      send.textContent = T.send;
    }
  });

  onText();
})();
