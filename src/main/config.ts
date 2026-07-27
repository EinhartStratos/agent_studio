import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AppConfig, HomepageConfig, HomepageType, PiConfig } from '../shared/config';

const DEFAULT_CONFIG: AppConfig = {
  homepage: {
    type: 'default',
    url: '',
    file: '',
    title: 'Agent Studio',
  },
  pi: {
    updateManifestUrl: '',
    args: ['--mode', 'rpc'],
  },
};

/** 用户覆盖配置的内部格式：只保存与默认值不同的部分 */
interface UserAppConfig {
  homepage?: Partial<HomepageConfig>;
  pi?: Partial<PiConfig>;
}

/** 获取打包时内置的默认配置文件路径 */
function getBundledConfigPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'config', 'app-config.json')
    : path.join(app.getAppPath(), 'resources', 'config', 'app-config.json');
}

/** 获取用户运行时覆盖的配置文件路径 */
function getUserConfigPath(): string {
  return path.join(app.getPath('userData'), 'config', 'app-config.json');
}

/** 读取 JSON 配置文件，失败时返回默认值 */
function readJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Failed to read config ${filePath}:`, err);
    return defaultValue;
  }
}

/** 写入 JSON 配置文件 */
function writeJsonFile<T>(filePath: string, value: T): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

/** 比较两个数组是否相等 */
function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 计算两个 homepage 配置的差异 */
function diffHomepage(bundled: HomepageConfig, target: HomepageConfig): Partial<HomepageConfig> | undefined {
  const diff: Partial<HomepageConfig> = {};
  let hasDiff = false;
  for (const key of ['type', 'url', 'file', 'title'] as (keyof HomepageConfig)[]) {
    if (target[key] !== bundled[key]) {
      (diff as Record<string, unknown>)[key] = target[key];
      hasDiff = true;
    }
  }
  return hasDiff ? diff : undefined;
}

/** 计算两个 pi 配置的差异 */
function diffPi(bundled: PiConfig, target: PiConfig): Partial<PiConfig> | undefined {
  const diff: Partial<PiConfig> = {};
  let hasDiff = false;
  if (target.updateManifestUrl !== bundled.updateManifestUrl) {
    diff.updateManifestUrl = target.updateManifestUrl;
    hasDiff = true;
  }
  if (!arraysEqual(target.args ?? [], bundled.args ?? [])) {
    diff.args = target.args;
    hasDiff = true;
  }
  return hasDiff ? diff : undefined;
}

/** 计算目标配置相对于默认配置的覆盖项 */
function diffAppConfig(bundled: AppConfig, target: AppConfig): UserAppConfig {
  const result: UserAppConfig = {};
  const homepage = diffHomepage(bundled.homepage, target.homepage);
  if (homepage) result.homepage = homepage;
  const pi = diffPi(bundled.pi, target.pi);
  if (pi) result.pi = pi;
  return result;
}

/** 合并默认配置和用户覆盖项 */
function mergeAppConfig(base: AppConfig, override: UserAppConfig): AppConfig {
  return {
    homepage: {
      ...base.homepage,
      ...(override.homepage ?? {}),
    } as HomepageConfig,
    pi: {
      ...base.pi,
      ...(override.pi ?? {}),
    } as PiConfig,
  };
}

/** 加载有效配置：默认配置 + 用户覆盖 */
export function loadConfig(): AppConfig {
  const bundled = readJsonFile<AppConfig>(getBundledConfigPath(), DEFAULT_CONFIG);
  const user = readJsonFile<UserAppConfig>(getUserConfigPath(), {});
  return mergeAppConfig(bundled, user);
}

/** 用完整配置替换用户覆盖项，只写入与默认配置不同的部分 */
export function setConfig(config: AppConfig): AppConfig {
  const bundled = readJsonFile<AppConfig>(getBundledConfigPath(), DEFAULT_CONFIG);
  const diff = diffAppConfig(bundled, config);
  writeJsonFile(getUserConfigPath(), diff);
  return loadConfig();
}

/** 用局部更新合并当前用户覆盖项 */
export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const user = readJsonFile<UserAppConfig>(getUserConfigPath(), {});
  const newUser: UserAppConfig = {};
  if (partial.homepage !== undefined) {
    newUser.homepage = { ...user.homepage, ...partial.homepage } as Partial<HomepageConfig>;
  }
  if (partial.pi !== undefined) {
    newUser.pi = { ...user.pi, ...partial.pi } as Partial<PiConfig>;
  }
  writeJsonFile(getUserConfigPath(), newUser);
  return loadConfig();
}

/** 校验 homepage 配置 */
function validateHomepage(value: unknown): HomepageConfig {
  const result: HomepageConfig = {
    type: 'default',
    url: '',
    file: '',
    title: 'Agent Studio',
  };
  if (!value || typeof value !== 'object') {
    return result;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.type === 'string') {
    if (!['default', 'url', 'file'].includes(raw.type)) {
      throw new Error(`Invalid homepage type: ${raw.type}`);
    }
    result.type = raw.type as HomepageType;
  }
  if (typeof raw.url === 'string') {
    result.url = raw.url;
  }
  if (typeof raw.file === 'string') {
    result.file = raw.file;
  }
  if (typeof raw.title === 'string') {
    result.title = raw.title;
  }
  if (result.type === 'url' && result.url && !result.url.match(/^https?:\/\//i)) {
    throw new Error('homepage.url must start with http:// or https://');
  }
  if (result.type === 'file' && result.file?.includes('..')) {
    throw new Error('homepage.file relative path cannot contain ".."');
  }
  return result;
}

/** 校验 Pi 配置 */
function validatePi(value: unknown): PiConfig {
  const result: PiConfig = {
    updateManifestUrl: '',
    args: ['--mode', 'rpc'],
  };
  if (!value || typeof value !== 'object') {
    return result;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.updateManifestUrl === 'string') {
    result.updateManifestUrl = raw.updateManifestUrl;
  }
  if (Array.isArray(raw.args)) {
    if (!raw.args.every((arg) => typeof arg === 'string')) {
      throw new Error('pi.args must be an array of strings');
    }
    result.args = raw.args as string[];
  }
  return result;
}

/** 校验完整配置 */
function validateConfig(value: unknown): AppConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Config must be an object');
  }
  const raw = value as Record<string, unknown>;
  return {
    homepage: validateHomepage(raw.homepage),
    pi: validatePi(raw.pi),
  };
}

/** 校验局部配置 */
function validatePartialConfig(value: unknown): Partial<AppConfig> {
  if (!value || typeof value !== 'object') {
    throw new Error('Config partial must be an object');
  }
  const raw = value as Partial<Record<'homepage' | 'pi', unknown>>;
  const result: Partial<AppConfig> = {};
  if (raw.homepage !== undefined) {
    result.homepage = validateHomepage(raw.homepage);
  }
  if (raw.pi !== undefined) {
    result.pi = validatePi(raw.pi);
  }
  return result;
}

/** 注册配置相关的 IPC 接口 */
export function registerConfigIpc(): void {
  ipcMain.handle('config:get', () => loadConfig());

  ipcMain.handle('config:set', (_event, config: unknown) => {
    try {
      const parsed = validateConfig(config);
      const updated = setConfig(parsed);
      return { ok: true, config: updated };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('config:update', (_event, partial: unknown) => {
    try {
      const parsed = validatePartialConfig(partial);
      const updated = updateConfig(parsed);
      return { ok: true, config: updated };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
