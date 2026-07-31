import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { api } from './api';

function applyTheme(theme: 'dark' | 'light'): void {
  if (theme === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
}

(async function init(): Promise<void> {
  try {
    const config = await api.getAppConfig();
    applyTheme(config.theme ?? 'dark');
  } catch (err) {
    console.error('Failed to init theme:', err);
  }

  if (api.onThemeChange) {
    api.onThemeChange((theme) => applyTheme(theme));
  }

  const root = document.getElementById('root');
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }
})();
