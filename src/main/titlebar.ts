import { app, BrowserWindow, WebContentsView, ipcMain, Menu, type WebContents } from 'electron';
import path from 'node:path';
import { attachContextMenuToWebContents } from './context-menu';
import { loadConfig, updateConfig } from './config';

const TITLEBAR_HEIGHT = 28;
const MIN_FONT_SCALE = 0.5;
const MAX_FONT_SCALE = 2.0;
const FONT_SCALE_STEP = 0.1;

function clampFontScale(scale: number): number {
  return Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, scale));
}

function sendTheme(wc: WebContents, theme: 'dark' | 'light'): void {
  if (wc.isDestroyed()) return;
  wc.send('app:theme-change', theme);
}

function setContentZoom(contentView: WebContentsView, scale: number): void {
  if (contentView.webContents.isDestroyed()) return;
  contentView.webContents.setZoomFactor(clampFontScale(scale));
}

/** 对指定窗口应用当前主题、字体缩放和视图背景色 */
function applyDisplaySettings(win: BrowserWindow, config = loadConfig()): void {
  const theme = config.theme ?? 'dark';
  const fontScale = clampFontScale(config.fontScale ?? 1);

  if (!win.isDestroyed()) {
    sendTheme(win.webContents, theme);
  }

  const contentView = titlebarContentMap.get(win);
  if (contentView && !contentView.webContents.isDestroyed()) {
    sendTheme(contentView.webContents, theme);
    setContentZoom(contentView, fontScale);
    contentView.setBackgroundColor(theme === 'light' ? '#ffffff' : '#111111');
  }
}

/** 对所有窗口应用当前主题与字体缩放 */
function applyDisplaySettingsToAllWindows(): void {
  const config = loadConfig();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      applyDisplaySettings(win, config);
    }
  }
}

/** 记录每个窗口对应的内容视图，用于打开开发者工具/重新加载等操作 */
const titlebarContentMap = new WeakMap<BrowserWindow, WebContentsView>();

/** 获取标题栏 HTML 文件路径 */
function getTitlebarHtmlPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'titlebar', 'index.html')
    : path.join(app.getAppPath(), 'resources', 'titlebar', 'index.html');
}

/** 查找 WebContents 所属的 BrowserWindow */
function findParentWindow(webContents: Electron.WebContents): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents === webContents) return win;
    // 兼容使用 WebContentsView 子视图的情况（例如 attachTitlebar）
    for (const child of (win as any).contentView?.children ?? []) {
      if ((child as any).webContents === webContents) return win;
    }
  }
  return null;
}

/**
 * 给窗口附加自定义标题栏。
 *
 * 布局方式：
 * - 标题栏页面加载到窗口自身的 webContents，铺满整个窗口（实际只露出顶部 28px）
 * - 网页内容放进子 WebContentsView，定位在标题栏下方，两个视图各占一块区域，互不遮挡
 *
 * 返回内容视图，调用方用它加载真正的网页。
 */
export function attachTitlebar(win: BrowserWindow): WebContentsView {
  const preloadPath = path.join(__dirname, '../preload/index.cjs');

  const contentView = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const initialTheme = loadConfig().theme ?? 'dark';
  contentView.setBackgroundColor(initialTheme === 'light' ? '#ffffff' : '#111111');
  win.contentView.addChildView(contentView);

  const layout = (): void => {
    if (win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    contentView.setBounds({
      x: 0,
      y: TITLEBAR_HEIGHT,
      width,
      height: Math.max(0, height - TITLEBAR_HEIGHT),
    });
  };
  layout();
  win.on('resize', layout);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('restore', layout);

  // 记录窗口与内容视图的对应关系，供打开开发者工具等使用
  titlebarContentMap.set(win, contentView);

  // 页面加载完成/重新加载后应用主题与字体缩放
  const apply = (): void => applyDisplaySettings(win);
  win.webContents.on('did-finish-load', apply);
  contentView.webContents.on('did-finish-load', apply);
  apply();

  // 窗口最大化/还原时通知标题栏，更新最大化按钮图标
  const sendMaximizeState = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send('window:maximize-state', win.isMaximized());
  };
  win.on('maximize', sendMaximizeState);
  win.on('unmaximize', sendMaximizeState);

  win.webContents.loadFile(getTitlebarHtmlPath()).catch((err) => {
    console.error('Failed to load titlebar:', err);
  });

  attachContextMenuToWebContents(win, win.webContents);
  attachContextMenuToWebContents(win, contentView.webContents);

  return contentView;
}

