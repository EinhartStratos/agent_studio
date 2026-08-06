import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppConfig } from '../shared/config';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { MarketplaceAgent, MarketplaceCategory, UploadAgentRequest } from '../shared/types';

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

  getAppConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,

  setAppConfig: (config: AppConfig) =>
    ipcRenderer.invoke('config:set', config) as Promise<{ ok: boolean; config?: AppConfig; error?: string }>,

  updateAppConfig: (partial: Partial<AppConfig>) =>
    ipcRenderer.invoke('config:update', partial) as Promise<{ ok: boolean; config?: AppConfig; error?: string }>,

  restartAgent: () => ipcRenderer.invoke('agent:restart') as Promise<{ ok: boolean; error?: string }>,

  // 标题栏窗口控制
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowGetMaximizeState: () => ipcRenderer.invoke('window:maximize-state') as Promise<{ isMaximized: boolean }>,
  onMaximizeStateChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window:maximize-state', handler);
    return () => {
      ipcRenderer.removeListener('window:maximize-state', handler);
    };
  },
  openDevTools: () => ipcRenderer.invoke('window:open-devtools') as Promise<{ ok: boolean; error?: string }>,
  windowShowMenu: () => ipcRenderer.invoke('window:show-menu') as Promise<{ ok: boolean; error?: string }>,

  onThemeChange: (callback: (theme: 'dark' | 'light') => void) => {
    const handler = (_event: IpcRendererEvent, theme: 'dark' | 'light') => callback(theme);
    ipcRenderer.on('app:theme-change', handler);
    return () => {
      ipcRenderer.removeListener('app:theme-change', handler);
    };
  },

  // 原生对话模式
  nativeInitDriver: () => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_INIT_DRIVER),
  nativeGetHealth: () => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_GET_HEALTH),
  nativeCreateSession: (workspacePath: string, name?: string, agentTemplateId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_CREATE_SESSION, workspacePath, name, agentTemplateId),
  nativeOpenSession: (sessionFile: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_OPEN_SESSION, sessionFile),
  nativeListSessions: (workspacePath: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_LIST_SESSIONS, workspacePath),
  nativeSendMessage: (sessionId: string, input: { text: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_SEND_MESSAGE, sessionId, input),
  nativeCancelRun: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_CANCEL_RUN, sessionId),
  nativeGetTranscript: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_GET_TRANSCRIPT, sessionId),
  nativeGetSessionTree: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_GET_SESSION_TREE, sessionId),
  nativeNavigateTree: (sessionId: string, targetId: string, summarize?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_NAVIGATE_TREE, sessionId, targetId, summarize),
  nativeGetWorkspaceTree: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_GET_WORKSPACE_TREE, dirPath),
  nativeSelectDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_SELECT_DIRECTORY) as Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>,
  nativeGetFilePreview: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_GET_FILE_PREVIEW, filePath),
  nativePathExists: (fsPath: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_PATH_EXISTS, fsPath),
  nativeClipboardCopy: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_CLIPBOARD_COPY, text),
  nativeShowToast: (message: string, level?: 'info' | 'warn' | 'error' | 'success') =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_TOAST, message, level),
  nativeGetDiff: (filePath: string, oldContent?: string, newContent?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_GET_DIFF, filePath, oldContent, newContent),
  nativeListModels: () => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_LIST_MODELS),
  nativeSetModel: (sessionId: string, providerId: string, modelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_SET_MODEL, sessionId, providerId, modelId),
  nativeListSkills: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.NATIVE_LIST_SKILLS, sessionId),
  nativeInvokeSkill: (sessionId: string, skillName: string, args?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_INVOKE_SKILL, sessionId, skillName, args),
  nativeDeleteSession: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_DELETE_SESSION, sessionId) as Promise<{ ok: boolean; error?: string }>,
  nativeRenameSession: (sessionId: string, name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NATIVE_RENAME_SESSION, sessionId, name) as Promise<{ ok: boolean; error?: string }>,

  onNativeSessionEvent: (callback: (event: { sessionId: string; event: unknown }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.NATIVE_SESSION_EVENT, (_event, payload) => callback(payload));
  },

  marketplaceGetCategories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE_GET_CATEGORIES) as Promise<{ ok: boolean; categories?: MarketplaceCategory[]; error?: string }>,

  marketplaceListAgents: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE_LIST_AGENTS) as Promise<{ ok: boolean; agents?: MarketplaceAgent[]; error?: string }>,

  marketplaceUploadAgent: (request: UploadAgentRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE_UPLOAD_AGENT, request) as Promise<{ ok: boolean; agent?: MarketplaceAgent; error?: string }>,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
