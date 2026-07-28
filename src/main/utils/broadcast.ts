import { BrowserWindow, WebContentsView } from 'electron';

/** 向所有窗口的标题栏和内容视图广播消息 */
export function broadcastToAllViews(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win.isDestroyed()) return;
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
    for (const view of win.contentView.children) {
      if (view instanceof WebContentsView && !view.webContents.isDestroyed()) {
        view.webContents.send(channel, ...args);
      }
    }
  });
}
