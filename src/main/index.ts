import { app, BrowserWindow, Menu } from 'electron';
import { createMainWindow } from './window';
import { ensureContent } from './update';
import { startAgent, stopAgent, registerAgentIpc } from './agent';
import { registerAgentUpdateIpc } from './agent-update';
import { registerConfigIpc, loadConfig, applyLogo } from './config';
import { registerTitlebarIpc } from './titlebar';
import { registerNativeIpc } from './native-ipc';
import './security';

/** 全局兜底：EPIPE 是 pi 子进程已挂但 stdin 还在写的常见错误，
 *  它会从 node:internal/stream_base_commons → Socket._write 冒泡成 uncaught exception。
 *  这里把 code=EPIPE / ERR_STREAM_* 静默吞掉（只打 console.error），不弹 Electron 崩溃对话框。
 */
function installProcessErrorGuards(): void {
  process.on('uncaughtException', (err) => {
    const code = typeof (err as any)?.code === 'string' ? String((err as any).code) : '';
    const msg = typeof err?.message === 'string' ? err.message : String(err);
    const swallowCodes = new Set([
      'EPIPE',
      'ERR_STREAM_DESTROYED',
      'ERR_STREAM_WRITE_AFTER_END',
      'ECONNRESET',
      'ECONNABORTED',
    ]);
    if (swallowCodes.has(code) || /write EPIPE|afterWriteDispatched|Socket\._writeGeneric/i.test(msg)) {
      // eslint-disable-next-line no-console
      console.error('[agent-studio] swallowed main-process uncaught (pi stdin write):', code || msg, err?.stack ?? '');
      return;
    }
    // 其他错误按默认行为处理（让 Electron 自己弹或抛）
    // eslint-disable-next-line no-console
    console.error('[agent-studio] main-process uncaughtException:', err);
  });
  process.on('unhandledRejection', (reason) => {
    const code = typeof (reason as any)?.code === 'string' ? String((reason as any).code) : '';
    const msg = reason instanceof Error ? reason.message : String(reason ?? '');
    const swallowCodes = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);
    if (swallowCodes.has(code)) {
      // eslint-disable-next-line no-console
      console.error('[agent-studio] swallowed main-process unhandledRejection (pi stdin):', code, reason instanceof Error ? reason.stack ?? '' : msg);
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[agent-studio] main-process unhandledRejection:', reason);
  });
}

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  registerConfigIpc();
  registerTitlebarIpc();
  registerAgentIpc();
  registerAgentUpdateIpc();
  registerNativeIpc();

  // 在创建窗口前应用 Logo 到 Dock（macOS）
  const config = loadConfig();
  applyLogo(config);

  await ensureContent();
  mainWindow = createMainWindow();
  await startAgent();
}

app.whenReady().then(() => {
  installProcessErrorGuards();
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
