import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import path from 'node:path';
import { attachContextMenuToWebContents } from './context-menu';

const TITLEBAR_HEIGHT = 40;

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
  }
  return null;
}

/**
 * 给窗口附加自定义标题栏。
 *
 * 布局方式：
 * - 标题栏页面加载到窗口自身的 webContents，铺满整个窗口（实际只露出顶部 40px）
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
  contentView.setBackgroundColor('#111111');
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

  win.webContents.loadFile(getTitlebarHtmlPath()).catch((err) => {
    console.error('Failed to load titlebar:', err);
  });

  attachContextMenuToWebContents(win, win.webContents);
  attachContextMenuToWebContents(win, contentView.webContents);

  return contentView;
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
}
