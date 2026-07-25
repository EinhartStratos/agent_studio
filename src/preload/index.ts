import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  invokeAgent: (command: string, args: unknown[]) => ipcRenderer.invoke('agent:invoke', command, args),

  onAgentMessage: (callback: (message: string) => void) => {
    ipcRenderer.on('agent:message', (_event, message: string) => callback(message));
  },

  executeCommand: (command: string, args: string[]) => ipcRenderer.invoke('shell:execute', command, args),

  onUpdateProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('update:progress', (_event, progress: number) => callback(progress));
  },

  getAgentStatus: () => ipcRenderer.invoke('agent:get-status'),

  getAgentUpdateInfo: () => ipcRenderer.invoke('agent:get-update-info'),

  installAgentUpdate: (info: { version: string; url: string; hash?: string }) =>
    ipcRenderer.invoke('agent:install-update', info),

  onAgentUpdateProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('agent:update-progress', (_event, progress: number) => callback(progress));
  },

  onAgentUpdateStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('agent:update-status', (_event, status: string) => callback(status));
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
