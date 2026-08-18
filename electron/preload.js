const { contextBridge, ipcRenderer } = require('electron');

const BSPDesktop = {
  async getDisplays() {
    return ipcRenderer.invoke('bsp:get-displays');
  },
  async openOutput(options = {}) {
    return ipcRenderer.invoke('bsp:open-output', options);
  },
  async closeOutput() {
    return ipcRenderer.invoke('bsp:close-output');
  },
  async isOutputOpen() {
    return ipcRenderer.invoke('bsp:is-output-open');
  },
  async sendOutputMessage(message) {
    return ipcRenderer.invoke('bsp:send-output-message', message);
  },
  async sendVmixOutputMessage(message) {
    return ipcRenderer.invoke('bsp:send-vmix-output-message', message);
  },
  async requestOutputFullscreen() {
    return ipcRenderer.invoke('bsp:request-output-fullscreen');
  },
  async getLocalServerInfo() {
    return ipcRenderer.invoke('bsp:get-local-server-info');
  },
  async copyText(text) {
    return ipcRenderer.invoke('bsp:copy-text', text);
  },
  async getSystemStats() {
    return ipcRenderer.invoke('bsp:get-system-stats');
  },
  async openHelper(options = {}) {
    return ipcRenderer.invoke('bsp:open-helper', options);
  },
  async saveTheme(theme) {
    return ipcRenderer.invoke('bsp:save-theme', theme);
  },
  async openRecordingInLocation(payload = {}) {
    return ipcRenderer.invoke('bsp:open-in-location', payload.path);
  },
  async checkForUpdates() {
    return ipcRenderer.invoke('bsp:update-check');
  },
  async downloadUpdate() {
    return ipcRenderer.invoke('bsp:update-download');
  },
  async installUpdateNow() {
    return ipcRenderer.invoke('bsp:update-install');
  },
  onOutputClosed(callback) {
    ipcRenderer.removeAllListeners('bsp:output-closed');
    ipcRenderer.on('bsp:output-closed', () => callback());
  },
  onUpdateStatus(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.removeAllListeners('bsp:update-status');
    ipcRenderer.on('bsp:update-status', (_event, payload) => callback(payload || {}));
  }
};

contextBridge.exposeInMainWorld('BSPDesktop', BSPDesktop);

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('bsp:register-output-closed-listener');
});

ipcRenderer.on('bsp:output-message', (_event, message) => {
  window.postMessage(message, '*');
});
