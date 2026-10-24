(() => {
  'use strict';

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

  // Публичный bearer-токен веб-клиента X (он же зашит в JS самого сайта)
  const BEARER =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

  const BLOCK_DELAY_MS = 5000;
  const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;

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

  let settings = {
    hide: true, autoBlock: false, debug: false, closeUpsells: true,
    hidePremium: true, hideTrends: false, hideFollow: false, hideOther: true, hideSearch: false,
  };
  const counted = new WeakSet();
  let scanScheduled = false;
  let observer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = () => Boolean(chrome.runtime?.id);

  // ---------- Детект ----------

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

  function getHandle(article) {
    const link = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
    const m = link?.getAttribute('href').match(/^\/([A-Za-z0-9_]{1,15})(?:$|[/?])/);
    return m ? m[1] : null;
  }

  function scan() {
    scanScheduled = false;
    if (!alive()) {
      observer?.disconnect();
      return;
    }
    for (const el of document.querySelectorAll(CANDIDATES)) {
      const cell = el.closest('[data-testid="cellInnerDiv"]');
      const target = cell || el;
      if (hasAdLabel(el)) {
        target.dataset.xabAd = cell ? 'cell' : 'self';
        if (!counted.has(el)) {
          counted.add(el);
          onAdFound(el);
        }
      } else if (target.dataset.xabAd) {
        // X переиспользует DOM-ячейки при скролле — снимаем метку, если там уже не реклама
        delete target.dataset.xabAd;
      }
    }
    markSidebar();
    closeUpsells();
  }

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
    if (!settings.closeUpsells) return;
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (dialog.dataset.xabUpsell || !isUpsell(dialog)) continue;
      dialog.dataset.xabUpsell = '1';
      const close = dialog.querySelector(DIALOG_CLOSE);
      if (close) close.click();
      else dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
  }

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

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(scan, 100);
  }

  function onAdFound(el) {
    bumpHidden();
    if (el.matches('article[data-testid="tweet"]')) {
      const handle = getHandle(el);
      if (handle) recordAdvertiser(handle);
    }
  }

  // ---------- Хранилище ----------

  let unsavedHidden = 0;
  let flushTimer = null;

  function bumpHidden() {
    unsavedHidden++;
    if (!flushTimer) flushTimer = setTimeout(flushHidden, 2000);
  }

  async function flushHidden() {
    flushTimer = null;
    const n = unsavedHidden;
    unsavedHidden = 0;
    if (!alive()) return;
    const { stats = {} } = await chrome.storage.local.get('stats');
    stats.hidden = (stats.hidden || 0) + n;
    await chrome.storage.local.set({ stats });
  }

  // Последовательные read-modify-write, чтобы параллельные находки не затирали друг друга
  let advertisersChain = Promise.resolve();
  function updateAdvertisers(mutate) {
    advertisersChain = advertisersChain
      .then(async () => {
        if (!alive()) return;
        const { advertisers = {} } = await chrome.storage.local.get('advertisers');
        mutate(advertisers);
        await chrome.storage.local.set({ advertisers });
      })
      .catch((e) => console.warn('[Ad Hider for X]', e));
    return advertisersChain;
  }

  function recordAdvertiser(handle) {
    const key = handle.toLowerCase();
    return updateAdvertisers((advertisers) => {
      const entry = advertisers[key] || { handle, firstSeen: Date.now(), count: 0, status: 'seen' };
      entry.count++;
      entry.lastSeen = Date.now();
      if (settings.autoBlock && entry.status === 'seen') entry.status = 'pending';
      advertisers[key] = entry;
    });
  }

  // ---------- Блокировка ----------

  async function blockUser(screenName) {
    const ct0 = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
    if (!ct0) return { ok: false, error: chrome.i18n.getMessage('errNoCt0') };
    try {
      const res = await fetch(`${location.origin}/i/api/1.1/blocks/create.json`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          authorization: `Bearer ${BEARER}`,
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ screen_name: screenName }),
      });
      if (res.status === 429) return { ok: false, rateLimited: true };
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  const queue = [];
  let working = false;
  let pausedUntil = 0;

  function enqueuePending(advertisers) {
    for (const [key, a] of Object.entries(advertisers)) {
      if (a.status === 'pending' && !queue.includes(key)) queue.push(key);
    }
    processQueue();
  }

  async function processQueue() {
    if (working) return;
    working = true;
    try {
      while (queue.length && alive()) {
        const wait = pausedUntil - Date.now();
        if (wait > 0) await sleep(wait);

        const key = queue.shift();
        const { advertisers = {} } = await chrome.storage.local.get('advertisers');
        const entry = advertisers[key];
        if (!entry || entry.status !== 'pending') continue;

        const result = await blockUser(entry.handle);
        if (result.rateLimited) {
          pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
          queue.unshift(key);
          continue;
        }
        await updateAdvertisers((all) => {
          const a = all[key];
          if (!a) return;
          a.status = result.ok ? 'blocked' : 'failed';
          a.error = result.error || null;
          if (result.ok) a.blockedAt = Date.now();
        });
        await sleep(BLOCK_DELAY_MS + Math.random() * 3000);
      }
    } finally {
      working = false;
    }
  }

  // ---------- Настройки и запуск ----------

  function applySettings() {
    const root = document.documentElement;
    root.classList.toggle('xab-hide', settings.hide);
    root.classList.toggle('xab-debug', settings.debug);
    for (const key of SIDEBAR_KEYS) root.classList.toggle(`xab-${key}`, settings[key]);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
      applySettings();
    }
    if (changes.advertisers?.newValue) enqueuePending(changes.advertisers.newValue);
  });

  (async () => {
    const stored = await chrome.storage.local.get(['settings', 'advertisers']);
    settings = { ...settings, ...stored.settings };
    applySettings();
    enqueuePending(stored.advertisers || {});

    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
  })();
})();
