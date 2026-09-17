/* ═══════════════════════════════════════════════════════════════
   Поведение страниц: появление блоков, заголовок первого экрана, просмотр скриншотов.
   Без библиотек. Сцена на обложке живёт отдельно — hero-field.js.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── Язык ─────────────────────────────────────────────────────
     Английская версия лежит в корне, русская — в /ru/. Страницы
     статичные, из скрипта переводятся только подписи, которые он
     меняет сам. */
  var isRu = (document.documentElement.lang || '').toLowerCase().indexOf('ru') === 0;
  var t = isRu
    ? { pause: 'Остановить анимацию', play: 'Включить анимацию', image: function (i, n) { return 'Изображение ' + i + ' из ' + n; } }
    : { pause: 'Pause animation', play: 'Play animation', image: function (i, n) { return 'Image ' + i + ' of ' + n; } };

  /* ── Переключение языка без прыжков ───────────────────────────
     Раньше переключатель переносил якорь из адреса (#works и т. п.).
     Но якорь остаётся в адресе и после того, как человек ушёл от раздела,
     поэтому новая страница то прыгала вниз к давно покинутому разделу,
     то открывалась в самом верху. Теперь запоминается то, что реально
     на экране: номер блока и доля, на которую он пролистан. Блоки в обеих
     версиях идут в одном порядке. Новая страница прячет содержимое
     (класс is-restoring ставит скрипт в <head>), сразу встаёт на это
     место и только потом показывается — без видимой прокрутки. */
  var RESTORE_KEY = 'webchef-lang-restore';
  var headerOffset = function () {
    var header = document.querySelector('.site-header');
    return (header ? header.offsetHeight : 0) + 16;
  };
  var anchorBlocks = function () {
    return Array.prototype.slice.call(document.querySelectorAll('main section, main article, main nav'));
  };
  // Положение по раскладке, без transform: ещё не проявившиеся блоки
  // (.reveal) сдвинуты на 36px, и getBoundingClientRect дал бы ошибку.
  var layoutBox = function (el) {
    var top = 0;
    for (var node = el; node; node = node.offsetParent) top += node.offsetTop;
    return { top: top, height: el.offsetHeight };
  };

  Array.prototype.forEach.call(document.querySelectorAll('[data-lang-switch]'), function (link) {
    link.addEventListener('click', function () {
      var target = link.href.split('#')[0];
      link.setAttribute('href', link.getAttribute('href').split('#')[0]); // без якоря браузер не прыгает сам
      var state = null;
      var y = window.scrollY;
      var maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (y > 40 && y >= maxY - 2) {
        // долистал до самого низа — внизу и остаёмся, даже если текст другой длины
        state = { url: target, bottom: true, t: Date.now() };
      } else if (y > 40) {
        var line = y + headerOffset();
        var inside = null;
        var above = null;
        anchorBlocks().forEach(function (block, i, all) {
          var box = layoutBox(block);
          if (!box.height) return;
          var top = box.top;
          var bottom = top + box.height;
          if (top <= line && line < bottom) {
            // вложенные блоки идут позже родителя — в итоге берётся самый глубокий
            inside = { index: i, count: all.length, ratio: (line - top) / box.height, extra: 0 };
          } else if (bottom <= line && (!above || bottom >= above.bottom)) {
            // линия попала в отступ между блоками — считаем от ближайшего блока выше
            above = { index: i, count: all.length, ratio: 1, extra: line - bottom, bottom: bottom };
          }
        });
        var hit = inside || above;
        if (hit) state = { url: target, index: hit.index, count: hit.count, ratio: hit.ratio, extra: hit.extra, t: Date.now() };
      }
      try {
        if (state) sessionStorage.setItem(RESTORE_KEY, JSON.stringify(state));
        else sessionStorage.removeItem(RESTORE_KEY);
      } catch (err) { /* без хранилища страница просто откроется сверху */ }
    });
  });

  (function restorePosition() {
    var root = document.documentElement;
    var state = null;
    try {
      state = JSON.parse(sessionStorage.getItem(RESTORE_KEY) || 'null');
      sessionStorage.removeItem(RESTORE_KEY);
    } catch (err) { state = null; }
    var here = location.href.split('#')[0].split('?')[0];
    if (!state || state.url.split('?')[0] !== here || Date.now() - state.t > 15000) {
      root.classList.remove('is-restoring');
      return;
    }
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    var touched = false;
    var observer = null;
    var stopTracking = function () {
      touched = true;
      if (observer) observer.disconnect();
    };
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) {
      window.addEventListener(type, stopTracking, { passive: true, once: true });
    });

    var apply = function () {
      if (touched) return;
      var top;
      if (state.bottom) {
        top = root.scrollHeight - window.innerHeight;
      } else {
        var blocks = anchorBlocks();
        if (blocks.length !== state.count || !blocks[state.index]) return;
        var box = layoutBox(blocks[state.index]);
        top = box.top + state.ratio * box.height + (state.extra || 0) - headerOffset();
      }
      window.scrollTo({ top: Math.max(0, Math.round(top)), left: 0, behavior: 'instant' });
    };
    var shown = false;
    var reveal = function () {
      if (shown) return;
      shown = true;
      apply();
      root.classList.remove('is-restoring');
    };

    apply();
    // Веб-шрифты догружаются уже после разметки и меняют высоту текста выше экрана.
    // Показываем страницу, когда они готовы (но не дольше 0,9 с), чтобы не было
    // видимой поправки положения.
    requestAnimationFrame(function () {
      if (document.fonts && document.fonts.status === 'loading') {
        document.fonts.ready.then(reveal);
        setTimeout(reveal, 900);
      } else {
        reveal();
      }
    });
    // Если что-то выше ещё сдвинется (шрифт, картинка), держим место —
    // пока человек сам не начал листать и не дольше 3 секунд.
    if ('ResizeObserver' in window) {
      observer = new ResizeObserver(apply);
      observer.observe(document.body);
      setTimeout(function () { observer.disconnect(); }, 3000);
    }
    window.addEventListener('load', function () {
      apply();
      if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
    }, { once: true });
  })();

  /* ── Появление при прокрутке ──────────────────────────────────
     Один раз на блок: повторная анимация при каждом проходе мимо
     мешала бы читать. Без IntersectionObserver всё видно сразу. */
  var reveals = document.querySelectorAll('.reveal, .wipe');
  if ('IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (el) { revealObserver.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ── Заголовок первого экрана ────────────────────────────────
     Строки выезжают из-под маски, когда шрифты уже загружены, —
     иначе анимация проиграется на запасном шрифте и дёрнется при замене. */
  var ready = function () { requestAnimationFrame(function () { document.body.classList.add('is-ready'); }); };
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 700); })]).then(ready);
  } else {
    ready();
  }

  /* ── Остановить анимацию ──────────────────────────────────────
     Сцена на первом экране и плавающие плашки движутся дольше 5 секунд —
     их можно остановить. Выбор запоминается в браузере. */
  var motionToggle = document.querySelector('[data-motion-toggle]');
  var setMotion = function (paused, save) {
    document.body.classList.toggle('motion-paused', paused);
    if (motionToggle) {
      motionToggle.setAttribute('aria-pressed', String(paused));
      motionToggle.querySelector('.motion-toggle__label').textContent = paused ? t.play : t.pause;
    }
    window.dispatchEvent(new CustomEvent('webchef:motion', { detail: { paused: paused } }));
    if (save) {
      try { localStorage.setItem('webchef-motion-paused', paused ? '1' : '0'); } catch (err) { /* без хранилища выбор живёт до перезагрузки */ }
    }
  };
  var savedPaused = false;
  try { savedPaused = localStorage.getItem('webchef-motion-paused') === '1'; } catch (err) { savedPaused = false; }
  if (savedPaused) setMotion(true, false);
  if (motionToggle) {
    motionToggle.addEventListener('click', function () {
      setMotion(motionToggle.getAttribute('aria-pressed') !== 'true', true);
    });
  }

  /* ── Плавный переход к разделу ─────────────────────────────────
     По нажатию на ссылку внутри страницы не прыгаем, а быстро и плавно
     доезжаем. Нативный scroll-behavior: smooth в разных браузерах идёт
     по-разному и на дальних переходах тянется дольше секунды, поэтому
     длительность задана явно: 0,45–0,8 с в зависимости от расстояния,
     кривая easeInOutCubic. Колесо, касание или клавиша прерывают переход —
     страница не спорит с человеком. При «уменьшить движение» переход
     короткий, 0,25 с, без долгого проезда. */
  var root = document.documentElement;
  var scrolling = null;

  function easeInOutCubic(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  function smoothScrollTo(target, hash) {
    var header = document.querySelector('.site-header');
    var offset = (header ? header.offsetHeight : 0) + 12;
    var startY = window.scrollY;
    var maxY = root.scrollHeight - window.innerHeight;
    var endY = Math.max(0, Math.min(target.getBoundingClientRect().top + startY - offset, maxY));
    var dist = endY - startY;
    if (hash && history.pushState) history.pushState(null, '', hash);
    if (scrolling) scrolling.stop();
    if (Math.abs(dist) < 2) return focusTarget(target);

    var duration = reduceMotion.matches ? 250 : Math.min(800, Math.max(450, 320 + Math.abs(dist) * 0.1));
    var t0 = performance.now();
    var stopped = false;
    var interrupt = function () { stop(); };
    var stop = function () {
      stopped = true;
      root.style.scrollBehavior = '';
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('touchstart', interrupt);
      window.removeEventListener('keydown', interrupt);
      scrolling = null;
    };
    root.style.scrollBehavior = 'auto'; // иначе CSS-плавность будет спорить с кадрами
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchstart', interrupt, { passive: true });
    window.addEventListener('keydown', interrupt);
    scrolling = { stop: stop };

    (function frame(now) {
      if (stopped) return;
      var p = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, startY + dist * easeInOutCubic(p));
      if (p < 1) requestAnimationFrame(frame);
      else { stop(); focusTarget(target); }
    })(t0);
  }

  // Фокус переезжает к разделу, чтобы следующий Tab шёл оттуда, а не с кнопки.
  function focusTarget(target) {
    if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: true });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var hash = link.getAttribute('href');
    if (hash.length < 2) return;
    var target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    smoothScrollTo(target, hash);
  });

  /* ── Просмотр работ ───────────────────────────────────────────
     Один диалог на все галереи. Данные — JSON в #gallery-data:
     { key: { title, images: [{ src, w, h, caption, widths? }] } }.
     src — путь без суффикса ширины: к нему добавляется -800.jpg / -1600.jpg. */
  var dataEl = document.getElementById('gallery-data');
  var dialog = document.getElementById('lightbox');
  if (!dataEl || !dialog) return;

  var galleries = JSON.parse(dataEl.textContent);
  var ui = {
    title: dialog.querySelector('.lb-title'),
    counter: dialog.querySelector('.lb-counter'),
    close: dialog.querySelector('.lb-close'),
    prev: dialog.querySelector('.lb-prev'),
    next: dialog.querySelector('.lb-next'),
    viewport: dialog.querySelector('.lb-viewport'),
    track: dialog.querySelector('.lb-track'),
    img: dialog.querySelector('.lb-img'),
    caption: dialog.querySelector('.lb-caption'),
    dots: dialog.querySelector('.lb-dots')
  };
  var state = { gallery: null, index: 0, busy: false, trigger: null };

  function widthsOf(item) { return item.widths || [800, 1600]; }
  function srcFor(item, w) { return item.src + '-' + w + '.jpg'; }

  function setImage(item) {
    var ws = widthsOf(item);
    ui.img.width = item.w;
    ui.img.height = item.h;
    ui.img.alt = item.caption || state.gallery.title;
    ui.img.srcset = ws.map(function (w) { return srcFor(item, w) + ' ' + w + 'w'; }).join(', ');
    ui.img.sizes = '(max-width: 600px) 100vw, 1100px';
    ui.img.src = srcFor(item, ws[ws.length - 1]);
  }

  function preload(i) {
    var items = state.gallery.images;
    var item = items[(i + items.length) % items.length];
    var ws = widthsOf(item);
    var probe = new Image();
    probe.sizes = '(max-width: 600px) 100vw, 1100px';
    probe.srcset = ws.map(function (w) { return srcFor(item, w) + ' ' + w + 'w'; }).join(', ');
  }

  function renderMeta() {
    var items = state.gallery.images;
    var item = items[state.index];
    ui.counter.textContent = (state.index + 1) + ' / ' + items.length;
    ui.caption.textContent = item.caption || '';
    Array.prototype.forEach.call(ui.dots.children, function (dot, i) {
      if (i === state.index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    if (items.length > 1) { preload(state.index + 1); preload(state.index - 1); }
  }

  function buildDots() {
    ui.dots.textContent = '';
    var items = state.gallery.images;
    items.forEach(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lb-dot';
      b.setAttribute('aria-label', t.image(i + 1, items.length));
      b.addEventListener('click', function () { go(i - state.index); });
      ui.dots.appendChild(b);
    });
  }

  function open(key, index, trigger) {
    var gallery = galleries[key];
    if (!gallery) return;
    state.gallery = gallery;
    state.index = index || 0;
    state.trigger = trigger || null;
    ui.title.textContent = gallery.title;
    dialog.classList.toggle('is-single', gallery.images.length < 2);
    buildDots();
    setImage(gallery.images[state.index]);
    renderMeta();
    ui.track.style.transform = '';
    ui.track.style.opacity = '';

    document.documentElement.classList.add('lb-lock');
    dialog.showModal();
    dialog.dataset.state = '';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { dialog.dataset.state = 'open'; });
    });
  }

  function close() {
    if (dialog.dataset.state === 'closing' || !dialog.open) return;
    dialog.dataset.state = 'closing';
    var done = function () {
      dialog.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
      if (!dialog.open) return;
      dialog.close();
      dialog.dataset.state = '';
      document.documentElement.classList.remove('lb-lock');
      if (state.trigger && document.contains(state.trigger)) state.trigger.focus({ preventScroll: true });
    };
    var onEnd = function (e) { if (e.target === dialog) done(); };
    dialog.addEventListener('transitionend', onEnd);
    var timer = setTimeout(done, 320); // на случай, если transitionend не придёт
  }

  /* Листание: старый кадр уходит в сторону жеста, новый приходит
     с противоположной. Уход короче прихода — ответ на действие
     должен начинаться сразу. При «уменьшить движение» — только прозрачность. */
  function go(delta, fromX) {
    var items = state.gallery.images;
    if (!delta || items.length < 2 || state.busy) return;
    state.busy = true;
    var dir = delta > 0 ? 1 : -1;
    var target = (state.index + delta + items.length) % items.length;
    var still = reduceMotion.matches || !ui.track.animate;
    var shift = still ? 0 : 56;

    var leave = ui.track.animate
      ? ui.track.animate(
          [{ transform: 'translateX(' + (fromX || 0) + 'px)', opacity: 1 },
           { transform: 'translateX(' + (-dir * shift + (fromX || 0) * 0.5) + 'px)', opacity: 0 }],
          { duration: still ? 120 : 140, easing: 'cubic-bezier(.22,.8,.38,1)', fill: 'forwards' }).finished
      : Promise.resolve();

    leave.then(function () {
      state.index = target;
      setImage(items[target]);
      renderMeta();
      var ready = ui.img.decode ? ui.img.decode().catch(function () {}) : Promise.resolve();
      return ready;
    }).then(function () {
      ui.track.getAnimations && ui.track.getAnimations().forEach(function (a) { a.cancel(); });
      if (!ui.track.animate) { state.busy = false; return; }
      return ui.track.animate(
        [{ transform: 'translateX(' + dir * shift + 'px)', opacity: 0 },
         { transform: 'translateX(0)', opacity: 1 }],
        { duration: still ? 160 : 260, easing: 'cubic-bezier(.22,.8,.38,1)' }).finished;
    }).then(function () { state.busy = false; }, function () { state.busy = false; });
  }

  /* Свайп на телефоне: кадр идёт за пальцем 1:1. Отпустили —
     решаем по скорости и расстоянию; отмена возвращает кадр пружиной
     с критическим затуханием, стартуя с текущей скорости пальца. */
  var drag = null;
  ui.viewport.addEventListener('pointerdown', function (e) {
    if (state.busy || state.gallery.images.length < 2 || e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, locked: false, history: [] };
  });
  ui.viewport.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0;
    var dy = e.clientY - drag.y0;
    if (!drag.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; // порог, чтобы не спутать с тапом
      if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      drag.locked = true;
      ui.viewport.setPointerCapture(e.pointerId);
    }
    drag.dx = dx;
    drag.history.push({ x: e.clientX, t: e.timeStamp });
    if (drag.history.length > 5) drag.history.shift();
    ui.track.style.transform = 'translateX(' + dx + 'px)';
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.locked) return;
    var h = d.history;
    var v = h.length > 1 ? (h[h.length - 1].x - h[0].x) / Math.max(1, h[h.length - 1].t - h[0].t) : 0; // px/мс
    var commit = Math.abs(d.dx) > 70 || (Math.abs(v) > 0.45 && Math.sign(v) === Math.sign(d.dx));
    if (commit) {
      ui.track.style.transform = '';
      go(d.dx < 0 ? 1 : -1, d.dx);
    } else {
      springBack(d.dx, v * 1000);
    }
  }
  ui.viewport.addEventListener('pointerup', endDrag);
  ui.viewport.addEventListener('pointercancel', endDrag);

  function springBack(x, velocity) {
    var omega = (2 * Math.PI) / 0.35;
    var last = performance.now();
    (function frame(now) {
      if (drag) return; // палец снова на кадре — пружина уступает жесту
      var dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      velocity += (-omega * omega * x - 2 * omega * velocity) * dt;
      x += velocity * dt;
      if (Math.abs(x) < 0.5 && Math.abs(velocity) < 5) { ui.track.style.transform = ''; return; }
      ui.track.style.transform = 'translateX(' + x + 'px)';
      requestAnimationFrame(frame);
    })(last);
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-gallery]');
    if (!trigger) return;
    e.preventDefault();
    open(trigger.getAttribute('data-gallery'), parseInt(trigger.getAttribute('data-index') || '0', 10), trigger);
  });
  ui.close.addEventListener('click', close);
  ui.prev.addEventListener('click', function () { go(-1); });
  ui.next.addEventListener('click', function () { go(1); });
  dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) close(); // клик мимо кадра
  });
  dialog.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
})();
