'use strict';

// Lightweight TCP-connect latency probe. Fast and reliable for ranking servers.
const net = require('net');
const dns = require('dns').promises;

// One TCP-handshake round-trip to host:port. Resolves the latency in ms, or null on failure.
function probeOnce(host, port, timeout) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const socket = new net.Socket();
    let done = false;

    const finish = (latency) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(latency);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      // Nanosecond clock → ms with one decimal of precision before rounding.
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      finish(ms);
    });
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));

    try {
      socket.connect(port, host);
    } catch {
      finish(null);
    }
  });
}

// Measure a server with a few samples and take the median, which is far more
// stable than a single connect (a lone sample can land on a warm local path and
// report an implausibly tiny value). DNS is resolved once up front so resolution
// time is never folded into the latency.
async function measure(server, { timeout = 2500, samples = 3 } = {}) {
  let host = server.server;
  try {
    // Resolve to an explicit IP once; keeps every sample on the same address and
    // excludes DNS lookup from the timing.
    const { address } = await dns.lookup(host);
    if (address) host = address;
  } catch {
    // Unresolvable host → it won't connect; report no latency.
    return { server, latency: null };
  }

  const readings = [];
  for (let i = 0; i < samples; i++) {
    const ms = await probeOnce(host, server.port, timeout);
    if (ms != null) readings.push(ms);
  }

  if (!readings.length) return { server, latency: null };
  readings.sort((a, b) => a - b);
  const median = readings[Math.floor(readings.length / 2)];
  // Clamp to a sane floor so a sub-millisecond local handshake never shows as 0.
  return { server, latency: Math.max(1, Math.round(median)) };
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
