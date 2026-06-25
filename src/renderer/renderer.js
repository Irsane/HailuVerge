'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let state = { servers: [], subscriptions: [], favorites: [], settings: {}, routing: {}, activeServerId: null, status: {} };
let uptimeTimer = null;
let measuring = false;
let sortMode = 'default';

/* ---------- inline SVG icons (Lucide-style; no emoji in UI controls) ---------- */
const ICONS = {
  bolt:     '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  globe:    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  star:     '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  route:    '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  settings: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  logs:     '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  pulse:    '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  lock:     '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  arrow:    '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  target:   '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  shield:   '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  plus:     '<path d="M5 12h14"/><path d="M12 5v14"/>',
  folder:   '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  refresh:  '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  palette:  '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  check:    '<path d="M20 6 9 17l-5-5"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'
};

/* ---------- color themes ---------- */
const THEMES = [
  { id: 'indigo',  name: 'Индиго',  c1: '#5b7cfa', c2: '#8b5cff' },
  { id: 'emerald', name: 'Изумруд', c1: '#10b981', c2: '#06b6d4' },
  { id: 'sunset',  name: 'Закат',   c1: '#f97316', c2: '#f43f5e' },
  { id: 'rose',    name: 'Роза',    c1: '#f43f5e', c2: '#ec4899' },
  { id: 'cyan',    name: 'Циан',    c1: '#06b6d4', c2: '#3b82f6' },
  { id: 'violet',  name: 'Фиолет',  c1: '#a855f7', c2: '#6366f1' },
  { id: 'daylight', name: 'Дневная', c1: '#e9edf7', c2: '#aab6d6' }
];
function applyTheme(id) {
  document.documentElement.dataset.theme = THEMES.some((t) => t.id === id) ? id : 'indigo';
}
function renderThemes() {
  const grid = $('#themeGrid');
  if (!grid) return;
  const current = state.settings.theme || 'indigo';
  grid.innerHTML = '';
  THEMES.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = 'theme-card' + (t.id === current ? ' selected' : '');
    btn.style.setProperty('--sw1', t.c1);
    btn.style.setProperty('--sw2', t.c2);
    btn.innerHTML = `
      <span class="theme-sw"><span class="theme-check">${icon('check')}</span></span>
      <span class="theme-name">${t.name}</span>`;
    btn.addEventListener('click', () => setTheme(t.id));
    grid.appendChild(btn);
  });
}
async function setTheme(id) {
  applyTheme(id);
  state.settings.theme = id;
  renderThemes();
  state.settings = await window.hv.saveSettings({ theme: id });
}

/* ---------- appearance (live design toggles) ---------- */
function applyAppearance(s) {
  const r = document.documentElement;
  r.dataset.anim = s.bgAnimation === false ? 'off' : 'on';
  r.dataset.glass = s.glass === false ? 'off' : 'on';
  r.dataset.density = s.density === 'compact' ? 'compact' : 'comfortable';
  r.dataset.radius = ['sharp', 'soft', 'round'].includes(s.uiRadius) ? s.uiRadius : 'soft';
}
function setSeg(sel, val) {
  $$(`${sel} button`).forEach((b) => b.classList.toggle('active', b.dataset.val === val));
}
// Persist one appearance setting and re-apply instantly.
async function setAppearance(patch) {
  Object.assign(state.settings, patch);
  applyAppearance(state.settings);
  state.settings = await window.hv.saveSettings(patch);
}
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
// Fill every [data-icon] placeholder in static markup.
function injectIcons() {
  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}

