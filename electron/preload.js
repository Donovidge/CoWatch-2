
const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('set-open-at-login', enabled),
  getOpenAtLogin: () => ipcRenderer.invoke('get-open-at-login'),
  listScreenSources: async () => {
    const sources = await desktopCapturer.getSources({ types: ['window','screen'], fetchWindowIcons:true });
    return sources.map(s => ({ id:s.id, name:s.name, thumbnailDataURL: s.thumbnail ? s.thumbnail.toDataURL() : null }));
  },
  getDisplayMediaBySourceId: async (sourceId) => {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource:'desktop', chromeMediaSourceId: sourceId } }
    });
  }
});
