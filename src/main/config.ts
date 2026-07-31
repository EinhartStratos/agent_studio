import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AppConfig, HomepageConfig, HomepageType, ModelConfig, ModelsConfig, NativeConfig, PiConfig } from '../shared/config';

const DEFAULT_CONFIG: AppConfig = {
  homepage: {
    type: 'native',
    url: '',
    file: '',
    title: 'Agent Studio',
  },
  pi: {
    updateManifestUrl: '',
    args: ['--mode', 'rpc'],
  },
  models: {
    default: {
      provider: 'openai',
      modelId: 'gpt-4o',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: '',
      enabled: true,
    },
  },
  selectedModel: 'default',
  native: {
    defaultWorkspace: '',
    sqliteDb: '',
  },
  logo: 'logo.png',
  devTools: false,
  theme: 'dark',
  fontScale: 1,
};

/** 用户覆盖配置的内部格式：只保存与默认值不同的部分 */
interface UserAppConfig {
  homepage?: Partial<HomepageConfig>;
  pi?: Partial<PiConfig>;
  models?: Partial<ModelsConfig>;
  selectedModel?: string;
  native?: Partial<NativeConfig>;
  [key: string]: unknown;
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

/** 浅拷贝对象 */
function shallowClone<T extends Record<string, unknown>>(value: T): T {
  return { ...value };
}

/** 判断值是否为普通对象 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 解析 Logo 路径：绝对路径直接使用，相对路径优先从用户配置目录查找，再从默认资源目录查找 */
export function resolveLogoPath(logo?: string): string | undefined {
  if (!logo || typeof logo !== 'string') return undefined;
  if (path.isAbsolute(logo)) {
    return fs.existsSync(logo) ? logo : undefined;
  }
  const candidates = [
    path.join(app.getPath('userData'), 'config', logo),
    app.isPackaged
      ? path.join(process.resourcesPath, 'config', logo)
      : path.join(app.getAppPath(), 'resources', 'config', logo),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 应用 Logo 到 Dock（macOS）或所有窗口（Windows/Linux） */
export function applyLogo(config: AppConfig): void {
  const logoPath = resolveLogoPath(config.logo);
  if (!logoPath) return;
  try {
    if (process.platform === 'darwin') {
      app.dock?.setIcon(logoPath);
    } else {
      for (const win of BrowserWindow.getAllWindows()) {
        win.setIcon(logoPath);
      }
    }
  } catch (err) {
    console.error('Failed to apply logo:', err);
  }
}

/** 计算两个对象的差异，返回 override 中与 base 不同的字段 */
function diffObject<T extends Record<string, unknown>>(
  base: T,
  override: T,
  knownArrayKeys: string[] = []
): Partial<T> | undefined {
  const diff: Partial<T> = {};
  let hasDiff = false;
  const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);
  for (const key of allKeys) {
    const b = (base as Record<string, unknown>)[key];
    const o = (override as Record<string, unknown>)[key];
    if (o === undefined) continue;
    if (knownArrayKeys.includes(key) && Array.isArray(o) && Array.isArray(b)) {
      if (!arraysEqual(o, b)) {
        (diff as Record<string, unknown>)[key] = o;
        hasDiff = true;
      }
    } else if (o !== b) {
      (diff as Record<string, unknown>)[key] = o;
      hasDiff = true;
    }
  }
  return hasDiff ? diff : undefined;
}

/** 计算目标配置相对于默认配置的覆盖项 */
function diffAppConfig(bundled: AppConfig, target: AppConfig): UserAppConfig {
  const result: UserAppConfig = {};
  const homepage = diffObject(bundled.homepage, target.homepage, ['args']);
  if (homepage) result.homepage = homepage as Partial<HomepageConfig>;
  const pi = diffObject(bundled.pi, target.pi, ['args']);
  if (pi) result.pi = pi as Partial<PiConfig>;
  const native = diffObject(bundled.native ?? {}, target.native ?? {});
  if (native) result.native = native as Partial<NativeConfig>;

  const allTopKeys = new Set([...Object.keys(bundled), ...Object.keys(target)]);
  for (const key of allTopKeys) {
    if (key === 'homepage' || key === 'pi' || key === 'native') continue;
    const b = (bundled as Record<string, unknown>)[key];
    const t = (target as Record<string, unknown>)[key];
    if (t !== b) {
      (result as Record<string, unknown>)[key] = t;
    }
  }
  return result;
}

/** 合并默认配置和用户覆盖项 */
function mergeAppConfig(base: AppConfig, override: UserAppConfig): AppConfig {
  // 先拷贝 base 顶层字段，再覆盖用户自定义项
  const result: AppConfig = {
    ...base,
    homepage: { ...base.homepage, ...(override.homepage ?? {}) } as HomepageConfig,
    pi: { ...base.pi, ...(override.pi ?? {}) } as PiConfig,
    native: { ...(base.native ?? {}), ...(override.native ?? {}) } as NativeConfig,
  };

  if (override.models !== undefined) {
    result.models = mergeModelsConfig(base.models ?? {}, override.models as Partial<ModelsConfig>);
  } else {
    result.models = base.models;
  }

  for (const key of Object.keys(override)) {
    if (key === 'homepage' || key === 'pi' || key === 'native' || key === 'models') continue;
    (result as Record<string, unknown>)[key] = (override as Record<string, unknown>)[key];
  }
  return result;
}

/** 合并模型配置组 */
function mergeModelsConfig(
  base: ModelsConfig,
  override: Partial<ModelsConfig>
): ModelsConfig {
  const result: ModelsConfig = { ...base };
  for (const key of Object.keys(override)) {
    const o = override[key];
    if (o === undefined) {
      delete result[key];
      continue;
    }
    if (isPlainObject(o) && isPlainObject(result[key])) {
      result[key] = { ...result[key], ...o } as ModelConfig;
    } else {
      result[key] = o as ModelConfig;
    }
  }
  return result;
}

/** 合并两个普通对象，返回新对象 */
function mergeObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const o = override[key];
    if (isPlainObject(o) && isPlainObject(result[key])) {
      result[key] = mergeObjects(result[key] as Record<string, unknown>, o);
    } else if (o !== undefined) {
      result[key] = o;
    }
  }
  return result;
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
  const updated = loadConfig();
  applyLogo(updated);
  return updated;
}

