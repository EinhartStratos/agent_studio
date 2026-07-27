import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { loadConfig } from './config';
import { getContentIndexPath } from './update';
import { getDefaultContentPath } from './utils/paths';
import type { HomepageConfig } from '../shared/config';

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  const config = loadConfig();
  const homepage = config.homepage;

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: homepage.title || 'Agent Studio',
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
    const target = resolveHomepageTarget(homepage);
    loadContent(win, target);
  }

  return win;
}

/** 根据配置决定首页加载目标 */
function resolveHomepageTarget(homepage: HomepageConfig): string {
  switch (homepage.type) {
    case 'url':
      return homepage.url || getContentIndexPath();
    case 'file':
      return resolveFilePath(homepage.file || '');
    case 'default':
    default:
      return getContentIndexPath();
  }
}

/** 把 file 配置解析成绝对路径 */
function resolveFilePath(file: string): string {
  if (!file) {
    return getDefaultContentPath();
  }
  if (path.isAbsolute(file)) {
    return file;
  }
  const baseDir = app.isPackaged
    ? path.join(process.resourcesPath, 'config')
    : path.join(app.getAppPath(), 'resources', 'config');
  return path.join(baseDir, file);
}

/** 加载首页，支持 URL 和本地文件 */
function loadContent(win: BrowserWindow, target: string): void {
  if (isHttpUrl(target)) {
    win.loadURL(target).catch((err) => handleLoadError(win, target, err));
  } else {
    win.loadFile(target).catch((err) => handleLoadError(win, target, err));
  }
}

/** 判断目标是否为 http/https URL */
function isHttpUrl(target: string): boolean {
  return target.startsWith('http://') || target.startsWith('https://');
}

/** 加载失败时回退到默认状态页 */
function handleLoadError(win: BrowserWindow, target: string, err: Error): void {
  console.error(`Failed to load ${target}:`, err);
  const fallback = getDefaultContentPath();
  win.loadFile(fallback).catch((err2) => {
    console.error(`Failed to load fallback ${fallback}:`, err2);
  });
}
