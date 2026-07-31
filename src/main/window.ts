import { app, BrowserWindow, globalShortcut, type WebContents, type WebContentsView } from 'electron';
import path from 'node:path';
import { loadConfig, resolveLogoPath } from './config';
import { getContentIndexPath } from './update';
import { getDefaultContentPath } from './utils/paths';
import { attachTitlebar } from './titlebar';
import type { HomepageConfig } from '../shared/config';

const windowContentMap = new WeakMap<BrowserWindow, WebContents>();
let devToolsShortcutsRegistered = false;

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
      sandbox: true,
    },
  });

  // 标题栏占据窗口自身 webContents；网页内容放到标题栏下方的子视图
  const contentView = attachTitlebar(win);

  // 当配置开启时，注册 F12 和默认开发者工具快捷键
  if (config.devTools) {
    setupDevToolsShortcuts();
  }
  windowContentMap.set(win, contentView.webContents);

  if (process.env.VITE_DEV_SERVER_URL) {
    contentView.webContents.loadURL(process.env.VITE_DEV_SERVER_URL);
    contentView.webContents.openDevTools();
  } else {
    const target = resolveHomepageTarget(homepage);
    loadContent(contentView, target);
  }

  return win;
}

/** 注册全局开发者工具快捷键（F12 / Ctrl+Shift+I / Cmd+Option+I）
 *  仅当应用窗口处于焦点时生效，切换当前焦点窗口的内容视图开发者工具
 */
function setupDevToolsShortcuts(): void {
  if (devToolsShortcutsRegistered) return;
  devToolsShortcutsRegistered = true;

  const toggleDevTools = (): void => {
    const focusedWin = BrowserWindow.getFocusedWindow();
    if (!focusedWin) return;
    const wc = windowContentMap.get(focusedWin);
    if (!wc) return;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools();
    }
  };

  const defaultAccelerator = process.platform === 'darwin' ? 'Command+Option+I' : 'Ctrl+Shift+I';

  const register = (): void => {
    try {
      globalShortcut.unregisterAll();
      globalShortcut.register('F12', toggleDevTools);
      globalShortcut.register(defaultAccelerator, toggleDevTools);
    } catch (err) {
      console.error('Failed to register devtools shortcuts:', err);
    }
  };

  const unregister = (): void => {
    globalShortcut.unregisterAll();
  };

  app.on('browser-window-focus', register);
  app.on('browser-window-blur', unregister);
  app.on('window-all-closed', unregister);

  if (BrowserWindow.getFocusedWindow()) {
    register();
  }
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
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  // 打包后 out/ 在 app.asar 内部，和 dev 时一样用 app.getAppPath() 作为根目录
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
function loadContent(view: WebContentsView, target: string): void {
  if (isHttpUrl(target)) {
    view.webContents.loadURL(target).catch((err) => handleLoadError(view, target, err));
  } else {
    view.webContents.loadFile(target).catch((err) => handleLoadError(view, target, err));
  }
}

/** 判断目标是否为 http/https URL */
function isHttpUrl(target: string): boolean {
  return target.startsWith('http://') || target.startsWith('https://');
}

/** 加载失败时回退到默认状态页 */
function handleLoadError(view: WebContentsView, target: string, err: Error): void {
  console.error(`Failed to load ${target}:`, err);
  const fallback = getDefaultContentPath();
  view.webContents.loadFile(fallback).catch((err2) => {
    console.error(`Failed to load fallback ${fallback}:`, err2);
  });
}
