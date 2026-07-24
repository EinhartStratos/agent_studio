import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { ensureContent } from './update';
import { startAgent, stopAgent, registerAgentIpc } from './agent';
import './security';

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  registerAgentIpc();
  await ensureContent(mainWindow ?? undefined);
  mainWindow = createMainWindow();
  await startAgent();
}

app.whenReady().then(bootstrap);

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
