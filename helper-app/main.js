const { app, BrowserWindow, ipcMain, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { WebSocketServer } = require('ws');
const { autoUpdater } = require('electron-updater');

// The helper shares package.json with the main BSP app, so without a
// distinct name they would fight over the same single-instance lock
// and userData dir. Override before any app event fires.
app.setName('Bible Song Pro Ai Helper');
app.setPath('userData', path.join(app.getPath('appData'), 'BSP AI Helper'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let win = null;
let httpServer = null;
let relayServer = null;
let ownsHttpPort = false;
let ownsRelayPort = false;
let httpRetryTimer = null;
let relayRetryTimer = null;
const relayClients = new Set();
const LOCAL_HTTP_PORT = 5510;
const LOCAL_RELAY_PORT = 5511;
let pendingAutoStartEngine = process.argv.includes('--auto-start-engine');

function sendHelperUpdateStatus(payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('helper:update-status', payload || {});
}

function setupHelperAutoUpdater() {
  if (!app.isPackaged) {
    sendHelperUpdateStatus({ state: 'dev-mode' });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendHelperUpdateStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendHelperUpdateStatus({
      state: 'available',
      version: info && info.version ? String(info.version) : '',
      releaseNotes: info && info.releaseNotes ? String(info.releaseNotes) : ''
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendHelperUpdateStatus({ state: 'none' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendHelperUpdateStatus({
      state: 'downloading',
      percent: progress && typeof progress.percent === 'number' ? progress.percent : 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendHelperUpdateStatus({
      state: 'downloaded',
      version: info && info.version ? String(info.version) : '',
      releaseNotes: info && info.releaseNotes ? String(info.releaseNotes) : ''
    });
  });

  autoUpdater.on('error', (error) => {
    sendHelperUpdateStatus({
      state: 'error',
      message: error && error.message ? String(error.message) : 'Update failed'
    });
  });
}

function scheduleHelperAutoUpdateCheck() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      sendHelperUpdateStatus({
        state: 'error',
        message: error && error.message ? String(error.message) : 'Unable to check for updates'
      });
    });
  }, 5000);
}

function resolveAppFile(name) {
  return path.join(__dirname, '..', name);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const entries = [];
  Object.entries(interfaces).forEach(([name, list]) => {
    (list || []).forEach((entry) => {
      if (!entry || entry.internal) return;
      if (entry.family !== 'IPv4') return;
      entries.push({ name: String(name || ''), address: entry.address });
    });
  });
  const scoreInterface = (name) => {
    const n = String(name || '').toLowerCase();
    if (/^(en\d+|eth\d+|wlan\d+|wi-?fi|wifi)$/.test(n)) return 0;
    if (/(awdl|llw|utun|bridge|vmnet|vbox|docker|tailscale|hamachi|zt)/.test(n)) return 3;
    return 1;
  };
  entries.sort((a, b) => {
    const s = scoreInterface(a.name) - scoreInterface(b.name);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name);
  });
  return [...new Set(entries.map((x) => x.address))];
}

function getLocalServerInfo() {
  const addresses = getLanAddresses();
  const preferredHost = addresses[0] || '127.0.0.1';
  return {
    httpPort: LOCAL_HTTP_PORT,
    relayPort: LOCAL_RELAY_PORT,
    preferredHost,
    availableHosts: ['127.0.0.1', ...addresses],
    panelPath: '/Bible%20Song%20Pro%20panel.html',
    displayPath: '/BSP_display.html',
    panelUrl: `http://${preferredHost}:${LOCAL_HTTP_PORT}/Bible%20Song%20Pro%20panel.html?hostMode=vmix&relay=ws://${preferredHost}:${LOCAL_RELAY_PORT}`,
    displayUrl: `http://${preferredHost}:${LOCAL_HTTP_PORT}/BSP_display.html?hostMode=vmix&relay=ws://${preferredHost}:${LOCAL_RELAY_PORT}`,
    relayUrl: `ws://${preferredHost}:${LOCAL_RELAY_PORT}`,
    httpOwnedByHelper: ownsHttpPort,
    relayOwnedByHelper: ownsRelayPort
  };
}

function scheduleHttpRetry() {
  if (httpRetryTimer) return;
  httpRetryTimer = setTimeout(() => {
    httpRetryTimer = null;
    startHttpServer();
  }, 2000);
}

function scheduleRelayRetry() {
  if (relayRetryTimer) return;
  relayRetryTimer = setTimeout(() => {
    relayRetryTimer = null;
    startRelayServer();
  }, 2000);
}

function startHttpServer() {
  if (httpServer) return;
  const appRoot = path.resolve(path.join(__dirname, '..'));
  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = decodeURIComponent(url.pathname === '/' ? '/Bible Song Pro panel.html' : url.pathname);
    const target = path.resolve(path.join(appRoot, pathname.replace(/^\/+/, '')));
    if (!target.startsWith(appRoot + path.sep) && target !== appRoot) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': getContentType(target) });
      res.end(data);
    });
  });
  httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.log(`[helper] HTTP port ${LOCAL_HTTP_PORT} already in use, using existing server`);
      ownsHttpPort = false;
      try { httpServer.close(); } catch (_) {}
      httpServer = null;
      scheduleHttpRetry();
      return;
    }
    console.error('[helper] HTTP server error:', err && err.message ? err.message : err);
    ownsHttpPort = false;
    try { httpServer.close(); } catch (_) {}
    httpServer = null;
    scheduleHttpRetry();
  });
  httpServer.listen(LOCAL_HTTP_PORT, '0.0.0.0', () => {
    ownsHttpPort = true;
    if (httpRetryTimer) {
      clearTimeout(httpRetryTimer);
      httpRetryTimer = null;
    }
    console.log(`[helper] HTTP server listening on :${LOCAL_HTTP_PORT}`);
  });
}

