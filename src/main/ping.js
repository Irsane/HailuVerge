'use strict';

// Latency probe for ranking servers.
//
// Many subscription servers sit behind a CDN/relay that terminates TCP at a
// nearby edge, so a bare TCP-connect only measures the distance to that edge
// (suspiciously low, often identical across servers). For TLS/Reality servers
// we instead time a full TLS handshake to the real SNI: that carries through
// the server to the actual backend, giving a far more honest round-trip. We
// fall back to a plain TCP connect when TLS can't complete or doesn't apply.
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

// One TCP-handshake round-trip to host:port → latency in ms, or null on failure.
function tcpProbe(host, port, timeout) {
  return new Promise((resolve) => {
    const start = nowMs();
    const socket = new net.Socket();
    let done = false;
    const finish = (ms) => { if (done) return; done = true; socket.destroy(); resolve(ms); };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(nowMs() - start));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
    try { socket.connect(port, host); } catch { finish(null); }
  });
}

// Full TCP + TLS handshake to host:port (sending the given SNI) → latency in ms.
// Reflects the path through the server to its real backend, not just the edge.
function tlsProbe(host, port, servername, timeout) {
  return new Promise((resolve) => {
    const start = nowMs();
    let done = false;
    let socket;
    const finish = (ms) => { if (done) return; done = true; try { socket.destroy(); } catch {} resolve(ms); };
    try {
      socket = tls.connect({
        host,
        port,
        servername: servername || undefined, // SNI must be the hostname, not the IP
        rejectUnauthorized: false,           // we only time the handshake, not trust
        timeout
      });
    } catch {
      return resolve(null);
    }
    socket.once('secureConnect', () => finish(nowMs() - start));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

// Decide whether a TLS handshake is meaningful for this server.
function usesTls(server) {
  const r = server.raw || {};
  if (server.protocol === 'vless' || server.protocol === 'trojan') {
    return r.security === 'tls' || r.security === 'reality' || !!r.sni || Number(server.port) === 443;
  }
  return false; // shadowsocks / hysteria (UDP) → plain TCP probe
}

async function measure(server, { timeout = 3500, samples = 2 } = {}) {
  const hostname = server.server;
  let ip = hostname;
  try {
    // Resolve once so every sample hits the same address and DNS isn't timed.
    const { address } = await dns.lookup(hostname);
    if (address) ip = address;
  } catch {
    return { server, latency: null };
  }

  const tlsWanted = usesTls(server);
  // SNI must be a hostname; never an IP (RFC 6066) — omit it otherwise.
  const sniCandidate = (server.raw && (server.raw.sni || server.raw.host)) || hostname;
  const sni = net.isIP(sniCandidate) ? undefined : sniCandidate;

  const readings = [];
  for (let i = 0; i < samples; i++) {
    let ms = tlsWanted ? await tlsProbe(ip, server.port, sni, timeout) : null;
    if (ms == null) ms = await tcpProbe(ip, server.port, timeout); // fallback / non-TLS
    if (ms != null) readings.push(ms);
  }

  if (!readings.length) return { server, latency: null };
  // Best (min) sample = the cleanest round-trip, ignoring one-off jitter.
  const best = Math.min(...readings);
  return { server, latency: Math.max(1, Math.round(best)) };
}

// Probe all servers with bounded concurrency.
async function measureAll(servers, concurrency = 16) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, servers.length) }, async () => {
    while (index < servers.length) {
      const current = servers[index++];
      results.push(await measure(current));
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { measure, measureAll };