/** 用局部更新合并当前用户覆盖项 */
export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const user = readJsonFile<UserAppConfig>(getUserConfigPath(), {});
  const newUser: UserAppConfig = {};

  const allTopKeys = new Set([...Object.keys(user), ...Object.keys(partial)]);
  for (const key of allTopKeys) {
    if (key === 'homepage') {
      const u = user.homepage ?? {};
      const p = (partial as Record<string, unknown>)[key];
      if (p !== undefined) {
        newUser.homepage = mergeObjects(u, p as Record<string, unknown>) as Partial<HomepageConfig>;
      } else {
        newUser.homepage = u as Partial<HomepageConfig>;
      }
    } else if (key === 'pi') {
      const u = user.pi ?? {};
      const p = (partial as Record<string, unknown>)[key];
      if (p !== undefined) {
        newUser.pi = mergeObjects(u, p as Record<string, unknown>) as Partial<PiConfig>;
      } else {
        newUser.pi = u as Partial<PiConfig>;
      }
    } else if (key === 'native') {
      const u = user.native ?? {};
      const p = (partial as Record<string, unknown>)[key];
      if (p !== undefined) {
        newUser.native = mergeObjects(u, p as Record<string, unknown>) as Partial<NativeConfig>;
      } else {
        newUser.native = u as Partial<NativeConfig>;
      }
    } else if (key === 'models') {
      const u = user.models ?? {};
      const p = (partial as Record<string, unknown>)[key];
      if (p !== undefined) {
        newUser.models = mergeObjects(u, p as Record<string, unknown>) as Partial<ModelsConfig>;
      } else {
        newUser.models = u as Partial<ModelsConfig>;
      }
    } else {
      const p = (partial as Record<string, unknown>)[key];
      const u = (user as Record<string, unknown>)[key];
      if (p !== undefined) {
        (newUser as Record<string, unknown>)[key] = p;
      } else if (u !== undefined) {
        (newUser as Record<string, unknown>)[key] = u;
      }
    }
  }

  writeJsonFile(getUserConfigPath(), newUser);
  const updated = loadConfig();
  applyLogo(updated);
  return updated;
}