/* ---------- country flags ---------- */
// Build a flag emoji from a 2-letter ISO code (rendered via the flag font).
function flagFromISO(cc) {
  if (!cc || cc.length !== 2) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
// Map country names (RU + EN keywords) to ISO codes for subscriptions that
// spell out the location instead of using a flag emoji.
const COUNTRY_MAP = [
  ['росси', 'RU'], ['russia', 'RU'], ['москва', 'RU'], ['moscow', 'RU'], ['спб', 'RU'], ['питер', 'RU'],
  ['великобритан', 'GB'], ['англия', 'GB'], ['британ', 'GB'], ['london', 'GB'], ['united kingdom', 'GB'], ['uk', 'GB'],
  ['сша', 'US'], ['америк', 'US'], ['united states', 'US'], ['usa', 'US'],
  ['герман', 'DE'], ['germany', 'DE'], ['франкфурт', 'DE'],
  ['нидерланд', 'NL'], ['голланд', 'NL'], ['amsterdam', 'NL'], ['netherl', 'NL'],
  ['швеци', 'SE'], ['sweden', 'SE'], ['stockholm', 'SE'],
  ['финлянд', 'FI'], ['finland', 'FI'], ['helsinki', 'FI'],
  ['франци', 'FR'], ['france', 'FR'], ['paris', 'FR'],
  ['латви', 'LV'], ['latvia', 'LV'], ['riga', 'LV'],
  ['литв', 'LT'], ['эстони', 'EE'], ['польш', 'PL'], ['poland', 'PL'],
  ['япони', 'JP'], ['japan', 'JP'], ['tokyo', 'JP'],
  ['сингапур', 'SG'], ['singapore', 'SG'],
  ['турци', 'TR'], ['turkey', 'TR'], ['istanbul', 'TR'],
  ['канад', 'CA'], ['швейцар', 'CH'], ['испани', 'ES'], ['spain', 'ES'],
  ['итали', 'IT'], ['italy', 'IT'], ['норвег', 'NO'], ['дани', 'DK'], ['чехи', 'CZ'], ['czech', 'CZ'],
  ['австри', 'AT'], ['бельги', 'BE'], ['ирланди', 'IE'], ['украин', 'UA'], ['ukraine', 'UA'],
  ['казахстан', 'KZ'], ['эмират', 'AE'], ['оаэ', 'AE'], ['дубай', 'AE'], ['гонконг', 'HK'], ['hong kong', 'HK'],
  ['корея', 'KR'], ['korea', 'KR'], ['австрали', 'AU'], ['бразили', 'BR'], ['инди', 'IN'], ['india', 'IN'],
  ['китай', 'CN'], ['china', 'CN'], ['армени', 'AM'], ['грузи', 'GE'], ['georgia', 'GE'], ['молдов', 'MD'],
  ['беларус', 'BY'], ['румын', 'RO'], ['болгар', 'BG'], ['серби', 'RS'], ['венгри', 'HU'], ['греци', 'GR'],
  ['португал', 'PT'], ['исланди', 'IS'], ['люксембург', 'LU']
];

const RI = /[\u{1F1E6}-\u{1F1FF}]{2}/u;   // a regional-indicator pair = a flag emoji
// Returns { flag, name } — the flag emoji for the server (if any) and the name
// with any embedded flag stripped out so it isn't shown twice.
function serverFlag(s) {
  const raw = s.name || '';
  const m = raw.match(RI);
  if (m) {
    const name = raw.replace(RI, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—|·]+|[\s\-–—|·]+$/g, '').trim();
    return { flag: m[0], name: name || raw };
  }
  const lower = raw.toLowerCase();
  const hit = COUNTRY_MAP.find(([kw]) => lower.includes(kw));
  if (hit) return { flag: flagFromISO(hit[1]), name: raw };
  if (s.isRussian) return { flag: flagFromISO('RU'), name: raw };
  return { flag: '', name: raw };
}

/* ---------- helpers ---------- */
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function pingClass(ms) {
  if (ms == null) return 'none';
  if (ms < 120) return 'good';
  if (ms < 280) return 'mid';
  return 'bad';
}
function pingText(ms) {
  if (ms != null) return `${ms} мс`;
  return measuring ? '…' : '—';
}

function fmtUptime(start) {
  if (!start) return '—';
  const s = Math.floor((Date.now() - start) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

/* ---------- navigation ---------- */
$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    $$('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $(`#view-${btn.dataset.view}`).classList.add('active');
  });
});

