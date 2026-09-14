import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge } from 'electron';

// Custom APIs for renderer
const api = {};

// Expose only the necessary subset of electronAPI
const exposedElectronAPI = {
  ipcRenderer: {
    invoke: electronAPI.ipcRenderer.invoke,
    send: electronAPI.ipcRenderer.send,
    on: electronAPI.ipcRenderer.on,
    removeListener: electronAPI.ipcRenderer.removeListener,
    removeAllListeners: electronAPI.ipcRenderer.removeAllListeners,
  },
  process: {
    env: electronAPI.process.env,
    platform: electronAPI.process.platform,
    versions: electronAPI.process.versions,
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', exposedElectronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error('[Preload]Failed to expose APIs:', error as Error);
  }
} else {
  throw new Error('contextIsolation must be enabled for security');
}

export type WindowApiType = typeof api;
