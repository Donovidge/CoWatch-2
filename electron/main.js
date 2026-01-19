// main.js

process.on('uncaughtException', (err) => {
  console.error('[MAIN] uncaughtException:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] unhandledRejection:', reason);
});

const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
let lt = null; // To hold the localtunnel instance

// --- Server Port Configuration ---
const PORT = process.env.PORT || '5757';

async function waitForServer(baseUrl, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(`${baseUrl}/api/health`, r => {
          r.resume();
          (r.statusCode === 200) ? res() : rej(new Error(`HTTP ${r.statusCode}`));
        });
        req.on('error', rej);
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  return false;
}

function createWindow(loadedFromServer) {
  const win = new BrowserWindow({
    width: 1200, height: 820, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true
    }
  });
  win.on('ready-to-show', () => win.show());

  if (loadedFromServer) {
    win.loadURL(`http://localhost:${PORT}`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  }
}

// --- Tunnel Management Logic ---
let activeTunnel = null;

async function handleStartTunnel(event, { provider }) {
  if (provider !== 'lt') throw new Error('Only localtunnel is supported.');
  
  try {
    if (!lt) lt = require('localtunnel');
    if (activeTunnel) return activeTunnel.url;

    console.log(`Starting localtunnel for port ${PORT}...`);
    // FIXED: Ensure the tunnel points to the correct PORT
    activeTunnel = await lt({ port: parseInt(PORT, 10) });
    
    activeTunnel.on('close', () => {
      console.log('Localtunnel closed.');
      activeTunnel = null;
    });

    console.log(`Tunnel ready at: ${activeTunnel.url}`);
    return activeTunnel.url;
  } catch (e) {
    console.error('Failed to start tunnel:', e);
    // Pass a more useful error message back to the UI
    throw new Error(e.message || 'Could not connect to the localtunnel server.');
  }
}

async function handleStopTunnel() {
  if (activeTunnel) {
    await activeTunnel.close();
    activeTunnel = null;
  }
  return true;
}


// --- App Lifecycle ---
app.whenReady().then(async () => {
  // Set up IPC handlers
  ipcMain.handle('tunnel:start', handleStartTunnel);
  ipcMain.handle('tunnel:stop', handleStopTunnel);

  const userData = app.getPath('userData');
  const mediaDir = path.join(userData, 'media');
  try { fs.mkdirSync(mediaDir, { recursive: true }); } catch {}
  process.env.COWATCH_MEDIA_DIR = mediaDir;
  process.env.PORT = PORT;

  // Start the server
  require(path.join(__dirname, '..', 'server', 'server.js'));

  const ok = await waitForServer(`http://localhost:${PORT}`, 30000);
  createWindow(ok);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('quit', () => {
  if (activeTunnel) activeTunnel.close();
});

// IPC helpers
ipcMain.handle('copy-to-clipboard', (_evt, text) => { clipboard.writeText(text || ''); return true; });
ipcMain.handle('open-external', (_evt, url) => { if (url) shell.openExternal(url); return true; });
ipcMain.handle('set-open-at-login', (_evt, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('get-open-at-login', () => app.getLoginItemSettings().openAtLogin);