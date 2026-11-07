'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  patchConfig: (patch) => ipcRenderer.invoke('config:patch', patch),
  importAssets: () => ipcRenderer.invoke('assets:import'),
  deleteAsset: (id) => ipcRenderer.invoke('assets:delete', id),
  updateAssetMeta: (id, meta) => ipcRenderer.invoke('assets:updateMeta', id, meta),
  finishSetup: () => ipcRenderer.invoke('app:finish-setup'),
  onConfigChanged: (cb) => subscribe('config:changed', cb),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openUserData: () => ipcRenderer.invoke('shell:open-userdata'),

  pet: {
    dragStart: () => ipcRenderer.invoke('pet:drag-start'),
    dragMove: (x, y) => ipcRenderer.send('pet:drag-move', x, y),
    dragEnd: () => ipcRenderer.invoke('pet:drag-end'),
    fit: (size) => ipcRenderer.invoke('pet:fit', size),
    menu: () => ipcRenderer.invoke('pet:menu'),
    openSettings: () => ipcRenderer.invoke('settings:open'),
    onActivity: (cb) => subscribe('pet:activity', cb),
  },
});
