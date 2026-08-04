import type { ElectronAPI } from '../../preload';

declare const window: Window & { electronAPI?: ElectronAPI };

function bindApi(): ElectronAPI {
  const raw = window.electronAPI;
  if (!raw) {
    throw new Error('[agent-studio] window.electronAPI is missing — preload script not injected.');
  }
  return raw as ElectronAPI;
}

export const api: ElectronAPI = bindApi();
