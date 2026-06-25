'use strict';

// Downloads the sing-box core binary into ./core for the current platform.
// Usage: node scripts/download-core.js [version]
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { execSync } = require('child_process');

const VERSION = process.argv[2] || '1.11.4';
const coreDir = path.join(__dirname, '..', 'core');

function platformInfo() {
  const p = process.platform;
  const a = process.arch;
  const arch = a === 'x64' ? 'amd64' : a === 'arm64' ? 'arm64' : a;
  if (p === 'win32') return { os: 'windows', arch, ext: 'zip', bin: 'sing-box.exe' };
  if (p === 'darwin') return { os: 'darwin', arch, ext: 'tar.gz', bin: 'sing-box' };
  return { os: 'linux', arch, ext: 'tar.gz', bin: 'sing-box' };
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HailuVerge' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  const info = platformInfo();
  const name = `sing-box-${VERSION}-${info.os}-${info.arch}`;
  const url = `https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/${name}.${info.ext}`;
  console.log('Downloading', url);

  fs.mkdirSync(coreDir, { recursive: true });
  const archive = await get(url);
  const tmp = path.join(coreDir, `pkg.${info.ext}`);
  fs.writeFileSync(tmp, archive);

  if (info.ext === 'zip') {
    // Use PowerShell Expand-Archive on Windows.
    execSync(`powershell -command "Expand-Archive -Force '${tmp}' '${coreDir}'"`);
  } else {
    execSync(`tar -xzf "${tmp}" -C "${coreDir}"`);
  }

  // Move binary out of the extracted folder.
  const extracted = path.join(coreDir, name, info.bin);
  if (fs.existsSync(extracted)) {
    fs.copyFileSync(extracted, path.join(coreDir, info.bin));
    fs.rmSync(path.join(coreDir, name), { recursive: true, force: true });
  }
  fs.rmSync(tmp, { force: true });

  const dest = path.join(coreDir, info.bin);
  if (process.platform !== 'win32' && fs.existsSync(dest)) fs.chmodSync(dest, 0o755);
  console.log('Core ready:', dest);
}

main().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
