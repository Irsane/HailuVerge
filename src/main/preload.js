'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hv', {
  getState: () => ipcRenderer.invoke('app:getState'),

  importSub: (url) => ipcRenderer.invoke('sub:import', url),
  updateSub: (url) => ipcRenderer.invoke('sub:update', url),
  removeSub: (url) => ipcRenderer.invoke('sub:remove', url),
  addLink: (link) => ipcRenderer.invoke('servers:addLink', link),

  pingAll: () => ipcRenderer.invoke('ping:all'),

  connect: (serverId) => ipcRenderer.invoke('core:connect', serverId),
  connectBest: () => ipcRenderer.invoke('core:connectBest'),
  disconnect: () => ipcRenderer.invoke('core:disconnect'),

  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  saveRouting: (r) => ipcRenderer.invoke('routing:save', r),

  checkBinary: () => ipcRenderer.invoke('core:checkBinary'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  openCoreFolder: () => ipcRenderer.invoke('app:openCoreFolder'),

  runningApps: () => ipcRenderer.invoke('apps:running'),
  browseApps: () => ipcRenderer.invoke('apps:browse'),

  onStatus: (cb) => ipcRenderer.on('status:update', (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on('core:log', (_e, line) => cb(line))
});