/** 校验 homepage 配置：保留所有字段，只填充默认值 */
function validateHomepage(value: unknown): HomepageConfig {
  const defaults = {
    type: 'default' as HomepageType,
    url: '',
    file: '',
    title: 'Agent Studio',
  };
  if (!isPlainObject(value)) {
    return { ...defaults } as HomepageConfig;
  }
  const raw = value as Record<string, unknown>;
  const result = { ...defaults, ...raw } as HomepageConfig;

  // 校验并规范已知字段
  if (typeof raw.type === 'string') {
    if (!['default', 'url', 'file', 'native'].includes(raw.type)) {
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
  if (result.type === 'file' && typeof result.file === 'string' && result.file.includes('..')) {
    throw new Error('homepage.file relative path cannot contain ".."');
  }
  return result;
}

/** 校验单个模型配置 */
function validateModelConfig(value: unknown): ModelConfig {
  if (!isPlainObject(value)) {
    throw new Error('Model config must be an object');
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.provider !== 'string' || !raw.provider) {
    throw new Error('Model config must have a non-empty provider');
  }
  if (typeof raw.modelId !== 'string' || !raw.modelId) {
    throw new Error('Model config must have a non-empty modelId');
  }
  const result: ModelConfig = {
    provider: raw.provider,
    modelId: raw.modelId,
  };
  if (typeof raw.apiKeyEnv === 'string') result.apiKeyEnv = raw.apiKeyEnv;
  if (typeof raw.baseUrl === 'string') result.baseUrl = raw.baseUrl;
  if (typeof raw.enabled === 'boolean') result.enabled = raw.enabled;
  for (const key of Object.keys(raw)) {
    if (!['provider', 'modelId', 'apiKeyEnv', 'baseUrl', 'enabled'].includes(key)) {
      (result as Record<string, unknown>)[key] = raw[key];
    }
  }
  return result;
}

/** 校验模型配置组 */
function validateModelsConfig(value: unknown): ModelsConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error('models must be an object');
  }
  const raw = value as Record<string, unknown>;
  const result: ModelsConfig = {};
  for (const key of Object.keys(raw)) {
    result[key] = validateModelConfig(raw[key]);
  }
  return result;
}

/** 校验原生模式配置 */
function validateNative(value: unknown): NativeConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error('native must be an object');
  }
  const raw = value as Record<string, unknown>;
  const result: NativeConfig = {};
  if (typeof raw.defaultWorkspace === 'string') result.defaultWorkspace = raw.defaultWorkspace;
  if (typeof raw.sqliteDb === 'string') result.sqliteDb = raw.sqliteDb;
  for (const key of Object.keys(raw)) {
    if (!['defaultWorkspace', 'sqliteDb'].includes(key)) {
      (result as Record<string, unknown>)[key] = raw[key];
    }
  }
  return result;
}

/** 校验 Pi 配置：保留所有字段，只填充默认值 */
function validatePi(value: unknown): PiConfig {
  const defaults = {
    updateManifestUrl: '',
    args: ['--mode', 'rpc'],
  };
  if (!isPlainObject(value)) {
    return { ...defaults } as PiConfig;
  }
  const raw = value as Record<string, unknown>;
  const result = { ...defaults, ...raw } as PiConfig;

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

/** 校验完整配置：保留所有字段 */
function validateConfig(value: unknown): AppConfig {
  if (!isPlainObject(value)) {
    throw new Error('Config must be an object');
  }
  const raw = value as Record<string, unknown>;
  const result: AppConfig = {
    homepage: validateHomepage(raw.homepage),
    pi: validatePi(raw.pi),
    models: validateModelsConfig(raw.models),
    selectedModel: typeof raw.selectedModel === 'string' ? raw.selectedModel : undefined,
    native: validateNative(raw.native),
    theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : undefined,
    fontScale: typeof raw.fontScale === 'number' ? raw.fontScale : undefined,
  };

  for (const key of Object.keys(raw)) {
    if (!['homepage', 'pi', 'models', 'selectedModel', 'native', 'theme', 'fontScale'].includes(key)) {
      (result as Record<string, unknown>)[key] = raw[key];
    }
  }
  return result;
}

/** 校验局部配置：保留所有字段 */
function validatePartialConfig(value: unknown): Partial<AppConfig> {
  if (!isPlainObject(value)) {
    throw new Error('Config partial must be an object');
  }
  const raw = value as Record<string, unknown>;
  const result: Partial<AppConfig> = {};
  if (raw.homepage !== undefined) {
    result.homepage = validateHomepage(raw.homepage);
  }
  if (raw.pi !== undefined) {
    result.pi = validatePi(raw.pi);
  }
  if (raw.models !== undefined) {
    result.models = validateModelsConfig(raw.models);
  }
  if (raw.selectedModel !== undefined) {
    if (typeof raw.selectedModel !== 'string') {
      throw new Error('selectedModel must be a string');
    }
    result.selectedModel = raw.selectedModel;
  }
  if (raw.native !== undefined) {
    result.native = validateNative(raw.native);
  }
  if (raw.theme !== undefined) {
    if (raw.theme !== 'dark' && raw.theme !== 'light') {
      throw new Error('theme must be "dark" or "light"');
    }
    result.theme = raw.theme;
  }
  if (raw.fontScale !== undefined) {
    if (typeof raw.fontScale !== 'number') {
      throw new Error('fontScale must be a number');
    }
    result.fontScale = raw.fontScale;
  }

  for (const key of Object.keys(raw)) {
    if (!['homepage', 'pi', 'models', 'selectedModel', 'native', 'theme', 'fontScale'].includes(key)) {
      (result as Record<string, unknown>)[key] = raw[key];
    }
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
