const electron = require('electron');
const { contextBridge, ipcRenderer, desktopCapturer } = electron;
console.log('preload.js loaded. desktopCapturer defined?', !!desktopCapturer);

contextBridge.exposeInMainWorld('electronAPI', {
  // Functions for tunnel management
  startTunnel: (options) => ipcRenderer.invoke('tunnel:start', options),
  stopTunnel: () => ipcRenderer.invoke('tunnel:stop'),
  
  // Utility functions
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Screen sharing functions
  listScreenSources: async () => {
    if (!desktopCapturer) {
      console.error('desktopCapturer is not available');
      return [];
    }
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 300, height: 300 } });
      if (sources.length === 0) {
        console.warn('No sources found, possibly due to permissions.');
      }
      return sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnailDataURL: s.thumbnail ? s.thumbnail.toDataURL() : null
      }));
    } catch (error) {
      console.error('Error in getSources:', error);
      return [];
    }
  },
  
  getDisplayMediaBySourceId: async (sourceId) => {
    if (!desktopCapturer) {
      console.error('desktopCapturer not available for getDisplayMedia');
      return null;
    }
    try {
      // Request user permission for screen capture
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        }
      });
      return stream;
    } catch (error) {
      console.error('Error in getDisplayMedia:', error);
      return null;
    }
  },
  
  getScreenStream: async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          cursor: 'always'
        }
      });
      return stream;
    } catch (error) {
      console.error('Error getting screen stream:', error);
      return null;
    }
  }
});