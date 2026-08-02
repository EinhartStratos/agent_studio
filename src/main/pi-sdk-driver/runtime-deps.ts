import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { SessionIndex } from './session-index';
import type { RuntimeDependencies } from './types';
import type { ModelsConfig } from '../../shared/config';
import { diagLog } from './debug-logger';

const TAG_SYNC = 'syncAgentModelConfig';

/** 获取 Pi Agent 配置目录，默认在用户数据目录下的 .pi/agent */
export function getAgentDir(): string {
  return path.join(app.getPath('userData'), '.pi', 'agent');
}

/** 确保 Agent 目录存在 */
export function ensureAgentDir(): void {
  fs.mkdirSync(getAgentDir(), { recursive: true });
}

/** 创建并初始化 Pi 运行时依赖 */
export async function createRuntimeDependencies(
  cwd: string,
  sqliteDbPath?: string,
  modelsConfig?: ModelsConfig,
  selectedModel?: string
): Promise<RuntimeDependencies> {
  ensureAgentDir();
  const agentDir = getAgentDir();

  const authPath = path.join(agentDir, 'auth.json');
  const modelsPath = path.join(agentDir, 'models.json');
  const modelsStorePath = path.join(agentDir, 'models-store.json');

  // 如果应用配置中提供了模型，写入 agent 配置
  syncAgentModelConfig(agentDir, modelsConfig, selectedModel);

  // 确保文件存在，避免运行时找不到
  for (const filePath of [authPath, modelsPath, modelsStorePath]) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '{}');
    }
  }

  const settingsManager = SettingsManager.create(cwd, agentDir);
  const modelRuntime = await ModelRuntime.create({
    authPath,
    modelsPath,
    modelsStorePath,
  });

  const dbPath = sqliteDbPath ?? path.join(app.getPath('userData'), 'native.sqlite');
  const sessionIndex = new SessionIndex(dbPath);

  return {
    modelRuntime,
    settingsManager,
    sessionIndex,
    agentDir,
  };
}

/** 解析 API Key：优先使用 apiKey，否则按 apiKeyEnv 解析 */
function resolveApiKey(model: ModelsConfig[string]): string | undefined {
  const raw = model.apiKey ?? (model.apiKeyEnv ? resolveApiKeyValue(model.apiKeyEnv) : undefined);
  if (raw === undefined) return undefined;
  return sanitizeString(raw);
}

function resolveApiKeyValue(v: string): string | undefined {
  if (v.startsWith('$')) {
    const envName = v.slice(1).replace(/^\{|\}$/g, '');
    return process.env[envName];
  }
  return v;
}

