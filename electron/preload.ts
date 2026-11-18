import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatus } from '../shared/updater';
contextBridge.exposeInMainWorld('desktop', {
  displays: () => ipcRenderer.invoke('displays'),
  output: (displayId: number, profile: string) => ipcRenderer.invoke('output', displayId, profile),
  closeOutputs: () => ipcRenderer.invoke('close-outputs'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  openBrowser: (url: string) => ipcRenderer.invoke('open-browser', url),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  openReleases: () => ipcRenderer.invoke('update-releases'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
});