/** 为浏览器窗口构建标题栏菜单（配置开启时显示开发者工具、主题/字体缩放） */
function buildTitlebarMenu(win: BrowserWindow): Menu {
  const config = loadConfig();
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (config.devTools) {
    template.push({
      label: '开发者工具',
      click: () => {
        const contentView = titlebarContentMap.get(win);
        const wc = contentView?.webContents ?? win.webContents;
        if (wc.isDevToolsOpened()) {
          wc.closeDevTools();
        } else {
          wc.openDevTools();
        }
      },
    });
  }

  if (template.length > 0) {
    template.push({ type: 'separator' });
  }

  template.push(
    {
      label: config.theme === 'light' ? '切换为深色模式' : '切换为浅色模式',
      click: () => {
        const current = loadConfig().theme ?? 'dark';
        const nextTheme = current === 'dark' ? 'light' : 'dark';
        updateConfig({ theme: nextTheme });
        applyDisplaySettingsToAllWindows();
      },
    },
    {
      label: '放大字体',
      click: () => {
        const current = clampFontScale(loadConfig().fontScale ?? 1);
        updateConfig({ fontScale: current + FONT_SCALE_STEP });
        applyDisplaySettingsToAllWindows();
      },
    },
    {
      label: '缩小字体',
      click: () => {
        const current = clampFontScale(loadConfig().fontScale ?? 1);
        updateConfig({ fontScale: current - FONT_SCALE_STEP });
        applyDisplaySettingsToAllWindows();
      },
    }
  );

  if (template.length > 0) {
    template.push({ type: 'separator' });
  }

  template.push(
    {
      label: '重新加载',
      click: () => {
        const contentView = titlebarContentMap.get(win);
        if (contentView) contentView.webContents.reload();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => win.close(),
    }
  );

  return Menu.buildFromTemplate(template);
}

/** 注册标题栏控制按钮的 IPC */
export function registerTitlebarIpc(): void {
  ipcMain.handle('window:minimize', (event) => {
    const win = findParentWindow(event.sender);
    if (win) win.minimize();
    return { ok: true };
  });

  ipcMain.handle('window:maximize', (event) => {
    const win = findParentWindow(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    return { ok: true };
  });

  ipcMain.handle('window:close', (event) => {
    const win = findParentWindow(event.sender);
    if (win) win.close();
    return { ok: true };
  });

  ipcMain.handle('window:maximize-state', (event) => {
    const win = findParentWindow(event.sender);
    return { isMaximized: win?.isMaximized() ?? false };
  });

  ipcMain.handle('window:open-devtools', (event) => {
    const win = findParentWindow(event.sender);
    if (!win) return { ok: false, error: 'no parent window' };
    // 优先使用 attachTitlebar 创建的子内容视图，否则直接对当前 WebContents 进行切换
    const contentView = titlebarContentMap.get(win);
    const wc = contentView?.webContents ?? event.sender;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools();
    }
    return { ok: true };
  });

  ipcMain.handle('window:show-menu', (event) => {
    const win = findParentWindow(event.sender);
    if (!win) return { ok: false, error: 'no parent window' };
    const menu = buildTitlebarMenu(win);
    menu.popup({ window: win });
    return { ok: true };
  });
}
