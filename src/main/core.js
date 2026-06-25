'use strict';

// sing-box core lifecycle: build config, spawn process, manage system proxy, report status.
const { app } = require('electron');
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sysProxy = require('./system-proxy');
const { buildConfig } = require('./singbox-config');

class Core extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.activeServer = null;
    this.startedAt = null;
    this.lastError = null;
  }

  coreDir() {
    // Packaged: resources/core. Dev: <repo>/core.
    return app.isPackaged
      ? path.join(process.resourcesPath, 'core')
      : path.join(__dirname, '..', '..', 'core');
  }

  binaryPath(custom) {
    if (custom && fs.existsSync(custom)) return custom;
    const exe = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
    return path.join(this.coreDir(), exe);
  }

  checkBinary() {
    const settings = require('./store').get('settings');
    const bin = this.binaryPath(settings.coreBinaryPath);
    return { path: bin, exists: fs.existsSync(bin), dir: this.coreDir() };
  }

  isRunning() {
    return !!this.proc;
  }

  status() {
    return {
      running: this.isRunning(),
      server: this.activeServer
        ? { id: this.activeServer.id, name: this.activeServer.name, protocol: this.activeServer.protocol }
        : null,
      startedAt: this.startedAt,
      error: this.lastError
    };
  }

  async start(server, settings, routing) {
    await this.stop();
    this.lastError = null;

    const bin = this.binaryPath(settings.coreBinaryPath);
    if (!fs.existsSync(bin)) {
      const err = new Error(
        `Ядро sing-box не найдено: ${bin}\nПоместите бинарник в папку core (Настройки → Открыть папку ядра).`
      );
      this.lastError = err.message;
      this.emit('status');
      throw err;
    }

    const config = buildConfig(server, settings, routing);
    const cfgPath = path.join(app.getPath('userData'), 'runtime-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

    await new Promise((resolve, reject) => {
      // Validate config first for clearer errors.
      execFile(bin, ['check', '-c', cfgPath], (err, _stdout, stderr) => {
        if (err) {
          this.emit('log', `[check] ${stderr || err.message}`);
          return reject(new Error('Ошибка конфигурации ядра. Подробности в логах.'));
        }
        resolve();
      });
    });

    this.proc = spawn(bin, ['run', '-c', cfgPath], { cwd: this.coreDir() });
    this.activeServer = server;
    this.startedAt = Date.now();

    this.proc.stdout.on('data', (d) => this.emit('log', d.toString().trimEnd()));
    this.proc.stderr.on('data', (d) => this.emit('log', d.toString().trimEnd()));

    this.proc.on('exit', (code, signal) => {
      this.emit('log', `[core] процесс завершён (code=${code} signal=${signal})`);
      this.proc = null;
      this.activeServer = null;
      this.startedAt = null;
      sysProxy.disable().catch(() => {});
      this.emit('status');
    });

    this.proc.on('error', (err) => {
      this.lastError = err.message;
      this.emit('log', `[core] ${err.message}`);
    });

    // Apply system proxy (unless using TUN, which captures traffic at the OS level).
    const usingTun = settings.tunMode || (routing.appMode && routing.appMode !== 'off');
    if (settings.systemProxy && !usingTun) {
      await sysProxy.enable('127.0.0.1', settings.httpPort, settings.socksPort).catch((e) =>
        this.emit('log', `[proxy] не удалось включить системный прокси: ${e.message}`));
    }

    this.emit('status');
    return this.status();
  }

  async stop() {
    await sysProxy.disable().catch(() => {});
    if (!this.proc) return;
    return new Promise((resolve) => {
      const p = this.proc;
      const done = () => resolve();
      p.once('exit', done);
      try {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/pid', String(p.pid), '/f', '/t'], () => {});
        } else {
          p.kill('SIGTERM');
        }
      } catch {
        resolve();
      }
      // Hard timeout guard.
      setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 4000);
    });
  }
}

module.exports = new Core();
