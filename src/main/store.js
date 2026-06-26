'use strict';

// Minimal JSON-file settings store (no external deps).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let filePath = null;
let data = null;

const DEFAULTS = {
  servers: [],
  subscriptions: [],
  favorites: [],              // ids of servers the user starred
  activeServerId: null,
  settings: {
    theme: 'indigo',          // full app theme: indigo|emerald|sunset|rose|cyan|violet|daylight
    bgAnimation: true,        // animated aurora background
    glass: true,              // frosted-glass blur on surfaces
    density: 'comfortable',   // comfortable | compact
    uiRadius: 'soft',         // sharp | soft | round (corner roundness)
    startWithVpn: false,      // on launch, auto-connect to a favorite server
    startServerId: '',        // which favorite to start ('' = best favorite by ping)
    autoConnect: true,        // connect to best (non-RU) server on launch
    minimizeToTray: true,
    tunMode: true,            // capture ALL traffic incl. UDP (fixes Telegram/Discord); needs admin
    systemProxy: true,        // fallback: set OS proxy when TUN is off (TCP only)
    logsEnabled: false,       // collect/show core logs only when enabled
    allowLan: false,
    socksPort: 2080,
    httpPort: 2081,
    coreBinaryPath: ''        // optional custom path to sing-box binary
  },
  routing: {
    mode: 'global',           // start GLOBAL: all traffic via proxy. Switch to 'rule' in settings.
    finalOutbound: 'proxy',   // default action for unmatched traffic: 'proxy' | 'direct'
    proxyDomains: [
      'youtube.com',
      'googlevideo.com',
      'twitter.com',
      'x.com',
      'instagram.com',
      'discord.com',
      'telegram.org'
    ],
    directDomains: [
      'gosuslugi.ru',
      'sberbank.ru',
      'mos.ru',
      'yandex.ru',
      'vk.com',
      'mail.ru'
    ],
    blockAds: true,
    appMode: 'off',           // per-app routing: 'off' | 'proxy' | 'direct'
    appList: []               // process names, e.g. ["chrome.exe", "telegram.exe"]
  }
};

function init() {
  filePath = path.join(app.getPath('userData'), 'hailuverge.config.json');
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Backfill any newly-added defaults.
    data = deepDefaults(data, DEFAULTS);
  } catch {
    data = JSON.parse(JSON.stringify(DEFAULTS));
    persist();
  }
}

function deepDefaults(target, defaults) {
  const out = Array.isArray(defaults) ? (target ?? defaults) : { ...defaults, ...(target || {}) };
  if (!Array.isArray(defaults)) {
    for (const key of Object.keys(defaults)) {
      if (defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
        out[key] = deepDefaults((target || {})[key], defaults[key]);
      }
    }
  }
  return out;
}

function get(key) {
  return key ? data[key] : data;
}

function set(key, value) {
  data[key] = value;
  persist();
}

function persist() {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to persist config:', err.message);
  }
}

module.exports = { init, get, set, DEFAULTS };
