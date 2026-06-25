'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let state = { servers: [], subscriptions: [], settings: {}, routing: {}, activeServerId: null, status: {} };
let uptimeTimer = null;
let measuring = false;
let sortMode = 'default';

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

  const side = $('#sideStatus');
  side.classList.toggle('on', running);
  side.classList.toggle('off', !running);
  $('#sideStatusText').textContent = running ? 'Подключено' : 'Отключено';

  const active = state.servers.find((s) => s.id === state.activeServerId);
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

function renderServers() {
  const wrap = $('#serverList');
  wrap.innerHTML = '';
  if (!state.servers.length) {
    wrap.innerHTML = '<div class="empty">Нет серверов. Добавьте подписку выше.</div>';
    return;
  }
  // Sort according to the selected mode. "default" keeps insertion order.
  let sorted = [...state.servers];
  if (sortMode === 'ping') {
    sorted.sort((a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity));
  } else if (sortMode === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  sorted.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'server' + (s.id === state.activeServerId ? ' active' : '');
    const isActive = s.id === state.activeServerId && state.status.running;
    div.innerHTML = `
      ${isActive ? '<span class="s-active-dot"></span>' : ''}
      <div class="s-main">
        <div class="s-name">${escapeHtml(s.name)}</div>
        <div class="s-sub">${escapeHtml(s.server)}:${s.port}</div>
      </div>
      <span class="badge ${s.isRussian ? 'ru' : ''}">${s.protocol}${s.isRussian ? ' · RU' : ''}</span>
      <span class="ping ${pingClass(s.latency)}">${pingText(s.latency)}</span>`;
    div.addEventListener('click', () => connect(s.id));
    wrap.appendChild(div);
  });
}

function renderRouting() {
  const r = state.routing;
  $('#routeMode').value = r.mode || 'rule';
  $('#finalOutbound').value = r.finalOutbound || 'proxy';
  $('#blockAds').checked = !!r.blockAds;
  $('#proxyDomains').value = (r.proxyDomains || []).join('\n');
  $('#directDomains').value = (r.directDomains || []).join('\n');
  $('#appMode').value = r.appMode || 'off';
  $('#appList').value = (r.appList || []).join('\n');
}

function renderSettings() {
  const s = state.settings;
  $('#autoConnect').checked = !!s.autoConnect;
  $('#tunMode').checked = !!s.tunMode;
  $('#systemProxy').checked = !!s.systemProxy;
  $('#minimizeToTray').checked = !!s.minimizeToTray;
  $('#allowLan').checked = !!s.allowLan;
  $('#socksPort').value = s.socksPort;
  $('#httpPort').value = s.httpPort;
  $('#coreBinaryPath').value = s.coreBinaryPath || '';
  refreshBinaryStatus();
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
  try {
    state.servers = await window.hv.pingAll();
  } catch (e) { if (!silent) toast(e.message, true); }
  finally {
    measuring = false;
    $('#pingBtn').disabled = false;
    $('#pingBtn').textContent = 'Проверить пинг';
    renderServers();
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
    appList: linesOf($('#appList').value)
  };
  state.routing = await window.hv.saveRouting(routing);
  flashSaved('#routingSaved');
}

async function saveSettings() {
  const settings = {
    autoConnect: $('#autoConnect').checked,
    tunMode: $('#tunMode').checked,
    systemProxy: $('#systemProxy').checked,
    minimizeToTray: $('#minimizeToTray').checked,
    allowLan: $('#allowLan').checked,
    socksPort: Number($('#socksPort').value) || 2080,
    httpPort: Number($('#httpPort').value) || 2081,
    coreBinaryPath: $('#coreBinaryPath').value.trim()
  };
  state.settings = await window.hv.saveSettings(settings);
  refreshBinaryStatus();
  flashSaved('#settingsSaved');
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
  const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
  logBox.textContent += line + '\n';
  if (logBox.textContent.length > 80000) logBox.textContent = logBox.textContent.slice(-60000);
  if (atBottom) logBox.scrollTop = logBox.scrollHeight;
}

/* ---------- wiring ---------- */
$('#importBtn').addEventListener('click', importSub);
$('#subInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') importSub(); });
$('#pingBtn').addEventListener('click', () => pingAll());
$('#sortMode').addEventListener('change', (e) => { sortMode = e.target.value; renderServers(); });
$('#powerBtn').addEventListener('click', togglePower);
$('#bestBtn').addEventListener('click', connectBest);
$('#saveRouting').addEventListener('click', saveRouting);
$('#saveSettings').addEventListener('click', saveSettings);
$('#openCoreFolder').addEventListener('click', () => window.hv.openCoreFolder());
$('#clearLogs').addEventListener('click', () => { logBox.textContent = ''; });

window.hv.onStatus((s) => { renderStatus(s); renderServers(); });
window.hv.onLog((line) => appendLog(line));

refreshState();
