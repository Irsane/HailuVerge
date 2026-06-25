'use strict';

// Cross-platform system proxy toggling (no external deps).
const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

async function enableWindows(host, httpPort) {
  const base = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  await run('reg', ['add', base, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
  await run('reg', ['add', base, '/v', 'ProxyServer', '/d', `${host}:${httpPort}`, '/f']);
  await run('reg', ['add', base, '/v', 'ProxyOverride', '/d', 'localhost;127.*;10.*;192.168.*;<local>', '/f']);
}

async function disableWindows() {
  const base = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  await run('reg', ['add', base, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
}

async function macServices() {
  const out = await run('networksetup', ['-listallnetworkservices']);
  return out.split('\n').slice(1).map((s) => s.replace(/^\*/, '').trim()).filter(Boolean);
}

async function enableMac(host, httpPort, socksPort) {
  for (const svc of await macServices()) {
    await run('networksetup', ['-setwebproxy', svc, host, String(httpPort)]).catch(() => {});
    await run('networksetup', ['-setsecurewebproxy', svc, host, String(httpPort)]).catch(() => {});
    await run('networksetup', ['-setsocksfirewallproxy', svc, host, String(socksPort)]).catch(() => {});
  }
}

async function disableMac() {
  for (const svc of await macServices()) {
    await run('networksetup', ['-setwebproxystate', svc, 'off']).catch(() => {});
    await run('networksetup', ['-setsecurewebproxystate', svc, 'off']).catch(() => {});
    await run('networksetup', ['-setsocksfirewallproxystate', svc, 'off']).catch(() => {});
  }
}

async function enableLinux(host, httpPort, socksPort) {
  // GNOME (gsettings). Other DEs are best-effort no-ops.
  const set = (k, v) => run('gsettings', ['set', 'org.gnome.system.proxy', k, v]).catch(() => {});
  await set('mode', 'manual');
  await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', host]).catch(() => {});
  await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', String(httpPort)]).catch(() => {});
  await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', host]).catch(() => {});
  await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', String(httpPort)]).catch(() => {});
  await run('gsettings', ['set', 'org.gnome.system.proxy.socks', 'host', host]).catch(() => {});
  await run('gsettings', ['set', 'org.gnome.system.proxy.socks', 'port', String(socksPort)]).catch(() => {});
}

async function disableLinux() {
  await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none']).catch(() => {});
}

async function enable(host, httpPort, socksPort) {
  if (process.platform === 'win32') return enableWindows(host, httpPort);
  if (process.platform === 'darwin') return enableMac(host, httpPort, socksPort);
  return enableLinux(host, httpPort, socksPort);
}

async function disable() {
  if (process.platform === 'win32') return disableWindows();
  if (process.platform === 'darwin') return disableMac();
  return disableLinux();
}

module.exports = { enable, disable };
