const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  hide: () => ipcRenderer.send('overlay-hide'),
  toggleMute: () => ipcRenderer.send('overlay-toggle-mute'),
  endCall: () => ipcRenderer.send('overlay-end-call'),
  resize: (w, h) => ipcRenderer.send('overlay-resize', w, h),
  onUpdateCall: (cb) => ipcRenderer.on('overlay-update-call', (e, data) => cb(data)),
  onUpdateMute: (cb) => ipcRenderer.on('overlay-update-mute', (e, isMuted) => cb(isMuted)),
  onUpdateTimer: (cb) => ipcRenderer.on('overlay-update-timer', (e, time) => cb(time)),
  onUpdateMembers: (cb) => ipcRenderer.on('overlay-update-members', (e, members) => cb(members))
});
