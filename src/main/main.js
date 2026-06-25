'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const store = require('./store');
const subscription = require('./subscription');
const ping = require('./ping');
const core = require('./core');

const isDev = process.argv.includes('--dev');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#0e1116',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', (e) => {
    if (!isQuitting && store.get('settings').minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('HailuVerge');
  refreshTrayMenu();
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
  });
}

function refreshTrayMenu() {
  if (!tray) return;
  const connected = core.isRunning();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connected ? '● Подключено' : '○ Отключено', enabled: false },
    { type: 'separator' },
    { label: 'Открыть', click: () => mainWindow && mainWindow.show() },
    {
      label: connected ? 'Отключить' : 'Подключить',
      click: async () => {
        connected ? await core.stop() : await connectBest();
        broadcastStatus();
      }
    },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function broadcastStatus() {
  refreshTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status:update', core.status());
  }
}

core.on('status', broadcastStatus);
core.on('log', (line) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('core:log', line);
});

// Connect to the lowest-latency server (excluding Russian servers, per requirement).
async function connectBest() {
  const servers = store.get('servers');
  if (!servers.length) throw new Error('Нет серверов. Добавьте подписку.');
  // Skip Russian and mobile/LTE servers when auto-selecting the best one.
  const candidates = servers.filter((s) => !s.isRussian && !s.isLte);
  const pool = candidates.length ? candidates : servers.filter((s) => !s.isRussian);
  const finalPool = pool.length ? pool : servers;
  const results = await ping.measureAll(finalPool);
  const best = results
    .filter((r) => r.latency != null)
    .sort((a, b) => a.latency - b.latency)[0];
  const chosen = best ? best.server : finalPool[0];
  await core.start(chosen, store.get('settings'), store.get('routing'));
  store.set('activeServerId', chosen.id);
  return chosen;
}

function registerIpc() {
  ipcMain.handle('app:getState', () => ({
    servers: store.get('servers'),
    subscriptions: store.get('subscriptions'),
    favorites: store.get('favorites') || [],
    settings: store.get('settings'),
    routing: store.get('routing'),
    activeServerId: store.get('activeServerId'),
    status: core.status()
  }));

  // Toggle a server in/out of the favorites list. Returns the updated id list.
  ipcMain.handle('servers:toggleFavorite', (_e, serverId) => {
    const favorites = store.get('favorites') || [];
    const next = favorites.includes(serverId)
      ? favorites.filter((id) => id !== serverId)
      : [...favorites, serverId];
    store.set('favorites', next);
    return next;
  });

  ipcMain.handle('sub:import', async (_e, url) => {
    const sub = await subscription.fetchAndParse(url);
    const subs = store.get('subscriptions').filter((s) => s.url !== url);
    subs.push({ url, name: sub.name, updatedAt: Date.now(), count: sub.servers.length });
    store.set('subscriptions', subs);
    mergeServers(url, sub.servers);
    return { servers: store.get('servers'), subscriptions: store.get('subscriptions') };
  });

  ipcMain.handle('sub:update', async (_e, url) => {
    const sub = await subscription.fetchAndParse(url);
    const subs = store.get('subscriptions').map((s) =>
      s.url === url ? { ...s, updatedAt: Date.now(), count: sub.servers.length, name: sub.name } : s);
    store.set('subscriptions', subs);
    mergeServers(url, sub.servers);
    return { servers: store.get('servers'), subscriptions: store.get('subscriptions') };
  });

  ipcMain.handle('sub:remove', async (_e, url) => {
    store.set('subscriptions', store.get('subscriptions').filter((s) => s.url !== url));
    store.set('servers', store.get('servers').filter((s) => s.source !== url));
    // Drop favorites whose server no longer exists.
    const ids = new Set(store.get('servers').map((s) => s.id));
    store.set('favorites', (store.get('favorites') || []).filter((id) => ids.has(id)));
    return {
      servers: store.get('servers'),
      subscriptions: store.get('subscriptions'),
      favorites: store.get('favorites')
    };
  });

  ipcMain.handle('servers:addLink', async (_e, link) => {
    const parsed = subscription.parseLinks(link);
    if (!parsed.length) throw new Error('Не удалось распознать ссылку.');
    mergeServers('manual', parsed, true);
    return store.get('servers');
  });

  ipcMain.handle('ping:all', async () => {
    const results = await ping.measureAll(store.get('servers'));
    const map = {};
    results.forEach((r) => { map[r.server.id] = r.latency; });
    const servers = store.get('servers').map((s) => ({ ...s, latency: map[s.id] ?? s.latency }));
    store.set('servers', servers);
    return servers;
  });

  ipcMain.handle('core:connect', async (_e, serverId) => {
    const server = store.get('servers').find((s) => s.id === serverId);
    if (!server) throw new Error('Сервер не найден.');
    await core.start(server, store.get('settings'), store.get('routing'));
    store.set('activeServerId', serverId);
    return core.status();
  });

  ipcMain.handle('core:connectBest', async () => {
    const chosen = await connectBest();
    return { status: core.status(), serverId: chosen.id };
  });

  ipcMain.handle('core:disconnect', async () => {
    await core.stop();
    return core.status();
  });

  ipcMain.handle('settings:save', async (_e, settings) => {
    store.set('settings', { ...store.get('settings'), ...settings });
    return store.get('settings');
  });

  ipcMain.handle('routing:save', async (_e, routing) => {
    store.set('routing', { ...store.get('routing'), ...routing });
    // Hot-reload routing if connected.
    if (core.isRunning()) {
      const active = store.get('servers').find((s) => s.id === store.get('activeServerId'));
      if (active) await core.start(active, store.get('settings'), store.get('routing'));
    }
    return store.get('routing');
  });

  ipcMain.handle('core:checkBinary', async () => core.checkBinary());
  ipcMain.handle('app:openExternal', async (_e, url) => shell.openExternal(url));
  ipcMain.handle('app:openCoreFolder', async () => shell.openPath(core.coreDir()));

  ipcMain.handle('apps:running', async () => listRunningProcesses());
  ipcMain.handle('apps:browse', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите программы',
      properties: ['openFile', 'multiSelections'],
      filters: process.platform === 'win32'
        ? [{ name: 'Программы', extensions: ['exe'] }]
        : [{ name: 'Все файлы', extensions: ['*'] }]
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => path.basename(p));
  });
}

