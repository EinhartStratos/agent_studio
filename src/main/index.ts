import { app, BrowserWindow, Menu } from 'electron';
import { createMainWindow } from './window';
import { ensureContent } from './update';
import { startAgent, stopAgent, registerAgentIpc } from './agent';
import { registerAgentUpdateIpc } from './agent-update';
import { registerConfigIpc, loadConfig, applyLogo } from './config';
import { registerTitlebarIpc } from './titlebar';
import './security';

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  registerConfigIpc();
  registerTitlebarIpc();
  registerAgentIpc();
  registerAgentUpdateIpc();

  // 在创建窗口前应用 Logo 到 Dock（macOS）
  const config = loadConfig();
  applyLogo(config);

  await ensureContent();
  mainWindow = createMainWindow();
  await startAgent();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  bootstrap();
});

app.on('window-all-closed', () => {
  stopAgent();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createMainWindow();
  }
});
