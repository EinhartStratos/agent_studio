import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { IPC_CHANNELS } from '../shared/ipc-channels';

const CACHE_FILE = 'project-data.json';

function getCacheFilePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Failed to read cache ${filePath}:`, err);
    return defaultValue;
  }
}

function writeJsonFile<T>(filePath: string, value: T): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

interface ProjectCacheData {
  version: number;
  savedAt: string;
  myProjects: unknown[];
}

const DEFAULT_CACHE: ProjectCacheData = {
  version: 1,
  savedAt: '',
  myProjects: [],
};

export function registerProjectCacheIpc(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT_CACHE_LOAD, () => {
    const data = readJsonFile<ProjectCacheData>(getCacheFilePath(), DEFAULT_CACHE);
    return { ok: true, data };
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_CACHE_SAVE, (_event, payload: unknown) => {
    try {
      const raw = payload as { myProjects: unknown[] };
      const data: ProjectCacheData = {
        version: 1,
        savedAt: new Date().toISOString(),
        myProjects: Array.isArray(raw.myProjects) ? raw.myProjects : [],
      };
      writeJsonFile(getCacheFilePath(), data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
