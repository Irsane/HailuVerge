'use strict';

// Subscription fetching + URI parsing for VLESS / Hysteria / Hysteria2 / Trojan / Shadowsocks.
const crypto = require('crypto');

// Heuristics to flag Russian servers so auto-connect can skip them.
const RU_HINTS = [
  '🇷🇺', ' ru ', 'russia', 'россия', 'росси', 'moscow', 'москва', 'spb',
  'saint-petersburg', 'piter', 'питер', 'rus '
];

function looksRussian(name = '') {
  const n = ` ${name.toLowerCase()} `;
  return RU_HINTS.some((h) => n.includes(h)) || /\brus?\b/.test(n);
}

function stableId(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function tryBase64Decode(str) {
  const trimmed = str.trim().replace(/\s+/g, '');
  // Subscription bodies are often a base64 blob of newline-separated URIs.
  if (/^[A-Za-z0-9+/=_-]+$/.test(trimmed) && trimmed.length > 24) {
    try {
      const decoded = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (decoded.includes('://')) return decoded;
    } catch { /* not base64 */ }
  }
  return str;
}

function safeDecode(str) {
  try { return decodeURIComponent(str); } catch { return str; }
}

function parseUri(uri) {
  uri = uri.trim();
  if (!uri || uri.startsWith('#')) return null;
  const scheme = (uri.split('://')[0] || '').toLowerCase();
  try {
    switch (scheme) {
      case 'vless': return parseVless(uri);
      case 'hysteria2':
      case 'hy2': return parseHysteria2(uri);
      case 'hysteria':
      case 'hy': return parseHysteria(uri);
      case 'trojan': return parseTrojan(uri);
      case 'ss': return parseShadowsocks(uri);
      default: return null;
    }
  } catch {
    return null;
  }
}

function makeServer(base) {
  const name = base.name || `${base.server}:${base.port}`;
  return {
    id: stableId([base.protocol, base.server, base.port, base.uuid || base.password || '']),
    name,
    protocol: base.protocol,
    server: base.server,
    port: Number(base.port),
    isRussian: looksRussian(name) || looksRussian(base.server),
    latency: null,
    raw: base
  };
}

function parseVless(uri) {
  const u = new URL(uri);
  const q = u.searchParams;
  return makeServer({
    protocol: 'vless',
    name: safeDecode(u.hash.slice(1)),
    server: u.hostname,
    port: u.port || 443,
    uuid: u.username,
    flow: q.get('flow') || '',
    encryption: q.get('encryption') || 'none',
    network: q.get('type') || 'tcp',           // tcp, ws, grpc, http
    security: q.get('security') || 'none',      // tls, reality, none
    sni: q.get('sni') || q.get('peer') || '',
    fp: q.get('fp') || '',
    alpn: q.get('alpn') || '',
    pbk: q.get('pbk') || '',                     // reality public key
    sid: q.get('sid') || '',                     // reality short id
    path: safeDecode(q.get('path') || ''),
    host: q.get('host') || '',
    serviceName: q.get('serviceName') || ''
  });
}

function parseHysteria2(uri) {
  const u = new URL(uri);
  const q = u.searchParams;
  return makeServer({
    protocol: 'hysteria2',
    name: safeDecode(u.hash.slice(1)),
    server: u.hostname,
    port: u.port || 443,
    password: safeDecode(u.username || q.get('password') || ''),
    sni: q.get('sni') || '',
    insecure: q.get('insecure') === '1' || q.get('insecure') === 'true',
    obfs: q.get('obfs') || '',
    obfsPassword: q.get('obfs-password') || q.get('obfsParam') || '',
    alpn: q.get('alpn') || 'h3'
  });
}

function parseHysteria(uri) {
  const u = new URL(uri);
  const q = u.searchParams;
  return makeServer({
    protocol: 'hysteria',
    name: safeDecode(u.hash.slice(1)),
    server: u.hostname,
    port: u.port || 443,
    auth: q.get('auth') || q.get('auth_str') || u.username || '',
    sni: q.get('peer') || q.get('sni') || '',
    insecure: q.get('insecure') === '1',
    upmbps: Number(q.get('upmbps') || 50),
    downmbps: Number(q.get('downmbps') || 200),
    obfs: q.get('obfs') || '',
    alpn: q.get('alpn') || ''
  });
}

function parseTrojan(uri) {
  const u = new URL(uri);
  const q = u.searchParams;
  return makeServer({
    protocol: 'trojan',
    name: safeDecode(u.hash.slice(1)),
    server: u.hostname,
    port: u.port || 443,
    password: u.username,
    sni: q.get('sni') || q.get('peer') || '',
    network: q.get('type') || 'tcp',
    alpn: q.get('alpn') || '',
    insecure: q.get('allowInsecure') === '1'
  });
}

function parseShadowsocks(uri) {
  const u = new URL(uri);
  let method, password;
  if (u.username && u.password) {
    method = u.username;
    password = u.password;
  } else {
    const decoded = Buffer.from(u.username.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    [method, password] = decoded.split(':');
  }
  return makeServer({
    protocol: 'shadowsocks',
    name: safeDecode(u.hash.slice(1)),
    server: u.hostname,
    port: u.port,
    method,
    password
  });
}

function parseLinks(text) {
  const decoded = tryBase64Decode(text);
  return decoded
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseUri)
    .filter(Boolean);
}

async function fetchAndParse(url) {
  let body;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HailuVerge/1.0 (sing-box)' },
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.text();
  } catch (err) {
    throw new Error(`Не удалось загрузить подписку: ${err.message}`);
  }

  const servers = parseLinks(body);
  if (!servers.length) {
    throw new Error('Подписка не содержит поддерживаемых серверов (VLESS/Hysteria/Trojan/SS).');
  }
  let name = 'Подписка';
  try { name = new URL(url).hostname; } catch { /* keep default */ }
  return { name, servers };
}

module.exports = { fetchAndParse, parseLinks, parseUri, looksRussian };
