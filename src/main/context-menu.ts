import { BrowserWindow, Menu, MenuItem, type WebContents } from 'electron';

function buildContextMenu(params: Electron.ContextMenuParams): Menu {
  const menu = new Menu();

  if (params.editFlags.canUndo) {
    menu.append(new MenuItem({ label: '撤销', role: 'undo' }));
  }

  if (params.editFlags.canRedo) {
    menu.append(new MenuItem({ label: '重做', role: 'redo' }));
  }

  if (params.editFlags.canUndo || params.editFlags.canRedo) {
    menu.append(new MenuItem({ type: 'separator' }));
  }

  if (params.editFlags.canCut) {
    menu.append(new MenuItem({ label: '剪切', role: 'cut' }));
  }

  if (params.editFlags.canCopy) {
    menu.append(new MenuItem({ label: '复制', role: 'copy' }));
  }

  if (params.editFlags.canPaste) {
    menu.append(new MenuItem({ label: '粘贴', role: 'paste' }));
  }

  if (params.editFlags.canSelectAll) {
    menu.append(new MenuItem({ label: '全选', role: 'selectAll' }));
  }

  return menu;
}

/** 给指定 WebContents 附加右键上下文菜单，菜单显示在指定窗口上 */
export function attachContextMenuToWebContents(win: BrowserWindow, webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const menu = buildContextMenu(params);
    if (menu.items.length === 0) return;
    menu.popup({ window: win });
  });
}
