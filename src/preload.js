const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('rouo', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  chooseFiles: mode => ipcRenderer.invoke('files:choose', mode),
  chooseOutput: () => ipcRenderer.invoke('output:choose'),
  inspectFiles: paths => ipcRenderer.invoke('files:inspect', paths),
  convert: payload => ipcRenderer.invoke('conversion:run', payload),
  revealOutput: filePath => ipcRenderer.invoke('output:reveal', filePath),
  getPathForFile: file => webUtils.getPathForFile(file),
  onProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('conversion:progress', listener);
    return () => ipcRenderer.removeListener('conversion:progress', listener);
  },
});

