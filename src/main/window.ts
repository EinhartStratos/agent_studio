import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { loadConfig, resolveLogoPath } from './config';
import { getContentIndexPath } from './update';
import { getDefaultContentPath } from './utils/paths';
import { attachContextMenuToWebContents } from './context-menu';
import type { HomepageConfig } from '../shared/config';

function isDevMode(): boolean {
  return !app.isPackaged || !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === 'development';
}

function getDevServerUrl(): string | undefined {
  if (process.env.VITE_DEV_SERVER_URL) return process.env.VITE_DEV_SERVER_URL;
  if (isDevMode()) return 'http://localhost:5173/';
  return undefined;
}

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  const config = loadConfig();
  const homepage = config.homepage;
  const logoPath = resolveLogoPath(config.logo);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: homepage.title || 'Agent Studio',
    frame: false,
    autoHideMenuBar: true,
    icon: logoPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = getDevServerUrl();
  if (devServerUrl) {
    win.webContents.loadURL(devServerUrl).catch((err) => {
      console.error(`Failed to load dev server ${devServerUrl}:`, err);
      const fallback = getDefaultContentPath();
      win.webContents.loadFile(fallback).catch(console.error);
    });
    if (config.devTools) {
      win.webContents.openDevTools();
    }
  } else {
    const target = resolveHomepageTarget(homepage);
    loadContent(win, target);
  }

  attachContextMenuToWebContents(win, win.webContents);
  return win;
}

/** 根据配置决定首页加载目标 */
function resolveHomepageTarget(homepage: HomepageConfig): string {
  switch (homepage.type) {
    case 'url':
      return homepage.url || getContentIndexPath();
    case 'file':
      return resolveFilePath(homepage.file || '');
    case 'native':
      return getNativeContentPath();
    case 'default':
    default:
      return getContentIndexPath();
  }
}

/** 获取原生 UI 入口路径 */
function getNativeContentPath(): string {
  const devUrl = getDevServerUrl();
  if (devUrl) return devUrl;
  return path.join(app.getAppPath(), 'out', 'renderer', 'index.html');
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
    win.webContents.loadURL(target).catch((err: any) => handleLoadError(win, target, err));
  } else {
    win.webContents.loadFile(target).catch((err: any) => handleLoadError(win, target, err));
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
  win.webContents.loadFile(fallback).catch((err2: any) => {
    console.error(`Failed to load fallback ${fallback}:`, err2);
  });
}
