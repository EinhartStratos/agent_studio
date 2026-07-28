import { app, BrowserView, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { attachContextMenuToWebContents } from './context-menu';

const TITLEBAR_HEIGHT = 40;

/** 获取标题栏 HTML 文件路径 */
function getTitlebarHtmlPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'titlebar', 'index.html')
    : path.join(app.getAppPath(), 'resources', 'titlebar', 'index.html');
}

/** 查找 WebContents 所属的 BrowserWindow（支持 BrowserView） */
function findParentWindow(webContents: Electron.WebContents): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents === webContents) return win;
    const view = win.getBrowserView();
    if (view?.webContents === webContents) return win;
  }
  return null;
}

/** 更新标题栏视图尺寸 */
function updateTitlebarBounds(win: BrowserWindow, view: BrowserView): void {
  const [width] = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
}

/** 给窗口附加自定义标题栏 */
export function attachTitlebar(win: BrowserWindow): void {
  const preloadPath = path.join(__dirname, '../preload/index.cjs');

  const view = new BrowserView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setBrowserView(view);
  updateTitlebarBounds(win, view);

  view.webContents.loadFile(getTitlebarHtmlPath()).catch((err) => {
    console.error('Failed to load titlebar:', err);
  });

  attachContextMenuToWebContents(win, view.webContents);

  win.on('resize', () => updateTitlebarBounds(win, view));
  win.on('maximize', () => updateTitlebarBounds(win, view));
  win.on('unmaximize', () => updateTitlebarBounds(win, view));

  // 给主窗口内容增加顶部内边距，避免被标题栏遮挡
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS('body { padding-top: 40px !important; }').catch((err) => {
      console.error('Failed to insert titlebar padding CSS:', err);
    });
  });
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
