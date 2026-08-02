import path from 'node:path';
import fs from 'node:fs';
import { app, clipboard, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { PiSdkDriver } from './pi-sdk-driver';
import { broadcastToAllViews } from './utils/broadcast';

let driver: PiSdkDriver | null = null;

function getDefaultCwd(): string {
  return app.getPath('userData');
}

/** 把会话事件广播给渲染进程 */
function onSessionEvent(sessionId: string, event: any): void {
  broadcastToAllViews(IPC_CHANNELS.NATIVE_SESSION_EVENT, { sessionId, event });
}

/** 确保驱动已初始化 */
async function getDriver(): Promise<PiSdkDriver> {
  if (!driver) {
    driver = new PiSdkDriver(onSessionEvent);
    await driver.initialize(getDefaultCwd());
  }
  return driver;
}

/** 注册原生对话模式的 IPC 接口 */
export function registerNativeIpc(): void {
  ipcMain.handle(IPC_CHANNELS.NATIVE_INIT_DRIVER, async () => {
    try {
      const d = await getDriver();
      return { ok: true, health: d.getHealth() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_GET_HEALTH, async () => {
    if (!driver) return { ok: false, error: 'Driver not initialized' };
    return { ok: true, health: driver.getHealth() };
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_CREATE_SESSION, async (_event, workspacePath: string, name?: string, agentTemplateId?: string) => {
    try {
      const d = await getDriver();
      const ref = await d.createSession(workspacePath, name, agentTemplateId);
      return { ok: true, ref };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_OPEN_SESSION, async (_event, sessionFile: string) => {
    try {
      const d = await getDriver();
      const ref = await d.openSession(sessionFile);
      return { ok: true, ref };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_LIST_SESSIONS, async (_event, workspacePath: string) => {
    try {
      const d = await getDriver();
      const sessions = await d.listSessions(workspacePath);
      return { ok: true, sessions };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_SEND_MESSAGE, async (_event, sessionId: string, input: { text: string }) => {
    try {
      const d = await getDriver();
      await d.sendMessage(sessionId, input);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_CANCEL_RUN, async (_event, sessionId: string) => {
    try {
      const d = await getDriver();
      await d.cancelRun(sessionId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_GET_TRANSCRIPT, async (_event, sessionId: string) => {
    try {
      const d = await getDriver();
      const transcript = d.getTranscript(sessionId);
      return { ok: true, transcript };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_GET_SESSION_TREE, async (_event, sessionId: string) => {
    try {
      const d = await getDriver();
      const tree = d.getSessionTree(sessionId);
      return { ok: true, tree };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_NAVIGATE_TREE, async (_event, sessionId: string, targetId: string, summarize = false) => {
    try {
      const d = await getDriver();
      await d.navigateTree(sessionId, targetId, summarize);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_GET_WORKSPACE_TREE, async (_event, dirPath: string) => {
    try {
      const d = await getDriver();
      const tree = d.getWorkspaceTree(dirPath);
      return { ok: true, tree };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_GET_FILE_PREVIEW, async (_event, filePath: string) => {
    try {
      const d = await getDriver();
      const preview = await d.getFilePreview(filePath);
      return { ok: true, preview };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_PATH_EXISTS, async (_event, fsPath: string) => {
    try {
      if (!fsPath || typeof fsPath !== 'string') return { ok: true, exists: false, isFile: false, isDir: false };
      const exists = fs.existsSync(fsPath);
      if (!exists) return { ok: true, exists: false, isFile: false, isDir: false };
      const st = fs.statSync(fsPath);
      return { ok: true, exists: true, isFile: st.isFile(), isDir: st.isDirectory() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), exists: false, isFile: false, isDir: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_CLIPBOARD_COPY, async (_event, text: string) => {
    try {
      if (typeof text === 'string') clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_TOAST, async (_event, _message: string, _level?: string) => {
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_GET_DIFF, async (_event, filePath: string, oldContent?: string, newContent?: string) => {
    try {
      const d = await getDriver();
      const diff = await d.getDiff(filePath, oldContent, newContent);
      return { ok: true, diff };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_LIST_MODELS, async () => {
    try {
      const d = await getDriver();
      const models = await d.listModels();
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_SET_MODEL, async (_event, sessionId: string, providerId: string, modelId: string) => {
    try {
      const d = await getDriver();
      await d.setModel(sessionId, providerId, modelId);
      return { ok: true, health: d.getHealth() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_LIST_SKILLS, async (_event, sessionId: string) => {
    try {
      const d = await getDriver();
      const skills = d.listSkills(sessionId);
      return { ok: true, skills };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE_INVOKE_SKILL, async (_event, sessionId: string, skillName: string, args?: string) => {
    try {
      const d = await getDriver();
      await d.invokeSkill(sessionId, skillName, args);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
