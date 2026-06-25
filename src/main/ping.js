'use strict';

// Lightweight TCP-connect latency probe. Fast and reliable for ranking servers.
const net = require('net');

function measure(server, timeout = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;

    const finish = (latency) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ server, latency });
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(Date.now() - start));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));

    try {
      socket.connect(server.port, server.server);
    } catch {
      finish(null);
    }
  });
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