// Enumerate running user processes so the app picker can list them.
function listRunningProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/fo', 'csv', '/nh'], { maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve([]);
        const names = out.split(/\r?\n/)
          .map((l) => (l.match(/^"([^"]+)"/) || [])[1])
          .filter((n) => n && /\.exe$/i.test(n));
        resolve(dedupeApps(names));
      });
    } else {
      execFile('ps', ['-A', '-o', 'comm='], { maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve([]);
        const names = out.split(/\r?\n/).map((l) => path.basename(l.trim())).filter(Boolean);
        resolve(dedupeApps(names));
      });
    }
  });
}

// Drop obvious OS noise and de-duplicate, sorted alphabetically.
const SYSTEM_PROCS = new Set([
  'svchost.exe', 'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe',
  'services.exe', 'lsass.exe', 'winlogon.exe', 'fontdrvhost.exe', 'dwm.exe',
  'sihost.exe', 'taskhostw.exe', 'ctfmon.exe', 'conhost.exe', 'runtimebroker.exe',
  'searchhost.exe', 'dllhost.exe', 'spoolsv.exe', 'wmiprvse.exe', 'memcompression'
]);
function dedupeApps(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key) || SYSTEM_PROCS.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function mergeServers(source, incoming, isManual = false) {
  const existing = store.get('servers');
  const kept = isManual ? existing : existing.filter((s) => s.source !== source);
  const tagged = incoming.map((s) => ({ ...s, source: isManual ? 'manual' : source }));
  // De-duplicate by id (host:port:protocol signature).
  const byId = new Map();
  [...kept, ...tagged].forEach((s) => byId.set(s.id, { ...byId.get(s.id), ...s }));
  store.set('servers', [...byId.values()]);
}

// Only allow one running instance — relaunching focuses the tray-minimized window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    store.init();
    registerIpc();
    createWindow();
    createTray();

    if (store.get('settings').autoConnect) {
      connectBest().then(broadcastStatus).catch((err) => {
        if (mainWindow) mainWindow.webContents.send('core:log', `[auto] ${err.message}`);
      });
    }

    app.on('activate', () => {
      if (mainWindow) mainWindow.show();
      else createWindow();
    });
  });
}

app.on('before-quit', () => { isQuitting = true; });
app.on('quit', () => core.stop());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !store.get('settings').minimizeToTray) app.quit();
});
