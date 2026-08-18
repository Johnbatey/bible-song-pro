const { app, BrowserWindow, ipcMain, screen, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { spawn: spawnChild } = require('child_process');
const { WebSocketServer } = require('ws');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;
let outputWindow = null;
let outputClosedCallbacks = new Set();
let helperProcess = null;
let helperAutoStartRequestedAt = 0;
let httpServer = null;
let relayServer = null;
const relayClients = new Set();
const LOCAL_HTTP_PORT = 5510;
const LOCAL_RELAY_PORT = 5511;

function sendMainUpdateStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('bsp:update-status', payload || {});
}

function setupMainAutoUpdater() {
  if (!app.isPackaged) {
    sendMainUpdateStatus({ state: 'dev-mode' });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendMainUpdateStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendMainUpdateStatus({
      state: 'available',
      version: info && info.version ? String(info.version) : '',
      releaseNotes: info && info.releaseNotes ? String(info.releaseNotes) : ''
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendMainUpdateStatus({ state: 'none' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendMainUpdateStatus({
      state: 'downloading',
      percent: progress && typeof progress.percent === 'number' ? progress.percent : 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendMainUpdateStatus({
      state: 'downloaded',
      version: info && info.version ? String(info.version) : '',
      releaseNotes: info && info.releaseNotes ? String(info.releaseNotes) : ''
    });
  });

  autoUpdater.on('error', (error) => {
    sendMainUpdateStatus({
      state: 'error',
      message: error && error.message ? String(error.message) : 'Update failed'
    });
  });
}

function scheduleMainAutoUpdateCheck() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      sendMainUpdateStatus({
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
  if (ext === '.xml') return 'text/xml; charset=utf-8';
  return 'application/octet-stream';
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const out = [];
  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal) return;
      if (entry.family !== 'IPv4') return;
      out.push(entry.address);
    });
  });
  return [...new Set(out)];
}

function getLocalServerInfo() {
  const addresses = getLanAddresses();
  const preferredHost = addresses[0] || '127.0.0.1';
  return {
    httpPort: LOCAL_HTTP_PORT,
    relayPort: LOCAL_RELAY_PORT,
    preferredHost,
    availableHosts: ['127.0.0.1', ...addresses],
    displayPath: '/BSP_display.html',
    displayUrl: `http://${preferredHost}:${LOCAL_HTTP_PORT}/BSP_display.html?hostMode=vmix&relay=ws://${preferredHost}:${LOCAL_RELAY_PORT}`,
    relayUrl: `ws://${preferredHost}:${LOCAL_RELAY_PORT}`
  };
}

function startHttpServer() {
  if (httpServer) return;
  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = decodeURIComponent(url.pathname === '/' ? '/BSP_display.html' : url.pathname);
    const target = resolveAppFile(pathname.replace(/^\/+/, ''));
    if (!target.startsWith(path.join(__dirname, '..'))) {
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
      console.log(`[bsp] HTTP port ${LOCAL_HTTP_PORT} already in use, using existing server`);
      try { httpServer.close(); } catch (_) {}
      httpServer = null;
      return;
    }
    console.error('[bsp] HTTP server error:', err && err.message ? err.message : err);
  });
  httpServer.listen(LOCAL_HTTP_PORT, '0.0.0.0', () => {
    console.log(`[bsp] HTTP server listening on :${LOCAL_HTTP_PORT}`);
  });
}

function startRelayServer() {
  if (relayServer) return;
  relayServer = new WebSocketServer({ host: '0.0.0.0', port: LOCAL_RELAY_PORT });
  relayServer.on('listening', () => {
    console.log(`[bsp] Relay WS listening on :${LOCAL_RELAY_PORT}`);
  });
  relayServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.log(`[bsp] Relay WS port ${LOCAL_RELAY_PORT} already in use, using existing relay`);
      try { relayServer.close(); } catch (_) {}
      relayServer = null;
      return;
    }
    console.error('[bsp] Relay WS error:', err && err.message ? err.message : err);
  });
  relayServer.on('connection', (socket) => {
    relayClients.add(socket);
    socket.on('close', () => relayClients.delete(socket));
    socket.on('message', (payload) => {
      try {
        const parsed = JSON.parse(payload.toString());
        const msgType = String(parsed && parsed.type || '');
        if (msgType === 'ai:start' || msgType === 'ai:helper-summon') {
          openHelper({ autoStart: true });
        }
      } catch (_) {}
      relayClients.forEach((client) => {
        if (client === socket || client.readyState !== 1) return;
        client.send(payload.toString());
      });
    });
  });
}