/** 去掉首尾空格 / 反引号 / 单双引号 / 尖括号等，避免手动编辑配置时引入 Markdown 风格 `` ` `` / `<>` / 中文 `` ＂ `` / 复制粘贴残留 */
function sanitizeString(s: string | undefined | null): string | undefined {
  if (s === undefined || s === null) return undefined;
  let result: string = String(s);
  result = result
    .replaceAll('`', '')
    .replaceAll('＂', '"')
    .replaceAll('´', "'")
    .replaceAll('‘', "'")
    .replaceAll('’', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replaceAll('＜', '<')
    .replaceAll('＞', '>')
    .replaceAll('（', '(')
    .replaceAll('）', ')')
    .replace(/^[\s"'<>()\[\]{}|~]+/, '')
    .replace(/[\s"'<>()\[\]{}|~]+$/, '');
  return result.trim();
}

/** 规范化 baseUrl：补 trailing slash、DeepSeek 类兼容自动补 /v1 */
function normalizeBaseUrl(urlRaw: string | undefined): string | undefined {
  const u = sanitizeString(urlRaw);
  if (!u) return undefined;
  let url = u;
  const lc = url.toLowerCase();
  if (/deepseek/.test(lc) && !/\/v\d+(\/|$)/.test(lc)) {
    if (url.endsWith('/')) url = url.slice(0, -1);
    url = `${url}/v1`;
  }
  if (!url.endsWith('/')) url = `${url}/`;
  return url;
}

/** 推断 pi SDK 内部使用的 api 值：baseUrl 兼容 OpenAI Chat 的一律走 openai-chat（DeepSeek/Groq 等） */
/**
 * 根据 baseUrl 推断 pi 内部识别的 API spec。
 * 关键！pi v0.80.10 内部注册的 API 标识符是 "openai-completions"（不是 "openai-chat"！）
 * 证据：get_state 返回的内置 deepseek-v4-pro api=openai-completions；如果写 openai-chat 会报
 * "No API provider registered for api: openai-chat"。
 */
function inferApiSpec(baseUrl: string | undefined): { api: string; authHeader: boolean } {
  if (!baseUrl) return { api: 'openai-completions', authHeader: true };
  const lc = baseUrl.toLowerCase();
  if (/deepseek|groq|openrouter|together|siliconflow|dashscope|qwen|volces|ark|anthropic|models\.api|api-inference|sambanova/.test(lc)) {
    return { api: 'openai-completions', authHeader: true };
  }
  return { api: 'openai-completions', authHeader: true };
}

/** 把 app-config 中的模型配置同步到 agent 目录 */
export function syncAgentModelConfig(
  agentDir: string,
  modelsConfig?: ModelsConfig,
  selectedModel?: string
): void {
  if (!modelsConfig || Object.keys(modelsConfig).length === 0) return;

  const auth: Record<string, { type: 'api_key'; key: string }> = {};
  const providers: Record<string, any> = {};

  for (const [aliasRaw, model] of Object.entries(modelsConfig)) {
    if (model.enabled === false) continue;

    const alias = sanitizeString(aliasRaw) ?? aliasRaw;
    const providerId = sanitizeString(model.provider) ?? model.provider;
    const modelId = sanitizeString(model.modelId) ?? model.modelId;
    const baseUrlRaw = normalizeBaseUrl(model.baseUrl);
    // 最后一道防线：字符级剥去任何非打印/反引号/全角反引号
    const baseUrl = baseUrlRaw
      ? baseUrlRaw
          .replaceAll('\u0060', '')
          .replaceAll('\uFF40', '')
          .replaceAll('\u02CB', '')
          .replaceAll('\u00B4', '')
          .replaceAll('\u2018', '')
          .replaceAll('\u2019', '')
          .replaceAll('\u201C', '')
          .replaceAll('\u201D', '')
          .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
          .trim()
      : undefined;
    const apiKey = resolveApiKey(model);

    if (!providerId || !modelId) continue;

    if (apiKey) {
      auth[providerId] = { type: 'api_key', key: apiKey };
    }

    if (!providers[providerId]) {
      const spec = inferApiSpec(baseUrl);
      providers[providerId] = { models: [] };
      if (baseUrl) {
        providers[providerId].baseUrl = baseUrl;
      }
      providers[providerId].api = spec.api;
      providers[providerId].authHeader = spec.authHeader;
    }

    providers[providerId].models.push({ id: modelId, name: alias });
  }

  fs.mkdirSync(agentDir, { recursive: true });

  let authJson = JSON.stringify(auth, null, 2);
  let modelsJson = JSON.stringify({ providers }, null, 2);
  // 终极保险：JSON 字符串化后全局 replace 反引号/全角引号/非打印
  const stripAllDirty = (s: string) => s
    .replaceAll('\u0060', '')
    .replaceAll('\uFF40', '')
    .replaceAll('\u02CB', '')
    .replaceAll('\u00B4', '')
    .replaceAll('\u2018', '')
    .replaceAll('\u2019', '')
    .replaceAll('\u201C', '')
    .replaceAll('\u201D', '')
    .replaceAll('\uFF02', '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u00AD]/g, '');
  authJson = stripAllDirty(authJson);
  modelsJson = stripAllDirty(modelsJson);

  // 诊断：打印每个 provider.baseUrl 的 charCode 序列（前 60 字符）
  try {
    for (const [pid, pcfg] of Object.entries(providers)) {
      const url = String((pcfg as any)?.baseUrl ?? '');
      const codes: string[] = [];
      for (let i = 0; i < Math.min(url.length, 60); i++) codes.push(String(url.charCodeAt(i)));
      diagLog(TAG_SYNC, `provider=${pid} baseUrl.len=${url.length} baseUrl=${JSON.stringify(url)} charCodes(0..min(n,60))=${codes.join(',')}`);
    }
  } catch {}
  diagLog(TAG_SYNC, `auth.json (WRITE): ${authJson.slice(0, 500)}`);
  diagLog(TAG_SYNC, `models.json (WRITE): ${modelsJson.slice(0, 1000)}`);
  fs.writeFileSync(path.join(agentDir, 'auth.json'), authJson);
  fs.writeFileSync(path.join(agentDir, 'models.json'), modelsJson);

  const cleanSel = sanitizeString(selectedModel);
  if (cleanSel) {
    fs.writeFileSync(path.join(agentDir, 'selected-model.txt'), cleanSel);
  }
}
