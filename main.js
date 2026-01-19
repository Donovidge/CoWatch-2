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
let lt = null;

// --- Server Port Configuration ---
const PORT = '5757';

async function isServerRunning(baseUrl) {
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}/api/health`, res => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else reject(new Error(`Server responded with ${res.statusCode}`));
      });
      req.on('error', reject);
    });
    return true;
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 820, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // FIXED: The preload script requires access to Node.js modules, so the sandbox must be disabled.
      sandbox: false,
      backgroundThrottling: false 
    }
  });
  
  win.on('ready-to-show', () => win.show());
  win.loadURL(`http://localhost:${PORT}`);
  win.webContents.openDevTools();
}

// --- Tunnel Management Logic ---
let activeTunnel = null;

async function handleStartTunnel(event, { provider }) {
  if (provider !== 'lt') throw new Error('Only localtunnel is supported.');
  
  try {
    if (!lt) lt = require('localtunnel');
    if (activeTunnel) return activeTunnel.url;

    console.log(`Starting localtunnel for port ${PORT}...`);
    activeTunnel = await lt({ port: parseInt(PORT, 10) });
    
    activeTunnel.on('close', () => {
      console.log('Localtunnel closed.');
      activeTunnel = null;
    });

    console.log(`Tunnel ready at: ${activeTunnel.url}`);
    return activeTunnel.url;
  } catch (e) {
    console.error('Failed to start tunnel:', e);
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
  ipcMain.handle('tunnel:start', handleStartTunnel);
  ipcMain.handle('tunnel:stop', handleStopTunnel);
  ipcMain.handle('copy-to-clipboard', (_evt, text) => { clipboard.writeText(text || ''); return true; });
  ipcMain.handle('open-external', (_evt, url) => { if (url) shell.openExternal(url); return true; });

  const serverAlreadyRunning = await isServerRunning(`http://localhost:${PORT}`);

  if (!serverAlreadyRunning) {
    console.log('[MAIN] Server not detected. Starting it now...');
    const userData = app.getPath('userData');
    const mediaDir = path.join(userData, 'media');
    try { fs.mkdirSync(mediaDir, { recursive: true }); } catch {}
    process.env.COWATCH_MEDIA_DIR = mediaDir;
    process.env.PORT = PORT;
    require(path.join(__dirname, 'server', 'server.js'));
  } else {
    console.log('[MAIN] Server is already running (dev mode).');
  }

  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('quit', () => {
  if (activeTunnel) activeTunnel.close();
});