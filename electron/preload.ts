import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktop', {
  displays: () => ipcRenderer.invoke('displays'),
  output: (displayId: number, profile: string) => ipcRenderer.invoke('output', displayId, profile),
  closeOutputs: () => ipcRenderer.invoke('close-outputs'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  openBrowser: (url: string) => ipcRenderer.invoke('open-browser', url),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
});
