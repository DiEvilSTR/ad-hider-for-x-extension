const DEFAULTS = {
  hide: true, autoBlock: false, debug: false, closeUpsells: true,
  hidePremium: true, hideTrends: false, hideFollow: false, hideOther: true, hideSearch: false,
};
const STATUS_LABEL = { blocked: 'statusBlocked', pending: 'statusPending', failed: 'statusFailed' };
const BLOCKABLE = new Set(['seen', 'failed']);

const $ = (id) => document.getElementById(id);
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

function localize() {
  document.documentElement.lang = t('@@ui_locale').replace('_', '-');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

async function setSetting(key, value) {
  const settings = await getSettings();
  settings[key] = value;
  await chrome.storage.local.set({ settings });
}

async function markPending(keys) {
  const { advertisers = {} } = await chrome.storage.local.get('advertisers');
  for (const key of keys) {
    if (advertisers[key] && BLOCKABLE.has(advertisers[key].status)) advertisers[key].status = 'pending';
  }
  await chrome.storage.local.set({ advertisers });
}

function renderList(advertisers) {
  const list = $('list');
  list.replaceChildren();
  const entries = Object.entries(advertisers).sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0));

  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('emptyList');
    list.append(li);
  }

  for (const [key, a] of entries) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    const link = document.createElement('a');
    link.href = `https://x.com/${a.handle}`;
    link.target = '_blank';
    link.textContent = `@${a.handle}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = t('impressions', a.count) + (a.error ? ` · ${a.error}` : '');
    info.append(link, meta);
    li.append(info);

    if (BLOCKABLE.has(a.status)) {
      const btn = document.createElement('button');
      btn.textContent = t(a.status === 'failed' ? 'btnRetry' : 'btnBlock');
      btn.addEventListener('click', () => markPending([key]));
      li.append(btn);
    }
    if (STATUS_LABEL[a.status]) {
      const chip = document.createElement('span');
      chip.className = `chip ${a.status}`;
      chip.textContent = t(STATUS_LABEL[a.status]);
      li.append(chip);
    }
    list.append(li);
  }

  const blockable = entries.filter(([, a]) => BLOCKABLE.has(a.status)).map(([key]) => key);
  const blockAll = $('blockAll');
  blockAll.disabled = !blockable.length;
  blockAll.textContent = blockable.length ? t('blockAllCount', blockable.length) : t('blockAll');
  blockAll.onclick = () => markPending(blockable);
}

async function render() {
  const settings = await getSettings();
  const { stats = {}, advertisers = {} } = await chrome.storage.local.get(['stats', 'advertisers']);

  for (const key of Object.keys(DEFAULTS)) $(key).checked = settings[key];
  $('hidden').textContent = stats.hidden || 0;
  $('blocked').textContent = Object.values(advertisers).filter((a) => a.status === 'blocked').length;
  renderList(advertisers);
}

for (const key of Object.keys(DEFAULTS)) {
  $(key).addEventListener('change', (e) => setSetting(key, e.target.checked));
}

localize();
chrome.storage.onChanged.addListener(render);
render();