function openHelper(options = {}) {
  // The helper-app uses a single-instance lock, so a duplicate spawn
  // simply triggers the existing process's `second-instance` event and
  // refocuses its window. ELECTRON_RUN_AS_NODE is stripped because if
  // it leaks through it would force the helper to run as plain Node
  // (no window). See scripts/launch.js for the same workaround.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const helperEntry = path.join(__dirname, '..', 'helper-app', 'main.js');
  const autoStart = !!options.autoStart;
  const helperArgs = [helperEntry];
  if (autoStart) {
    helperAutoStartRequestedAt = Date.now();
    helperArgs.push('--auto-start-engine');
  }
  try {
    helperProcess = spawnChild(process.execPath, helperArgs, {
      env,
      // Forward child stdio to BSP's terminal so any helper crash
      // is visible (was 'ignore' which hid silent failures).
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false
    });
    console.log('[bsp] spawned helper pid', helperProcess.pid);
    helperProcess.on('exit', (code, signal) => {
      console.log('[bsp] helper exited code=', code, 'signal=', signal);
      helperProcess = null;
    });
    helperProcess.on('error', (err) => {
      console.error('[bsp] failed to spawn helper:', err && err.message ? err.message : err);
    });
    return { ok: true, pid: helperProcess.pid, autoStartRequestedAt: helperAutoStartRequestedAt };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function broadcastRelayMessage(message) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  relayClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 560,
    minHeight: 760,
    backgroundColor: '#101318',
    title: 'Bible Song Pro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(resolveAppFile('Bible Song Pro panel.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.close();
    }
  });
}

function getDisplayBounds(displayId) {
  const displays = screen.getAllDisplays();
  if (displayId) {
    const match = displays.find((entry) => entry.id === displayId);
    if (match) return match.bounds;
  }
  const external = displays.find((entry) => !entry.internal) || screen.getPrimaryDisplay();
  return external.bounds;
}

function createOutputWindow(options = {}) {
  const bounds = getDisplayBounds(options.displayId);
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.setBounds(bounds);
    outputWindow.focus();
    return outputWindow;
  }

  outputWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    show: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreen: !!options.fullscreen,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  outputWindow.loadFile(resolveAppFile('BSP_display.html'), {
    query: {
      standalone: '1',
      hostMode: 'standalone'
    }
  });

  outputWindow.on('closed', () => {
    outputWindow = null;
    outputClosedCallbacks.forEach((webContentsId) => {
      const sender = BrowserWindow.fromWebContents(
        [...BrowserWindow.getAllWindows()]
          .map((win) => win.webContents)
          .find((contents) => contents.id === webContentsId)
      );
      if (sender && sender.webContents) {
        sender.webContents.send('bsp:output-closed');
      }
    });
  });

  return outputWindow;
}

function getSystemStats() {
  return {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      percent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
    },
    cpu: {
      percent: 0
    },
    gpu: {
      renderer: 'Electron',
      vram: ''
    }
  };
}

app.whenReady().then(() => {
  ipcMain.handle('bsp:get-displays', () => {
    return screen.getAllDisplays().map((display) => ({
      id: display.id,
      label: display.label || `Display ${display.id}`,
      width: display.bounds.width,
      height: display.bounds.height,
      x: display.bounds.x,
      y: display.bounds.y,
      isPrimary: display.id === screen.getPrimaryDisplay().id,
      isInternal: !!display.internal
    }));
  });

  ipcMain.handle('bsp:open-output', (event, options = {}) => {
    createOutputWindow(options);
    return { ok: true };
  });

  ipcMain.handle('bsp:close-output', () => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.close();
    }
    return { ok: true };
  });

  ipcMain.handle('bsp:is-output-open', () => {
    return !!(outputWindow && !outputWindow.isDestroyed());
  });

  ipcMain.handle('bsp:send-output-message', (_event, message) => {
    if (!outputWindow || outputWindow.isDestroyed()) return { ok: false };
    outputWindow.webContents.send('bsp:output-message', message);
    return { ok: true };
  });
  ipcMain.handle('bsp:send-vmix-output-message', (_event, message) => {
    broadcastRelayMessage(message);
    return { ok: true };
  });
  ipcMain.handle('bsp:open-helper', (_event, options = {}) => openHelper(options));
  ipcMain.handle('bsp:get-local-server-info', () => getLocalServerInfo());
  ipcMain.handle('bsp:copy-text', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.handle('bsp:request-output-fullscreen', () => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.setFullScreen(true);
    }
    return { ok: true };
  });

  ipcMain.handle('bsp:get-system-stats', () => getSystemStats());
  ipcMain.handle('bsp:update-check', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only available in packaged builds.' };
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error && error.message ? String(error.message) : 'Failed to check updates.' };
    }
  });
  ipcMain.handle('bsp:update-download', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only available in packaged builds.' };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error && error.message ? String(error.message) : 'Failed to download update.' };
    }
  });
  ipcMain.handle('bsp:update-install', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only available in packaged builds.' };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
  ipcMain.handle('bsp:save-theme', () => ({ ok: true }));
  ipcMain.handle('bsp:open-in-location', async (_event, targetPath) => {
    if (targetPath) await shell.showItemInFolder(targetPath);
    return { ok: true };
  });

  ipcMain.on('bsp:register-output-closed-listener', (event) => {
    outputClosedCallbacks.add(event.sender.id);
  });

  startHttpServer();
  startRelayServer();
  createMainWindow();
  setupMainAutoUpdater();
  scheduleMainAutoUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (httpServer) {
    try { httpServer.close(); } catch (e) {}
  }
  if (relayServer) {
    try { relayServer.close(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