function startRelayServer() {
  if (relayServer) return;
  relayServer = new WebSocketServer({ host: '0.0.0.0', port: LOCAL_RELAY_PORT });
  relayServer.on('listening', () => {
    ownsRelayPort = true;
    console.log(`[helper] Relay WS listening on :${LOCAL_RELAY_PORT}`);
  });
  relayServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.log(`[helper] Relay WS port ${LOCAL_RELAY_PORT} already in use, using existing relay`);
      ownsRelayPort = false;
      try { relayServer.close(); } catch (_) {}
      relayServer = null;
      scheduleRelayRetry();
      return;
    }
    console.error('[helper] Relay WS error:', err && err.message ? err.message : err);
    ownsRelayPort = false;
    try { relayServer.close(); } catch (_) {}
    relayServer = null;
    scheduleRelayRetry();
  });
  relayServer.on('connection', (socket) => {
    relayClients.add(socket);
    socket.on('close', () => relayClients.delete(socket));
    socket.on('message', (payload) => {
      relayClients.forEach((client) => {
        if (client === socket || client.readyState !== 1) return;
        client.send(payload.toString());
      });
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 490,
    height: 820,
    minWidth: 490,
    minHeight: 820,
    title: 'Bible Song Pro Ai Helper',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  const loadOptions = pendingAutoStartEngine ? { query: { autoStartEngine: '1' } } : undefined;
  win.loadFile(path.join(__dirname, 'index.html'), loadOptions);
  pendingAutoStartEngine = false;
  win.on('closed', () => { win = null; });
}

function focusWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  let attentionId = null;
  if (process.platform === 'darwin' && app.dock && typeof app.dock.bounce === 'function') {
    try { attentionId = app.dock.bounce('informational'); } catch (_) {}
  }
  try { app.focus({ steal: true }); } catch (_) {}
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  win.show();
  // On macOS, raising from a background app can be flaky when summoned
  // via relay; briefly toggle always-on-top to force z-order promotion.
  const wasAlwaysOnTop = win.isAlwaysOnTop();
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  try { win.moveTop(); } catch (_) {}
  win.focus();
  setTimeout(() => {
    try { win.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true }); } catch (_) {}
    try { win.setAlwaysOnTop(wasAlwaysOnTop); } catch (_) {}
    if (attentionId != null && app.dock && typeof app.dock.cancelBounce === 'function') {
      try { app.dock.cancelBounce(attentionId); } catch (_) {}
    }
  }, 250);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && systemPreferences && typeof systemPreferences.askForMediaAccess === 'function') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  });

  ipcMain.on('helper:focus', () => focusWindow());
  ipcMain.handle('helper:get-local-server-info', () => getLocalServerInfo());
  ipcMain.handle('helper:update-check', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only available in packaged builds.' };
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error && error.message ? String(error.message) : 'Failed to check updates.' };
    }
  });
  ipcMain.handle('helper:update-download', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only available in packaged builds.' };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error && error.message ? String(error.message) : 'Failed to download update.' };
    }
  });
  ipcMain.handle('helper:update-install', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only available in packaged builds.' };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });

  startHttpServer();
  startRelayServer();
  createWindow();
  setupHelperAutoUpdater();
  scheduleHelperAutoUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (httpRetryTimer) {
    clearTimeout(httpRetryTimer);
    httpRetryTimer = null;
  }
  if (relayRetryTimer) {
    clearTimeout(relayRetryTimer);
    relayRetryTimer = null;
  }
  if (httpServer) {
    try { httpServer.close(); } catch (_) {}
    httpServer = null;
  }
  if (relayServer) {
    try { relayServer.close(); } catch (_) {}
    relayServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance', (_event, argv) => {
  if (Array.isArray(argv) && argv.includes('--auto-start-engine')) {
    pendingAutoStartEngine = true;
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('helper:auto-start-engine'); } catch (_) {}
      pendingAutoStartEngine = false;
    }
  }
  focusWindow();
});
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
