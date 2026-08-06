import type { ElectronAPI } from '../../preload';
import type { DefineComponent } from 'vue';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

declare module '*.vue' {
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
