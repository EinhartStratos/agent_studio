import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentIndexPath } from './update';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const contentIndex = getContentIndexPath();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(contentIndex).catch((err) => {
      console.error('Failed to load content index:', err);
    });
  }

  return win;
}