/* ---------- rendering ---------- */
function renderStatus(status) {
  state.status = status || {};
  const running = !!status?.running;
  const connecting = status?.connecting;

  const power = $('#powerBtn');
  power.classList.toggle('on', running);
  power.classList.toggle('off', !running);
  power.classList.toggle('connecting', !!connecting);
  power.closest('.power-wrap').classList.toggle('on', running);

  $('#heroStatus').textContent = connecting ? 'Подключение…' : (running ? 'Подключено' : 'Отключено');
  $('#heroServer').textContent = status?.server ? status.server.name : 'Сервер не выбран';
  $('#statProto').textContent = status?.server ? status.server.protocol.toUpperCase() : '—';

  const active = state.servers.find((s) => s.id === state.activeServerId);

  const side = $('#sideStatus');
  side.classList.toggle('on', running);
  side.classList.toggle('off', !running && !connecting);
  side.classList.toggle('connecting', !!connecting);
  $('#sideStatusText').textContent = connecting ? 'Подключение…' : (running ? 'Подключено' : 'Отключено');

  // Ping + current server in the sidebar status card.
  const sidePing = $('#sidePing');
  sidePing.textContent = running && active && active.latency != null ? `${active.latency} мс` : '';
  const flagEl = $('#sideServerFlag');
  const nameEl = $('#sideServerName');
  if (active) {
    const { flag, name } = serverFlag(active);
    nameEl.textContent = name;
    flagEl.textContent = flag || '';
    flagEl.classList.toggle('show', !!flag);
  } else {
    nameEl.textContent = 'Сервер не выбран';
    flagEl.classList.remove('show');
  }

  $('#statPing').textContent = active ? pingText(active.latency) : '—';

  clearInterval(uptimeTimer);
  if (running && status.startedAt) {
    const tick = () => { $('#statUptime').textContent = fmtUptime(status.startedAt); };
    tick();
    uptimeTimer = setInterval(tick, 1000);
  } else {
    $('#statUptime').textContent = '—';
  }
}

function renderSubscriptions() {
  const wrap = $('#subList');
  wrap.innerHTML = '';
  state.subscriptions.forEach((sub) => {
    const div = document.createElement('div');
    div.className = 'sub-item';
    const when = sub.updatedAt ? new Date(sub.updatedAt).toLocaleString('ru-RU') : '';
    div.innerHTML = `
      <div>
        <div class="sub-name">${escapeHtml(sub.name || sub.url)}</div>
        <div class="sub-meta">${sub.count || 0} серв. · обновлено ${when}</div>
      </div>
      <div class="row-gap">
        <button class="btn btn-ghost btn-sm" data-upd="${encodeURIComponent(sub.url)}">Обновить</button>
        <button class="btn btn-danger btn-sm" data-del="${encodeURIComponent(sub.url)}">Удалить</button>
      </div>`;
    wrap.appendChild(div);
  });

  wrap.querySelectorAll('[data-upd]').forEach((b) =>
    b.addEventListener('click', () => updateSub(decodeURIComponent(b.dataset.upd))));
  wrap.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => removeSub(decodeURIComponent(b.dataset.del))));
}

function isFavorite(id) { return (state.favorites || []).includes(id); }

// Build a single server row (used by both the Servers list and Favorites).
function buildServerRow(s) {
  const div = document.createElement('div');
  div.className = 'server' + (s.id === state.activeServerId ? ' active' : '');
  const isActive = s.id === state.activeServerId && state.status.running;
  const fav = isFavorite(s.id);
  const { flag, name } = serverFlag(s);
  const flagHtml = flag
    ? `<span class="s-flag flag">${flag}</span>`
    : `<span class="s-flag s-flag-none">${icon('globe')}</span>`;
  div.innerHTML = `
    ${isActive ? '<span class="s-active-dot"></span>' : ''}
    ${flagHtml}
    <div class="s-main">
      <div class="s-name">${escapeHtml(name)}</div>
    </div>
    <span class="badge ${s.isRussian ? 'ru' : ''}">${escapeHtml(s.protocol)}</span>
    <span class="ping ${pingClass(s.latency)}">${pingText(s.latency)}</span>
    <button class="s-fav ${fav ? 'on' : ''}" title="${fav ? 'Убрать из избранного' : 'В избранное'}"
            aria-label="${fav ? 'Убрать из избранного' : 'В избранное'}">${icon('star')}</button>`;
  // Clicking the row connects; clicking the star toggles favorite without connecting.
  div.addEventListener('click', () => connect(s.id));
  div.querySelector('.s-fav').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(s.id);
  });
  return div;
}

