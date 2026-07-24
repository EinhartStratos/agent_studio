import { BrowserWindow } from 'electron';
import path from 'node:path';
import { getContentIndexPath } from './update';
import { getDefaultContentPath } from './utils/paths';

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.cjs');
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
    loadContent(win, contentIndex);
  }

  return win;
}

function loadContent(win: BrowserWindow, target: string): void {
  win.loadFile(target).catch((err) => {
    console.error(`Failed to load ${target}:`, err);
    const fallback = getDefaultContentPath();
    win.loadFile(fallback).catch((err2) => {
      console.error(`Failed to load fallback ${fallback}:`, err2);
    });
  });
}
