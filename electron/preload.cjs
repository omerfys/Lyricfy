const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onMediaUpdate: (callback) => {
    ipcRenderer.on('media-update', (_event, value) => callback(value));
  },
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  setWindowMode: (mode) => ipcRenderer.invoke('set-window-mode', mode),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isElectron: true,
});
