// ==UserScript==
// @name         Ad Hider for X
// @namespace    dievilstr
// @author       dievilstr
// @version      1.0.0
// @description  Hides promoted posts, Premium popups and sidebar clutter on x.com. Userscript version of the Chrome extension, for Safari on iPhone/iPad.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.x.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

// Логика детекта скопирована из content.js — правки в одном месте переносите и в другое.
// Блокировки рекламодателей тут нет: она живёт в Chrome-расширении и через аккаунт действует везде.

(() => {
  'use strict';

  // ---------- Настройки: true — включено, false — выключено ----------
  const SETTINGS = {
    hide: true,          // Скрывать рекламные посты, тренды и аккаунты
    debug: false,        // Не скрывать рекламу, а обводить красным
    closeUpsells: true,  // Закрывать окна «Перейти на Plus» / Premium
    // Правая колонка (есть только в «настольной версии» сайта)
    hidePremium: true,   // «Подпишитесь на Premium»
    hideTrends: false,   // «Что происходит»
    hideFollow: false,   // «Кого читать»
    hideOther: true,     // Другие блоки: спорт, события…
    hideSearch: false,   // Поиск
  };

  // Метка рекламы в шапке поста на разных языках интерфейса X (сравнение без учёта регистра)
  const AD_LABELS = new Set([
    'ad', 'ads', 'promoted',
    'реклама', 'продвигается',
    'anzeige', 'gesponsert',
    'publicidad', 'promocionado',
    'annonce', 'sponsorisé',
    'pubblicità', 'sponsorizzato',
    'reklam', 'reklama', 'promowane',
    'patrocinado', 'promovido',
    '広告', 'プロモーション',
  ]);
  // Промо-тренд подписан «Promoted by <рекламодатель>», причём по-английски даже в русском интерфейсе
  const PROMOTED_BY = /^promoted by(\s|$)/;

  const CANDIDATES = 'article[data-testid="tweet"], [data-testid="trend"], [data-testid="UserCell"]';
  // Текст поста, имя автора и превью ссылок — там слово "Ad" может встретиться случайно
  const EXCLUDE = '[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="card.wrapper"], [data-testid="UserDescription"]';

  // Правая колонка: каждый блок X — отдельный <aside> или <section>, поиск — форма, футер — <nav>
  const SIDEBAR_KEYS = ['hidePremium', 'hideTrends', 'hideFollow', 'hideOther', 'hideSearch'];
  const SIDEBAR_SEARCH = 'form[role="search"]';
  const PREMIUM_LINK = 'a[href^="/i/premium"]:not([data-testid="UserCell"] *)';

  // Кнопка в окне-предложении подписки («Перейти на Plus», «Get Premium»): названия тарифов X не переводит
  const UPSELL_BUTTON = /\b(premium\+?|plus)\b/i;
  const DIALOG_CLOSE = '[data-testid="app-bar-close"], [data-testid="confirmationSheetCancel"]';

  const CSS = `
    html.xab-hide:not(.xab-debug) [data-xab-ad="cell"] > * { display: none !important; }
    html.xab-hide:not(.xab-debug) [data-xab-ad="self"] { display: none !important; }
    html.xab-debug [data-xab-ad] { outline: 3px solid #f4212e !important; outline-offset: -3px; }
    ${SIDEBAR_KEYS.map((key) => `html.xab-${key} [data-xab-side="${key}"]`).join(',\n    ')} {
      display: none !important;
    }
  `;

  let scanScheduled = false;

  // ---------- Детект рекламы ----------

  function hasAdLabel(el) {
    for (const span of el.querySelectorAll('span')) {
      if (span.childElementCount) continue;
      const text = span.textContent.trim().toLowerCase();
      if (!text) continue;
      const isLabel = (text.length <= 20 && AD_LABELS.has(text)) || PROMOTED_BY.test(text);
      if (!isLabel || span.closest(EXCLUDE)) continue;
      return true;
    }
    return false;
  }

  function scan() {
    scanScheduled = false;
    for (const el of document.querySelectorAll(CANDIDATES)) {
      const cell = el.closest('[data-testid="cellInnerDiv"]');
      const target = cell || el;
      if (hasAdLabel(el)) {
        target.dataset.xabAd = cell ? 'cell' : 'self';
      } else if (target.dataset.xabAd) {
        // X переиспользует DOM-ячейки при скролле — снимаем метку, если там уже не реклама
        delete target.dataset.xabAd;
      }
    }
    markSidebar();
    closeUpsells();
  }

  // ---------- Окна Premium ----------

  function isUpsell(dialog) {
    if (dialog.querySelector('a[href^="/i/premium"]')) return true;
    for (const span of dialog.querySelectorAll('a span, button span, [role="button"] span')) {
      if (span.childElementCount || span.closest(EXCLUDE)) continue;
      if (UPSELL_BUTTON.test(span.textContent)) return true;
    }
    return false;
  }

  // Не прячем через CSS: X блокирует прокрутку и кладёт затемнение, поэтому закрываем окно его же кнопкой
  function closeUpsells() {
    if (!SETTINGS.closeUpsells) return;
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (dialog.dataset.xabUpsell || !isUpsell(dialog)) continue;
      dialog.dataset.xabUpsell = '1';
      const close = dialog.querySelector(DIALOG_CLOSE);
      if (close) close.click();
      else dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
  }

  // ---------- Правая колонка ----------

  // Поднимаемся до рамки карточки: пока у родителя нет других детей, скрытие родителя ничего лишнего не заденет
  function cardOf(el, root) {
    while (el.parentElement && el.parentElement !== root && el.parentElement.childElementCount === 1) {
      el = el.parentElement;
    }
    return el;
  }

  // Обёртка вокруг нескольких блоков, а не сам блок — её не трогаем
  const isWrapper = (el) => Boolean(el.querySelector(`${SIDEBAR_SEARCH}, nav`));

  function sidebarModules(side) {
    const modules = [];
    for (const el of side.querySelectorAll('aside, section')) {
      if (isWrapper(el)) continue;
      const outer = el.parentElement.closest('aside, section');
      if (outer && side.contains(outer) && !isWrapper(outer)) continue; // вложенная часть другого блока
      modules.push(el);
    }
    return modules;
  }

  // Всё, что не узнали (спорт, трансляции, события и что X добавит потом), — «другие блоки»
  function classifyModule(module) {
    if (module.querySelector(PREMIUM_LINK)) return 'hidePremium';
    if (module.querySelector('[data-testid="UserCell"]')) return 'hideFollow';
    if (module.querySelector('[data-testid="trend"]')) return 'hideTrends';
    return 'hideOther';
  }

  function markSidebar() {
    const side = document.querySelector('[data-testid="sidebarColumn"]');
    const marked = new Map();
    if (side) {
      for (const module of sidebarModules(side)) marked.set(cardOf(module, side), classifyModule(module));
      // Виджеты-«плейсменты» (счёт матчей и т. п.) — простой div, внутри которого метка вида mlb_scores_sidebar
      for (const tag of side.querySelectorAll('[data-testid$="_sidebar"]')) {
        const card = tag.parentElement;
        if (card && card !== side && !isWrapper(card)) marked.set(cardOf(card, side), 'hideOther');
      }
      const search = side.querySelector(SIDEBAR_SEARCH);
      if (search) marked.set(cardOf(search, side), 'hideSearch');
    }
    for (const el of document.querySelectorAll('[data-xab-side]')) {
      if (!marked.has(el)) delete el.dataset.xabSide;
    }
    for (const [el, key] of marked) {
      if (el.dataset.xabSide !== key) el.dataset.xabSide = key;
    }
  }

  // ---------- Запуск ----------

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(scan, 100);
  }

  const root = document.documentElement;
  root.classList.toggle('xab-hide', SETTINGS.hide);
  root.classList.toggle('xab-debug', SETTINGS.debug);
  for (const key of SIDEBAR_KEYS) root.classList.toggle(`xab-${key}`, SETTINGS[key]);

  const style = document.createElement('style');
  style.textContent = CSS;
  (document.head || root).append(style);

  new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
  scheduleScan();
})();
