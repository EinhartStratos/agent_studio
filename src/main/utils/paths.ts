import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function getUserDataPath(...segments: string[]): string {
  return path.join(app.getPath('userData'), ...segments);
}

/** 获取应用级 Pi Agent 配置目录（Electron userData 下的 .pi/agent） */
export function getAppAgentDir(): string {
  return getUserDataPath('.pi', 'agent');
}

/** 确保应用级 Pi Agent 配置目录存在 */
export function ensureAppAgentDir(): string {
  const dir = getAppAgentDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 获取应用级 skills 目录（位于 .pi/agent/skills） */
export function getAppSkillsDir(): string {
  return path.join(getAppAgentDir(), 'skills');
}

/** 确保应用级 skills 目录存在 */
export function ensureAppSkillsDir(): string {
  const dir = getAppSkillsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDefaultContentPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'default-content', 'index.html')
    : path.join(app.getAppPath(), 'resources/default-content/index.html');
}