function sortServers(list) {
  const sorted = [...list];
  if (sortMode === 'ping') {
    sorted.sort((a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity));
  } else if (sortMode === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  return sorted;
}

function renderServers() {
  const wrap = $('#serverList');
  wrap.innerHTML = '';
  if (!state.servers.length) {
    wrap.innerHTML = '<div class="empty">Нет серверов. Добавьте подписку выше.</div>';
    return;
  }
  sortServers(state.servers).forEach((s) => wrap.appendChild(buildServerRow(s)));
}

function renderFavorites() {
  const wrap = $('#favoriteList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const favServers = sortServers(state.servers.filter((s) => isFavorite(s.id)));
  if (!favServers.length) {
    wrap.innerHTML = `
      <div class="empty-rich">
        <div class="empty-ic">${icon('star')}</div>
        <div class="empty-title">Здесь пока пусто</div>
        <div class="empty-sub">Откройте «Серверы» и нажмите ★ у любого сервера, чтобы добавить его в избранное.</div>
      </div>`;
    return;
  }
  favServers.forEach((s) => wrap.appendChild(buildServerRow(s)));
}

async function toggleFavorite(id) {
  const wasFav = isFavorite(id);
  state.favorites = await window.hv.toggleFavorite(id);
  renderServers();
  renderFavorites();
  toast(wasFav ? 'Убрано из избранного' : 'Добавлено в избранное');
}

let appList = [];   // selected application process names (chips)

function renderRouting() {
  const r = state.routing;
  const mode = r.mode || 'global';
  $('#routeMode').value = mode;
  $('#finalOutbound').value = r.finalOutbound || 'proxy';
  $('#blockAds').checked = !!r.blockAds;
  $('#proxyDomains').value = (r.proxyDomains || []).join('\n');
  $('#directDomains').value = (r.directDomains || []).join('\n');
  $('#appMode').value = r.appMode || 'off';
  appList = [...(r.appList || [])];
  renderAppChips();
  applyRouteMode(mode);
}

function renderAppChips() {
  const wrap = $('#appChips');
  if (!appList.length) {
    wrap.innerHTML = '<div class="chips-empty">Программы не выбраны. Добавьте из запущенных или из папки.</div>';
    return;
  }
  wrap.innerHTML = '';
  appList.forEach((name) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${escapeHtml(name)}</span><button class="chip-x" title="Убрать">✕</button>`;
    chip.querySelector('.chip-x').addEventListener('click', () => {
      appList = appList.filter((n) => n !== name);
      renderAppChips();
    });
    wrap.appendChild(chip);
  });
}

function addApps(names) {
  let added = 0;
  names.forEach((n) => {
    if (n && !appList.some((x) => x.toLowerCase() === n.toLowerCase())) { appList.push(n); added++; }
  });
  if (added) renderAppChips();
  return added;
}

// Highlight the chosen mode card and show/hide the rule-only section.
function applyRouteMode(mode) {
  $$('#routeModeChoice .route-card').forEach((c) =>
    c.classList.toggle('selected', c.dataset.mode === mode));
  $('#ruleSettings').style.display = mode === 'rule' ? 'block' : 'none';
}

function renderSettings() {
  const s = state.settings;
  applyTheme(s.theme || 'indigo');
  renderThemes();
  applyAppearance(s);
  $('#bgAnimation').checked = s.bgAnimation !== false;
  $('#glassEffect').checked = s.glass !== false;
  setSeg('#densitySeg', s.density || 'comfortable');
  setSeg('#radiusSeg', s.uiRadius || 'soft');
  $('#autoConnect').checked = !!s.autoConnect;
  $('#minimizeToTray').checked = !!s.minimizeToTray;
  $('#logsEnabled').checked = !!s.logsEnabled;
  $('#allowLan').checked = !!s.allowLan;
  $('#socksPort').value = s.socksPort;
  $('#httpPort').value = s.httpPort;
  $('#coreBinaryPath').value = s.coreBinaryPath || '';
  applyLogsVisibility(!!s.logsEnabled);
  applyConnMode(!!s.tunMode);
  refreshBinaryStatus();
}

// Logs tab visibility follows the setting.
function applyLogsVisibility(enabled) {
  $('#navLogs').style.display = enabled ? '' : 'none';
  if (!enabled) {
    logBox.textContent = '';
    if ($('#navLogs').classList.contains('active')) $('.nav-item[data-view="home"]').click();
  }
}

// Reflect the active connection mode (TUN vs system proxy) on the Home switch.
function applyConnMode(tun) {
  $$('#modeSwitch .mode-opt').forEach((o) =>
    o.classList.toggle('selected', (o.dataset.mode === 'tun') === tun));
}

async function refreshBinaryStatus() {
  const info = await window.hv.checkBinary();
  const el = $('#binaryStatus');
  if (info.exists) {
    el.className = 'binary-status ok';
    el.textContent = `✓ Ядро найдено: ${info.path}`;
  } else {
    el.className = 'binary-status missing';
    el.textContent = `✗ Ядро не найдено. Положите sing-box в: ${info.dir}`;
  }
}

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- actions ---------- */
async function refreshState() {
  state = await window.hv.getState();
  renderSubscriptions();
  renderServers();
  renderFavorites();
  renderRouting();
  renderSettings();
  renderStatus(state.status);
  if (state.servers.length) pingAll(true);   // measure latency on startup
}

async function importSub() {
  const url = $('#subInput').value.trim();
  if (!url) return;
  $('#importBtn').disabled = true;
  $('#importBtn').textContent = 'Загрузка…';
  try {
    const res = await window.hv.importSub(url);
    state.servers = res.servers;
    state.subscriptions = res.subscriptions;
    $('#subInput').value = '';
    renderSubscriptions();
    renderServers();
    toast('Подписка добавлена');
    pingAll(true);             // auto-measure latency for the new servers
  } catch (e) {
    // Maybe it's a raw config link rather than a subscription.
    try {
      state.servers = await window.hv.addLink(url);
      $('#subInput').value = '';
      renderServers();
      toast('Сервер добавлен');
      pingAll(true);
    } catch (e2) {
      toast(e.message || e2.message, true);
    }
  } finally {
    $('#importBtn').disabled = false;
    $('#importBtn').textContent = 'Добавить';
  }
}

async function updateSub(url) {
  try {
    const res = await window.hv.updateSub(url);
    state.servers = res.servers;
    state.subscriptions = res.subscriptions;
    renderSubscriptions();
    renderServers();
    toast('Подписка обновлена');
    pingAll(true);
  } catch (e) { toast(e.message, true); }
}

async function removeSub(url) {
  const res = await window.hv.removeSub(url);
  state.servers = res.servers;
  state.subscriptions = res.subscriptions;
  renderSubscriptions();
  renderServers();
}

async function pingAll(silent = false) {
  if (measuring) return;
  measuring = true;
  $('#pingBtn').disabled = true;
  $('#pingBtn').textContent = 'Проверка…';
  renderServers();              // show "…" placeholders immediately
  renderFavorites();
  try {
    state.servers = await window.hv.pingAll();
  } catch (e) { if (!silent) toast(e.message, true); }
  finally {
    measuring = false;
    $('#pingBtn').disabled = false;
    $('#pingBtn').innerHTML = `${icon('pulse')} Проверить пинг`;
    renderServers();
    renderFavorites();
    renderStatus(state.status);
  }
}

async function connect(serverId) {
  renderStatus({ ...state.status, connecting: true });
  try {
    const status = await window.hv.connect(serverId);
    state.activeServerId = serverId;
    renderStatus(status);
    renderServers();
    toast('Подключено');
  } catch (e) {
    renderStatus({ running: false });
    toast(e.message, true);
  }
}

async function connectBest() {
  renderStatus({ ...state.status, connecting: true });
  try {
    const res = await window.hv.connectBest();
    state.activeServerId = res.serverId;
    renderStatus(res.status);
    renderServers();
    toast('Подключено к лучшему серверу');
  } catch (e) {
    renderStatus({ running: false });
    toast(e.message, true);
  }
}

async function togglePower() {
  if (state.status.running) {
    const status = await window.hv.disconnect();
    renderStatus(status);
    renderServers();
  } else if (state.activeServerId) {
    await connect(state.activeServerId);
  } else {
    await connectBest();
  }
}

async function saveRouting() {
  const routing = {
    mode: $('#routeMode').value,
    finalOutbound: $('#finalOutbound').value,
    blockAds: $('#blockAds').checked,
    proxyDomains: linesOf($('#proxyDomains').value),
    directDomains: linesOf($('#directDomains').value),
    appMode: $('#appMode').value,
    appList: [...appList]
  };
  state.routing = await window.hv.saveRouting(routing);
  flashSaved('#routingSaved');
}

async function saveSettings() {
  const settings = {
    autoConnect: $('#autoConnect').checked,
    minimizeToTray: $('#minimizeToTray').checked,
    logsEnabled: $('#logsEnabled').checked,
    allowLan: $('#allowLan').checked,
    socksPort: Number($('#socksPort').value) || 2080,
    httpPort: Number($('#httpPort').value) || 2081,
    coreBinaryPath: $('#coreBinaryPath').value.trim()
  };
  state.settings = await window.hv.saveSettings(settings);
  applyLogsVisibility(settings.logsEnabled);
  refreshBinaryStatus();
  flashSaved('#settingsSaved');
}

// Switch between TUN and system-proxy from the Home screen. Reconnects if active.
async function setConnMode(tun) {
  state.settings = await window.hv.saveSettings({ tunMode: tun, systemProxy: true });
  applyConnMode(tun);
  toast(tun ? 'Режим: TUN (полный захват)' : 'Режим: системный прокси');
  if (state.status.running && state.activeServerId) {
    renderStatus({ ...state.status, connecting: true });
    try {
      const status = await window.hv.connect(state.activeServerId);
      renderStatus(status);
    } catch (e) { renderStatus({ running: false }); toast(e.message, true); }
  }
}

function linesOf(text) {
  return text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
}
function flashSaved(sel) {
  const el = $(sel);
  el.textContent = '✓ Сохранено';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('show'); }, 2200);
}

/* Ripple effect on buttons */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
});

/* ---------- log ---------- */
const logBox = $('#logBox');
function appendLog(line) {
  if (!state.settings.logsEnabled) return;   // only collect when enabled
  const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
  logBox.textContent += line + '\n';
  if (logBox.textContent.length > 80000) logBox.textContent = logBox.textContent.slice(-60000);
  if (atBottom) logBox.scrollTop = logBox.scrollHeight;
}

/* ---------- wiring ---------- */
$('#importBtn').addEventListener('click', importSub);
$('#subInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') importSub(); });
$('#pingBtn').addEventListener('click', () => pingAll());
$('#pingFavBtn').addEventListener('click', () => pingAll());
$('#sortMode').addEventListener('change', (e) => { sortMode = e.target.value; renderServers(); });
$('#powerBtn').addEventListener('click', togglePower);
$('#bestBtn').addEventListener('click', connectBest);
$('#sideStatus').addEventListener('click', togglePower);   // status card doubles as connect/disconnect

// Appearance toggles — apply & persist immediately for a live preview.
$('#bgAnimation').addEventListener('change', (e) => setAppearance({ bgAnimation: e.target.checked }));
$('#glassEffect').addEventListener('change', (e) => setAppearance({ glass: e.target.checked }));
$$('#densitySeg button').forEach((b) =>
  b.addEventListener('click', () => { setSeg('#densitySeg', b.dataset.val); setAppearance({ density: b.dataset.val }); }));
$$('#radiusSeg button').forEach((b) =>
  b.addEventListener('click', () => { setSeg('#radiusSeg', b.dataset.val); setAppearance({ uiRadius: b.dataset.val }); }));

// Home connection-mode switch (TUN / system proxy)
$$('#modeSwitch .mode-opt').forEach((opt) =>
  opt.addEventListener('click', () => setConnMode(opt.dataset.mode === 'tun')));

// Routing mode choice cards
$$('#routeModeChoice .route-card').forEach((card) =>
  card.addEventListener('click', () => {
    $('#routeMode').value = card.dataset.mode;
    applyRouteMode(card.dataset.mode);
  }));

// Instant logs toggle (also persisted on Save)
$('#logsEnabled').addEventListener('change', async (e) => {
  const on = e.target.checked;
  state.settings.logsEnabled = on;                 // update before applyLogs/appendLog gating
  applyLogsVisibility(on);
  if (on) appendLog('[hailuverge] логи включены — здесь появятся события ядра');
  state.settings = await window.hv.saveSettings({ logsEnabled: on });
});

/* ---------- application picker ---------- */
let pickerApps = [];
const appModal = $('#appModal');

async function openAppPicker() {
  appModal.classList.add('show');
  $('#appSearch').value = '';
  $('#appModalList').innerHTML = '<div class="chips-empty">Загрузка…</div>';
  pickerApps = await window.hv.runningApps();
  renderPickerList('');
}
function closeAppPicker() { appModal.classList.remove('show'); }

function renderPickerList(filter) {
  const list = $('#appModalList');
  const f = filter.trim().toLowerCase();
  const items = pickerApps.filter((n) => !f || n.toLowerCase().includes(f));
  if (!items.length) { list.innerHTML = '<div class="chips-empty">Ничего не найдено.</div>'; return; }
  list.innerHTML = '';
  items.forEach((name) => {
    const already = appList.some((x) => x.toLowerCase() === name.toLowerCase());
    const row = document.createElement('label');
    row.className = 'app-row';
    row.innerHTML = `<input type="checkbox" ${already ? 'checked disabled' : ''} value="${escapeHtml(name)}"><span>${escapeHtml(name)}</span>`;
    list.appendChild(row);
  });
}

$('#pickRunning').addEventListener('click', openAppPicker);
$('#appModalClose').addEventListener('click', closeAppPicker);
$('#appModalRefresh').addEventListener('click', openAppPicker);
$('#appSearch').addEventListener('input', (e) => renderPickerList(e.target.value));
appModal.addEventListener('click', (e) => { if (e.target === appModal) closeAppPicker(); });
$('#appModalAdd').addEventListener('click', () => {
  const picked = $$('#appModalList input:checked:not(:disabled)').map((c) => c.value);
  const n = addApps(picked);
  closeAppPicker();
  if (n) toast(`Добавлено: ${n}`);
});
$('#pickFolder').addEventListener('click', async () => {
  const files = await window.hv.browseApps();
  const n = addApps(files);
  if (n) toast(`Добавлено: ${n}`);
});
$('#saveRouting').addEventListener('click', saveRouting);
$('#saveSettings').addEventListener('click', saveSettings);
$('#openCoreFolder').addEventListener('click', () => window.hv.openCoreFolder());
$('#clearLogs').addEventListener('click', () => { logBox.textContent = ''; });

window.hv.onStatus((s) => { renderStatus(s); renderServers(); renderFavorites(); });
window.hv.onLog((line) => appendLog(line));

injectIcons();   // fill static [data-icon] placeholders (nav, brand, route cards…)
refreshState();
