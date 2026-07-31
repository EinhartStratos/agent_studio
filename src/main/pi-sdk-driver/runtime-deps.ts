import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { SessionIndex } from './session-index';
import type { RuntimeDependencies } from './types';
import type { ModelsConfig } from '../../shared/config';

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
  if (model.apiKey) return model.apiKey;
  if (!model.apiKeyEnv) return undefined;
  const v = model.apiKeyEnv;
  if (v.startsWith('$')) {
    const envName = v.slice(1).replace(/^\{|\}$/g, '');
    return process.env[envName];
  }
  // 兼容旧配置：直接把 key 写在 apiKeyEnv 里的情况
  return v;
}

/** 把 app-config 中的模型配置同步到 agent 目录 */
function syncAgentModelConfig(
  agentDir: string,
  modelsConfig?: ModelsConfig,
  selectedModel?: string
): void {
  if (!modelsConfig || Object.keys(modelsConfig).length === 0) return;

  const auth: Record<string, { type: 'api_key'; key: string }> = {};
  const providers: Record<string, any> = {};

  for (const [alias, model] of Object.entries(modelsConfig)) {
    if (model.enabled === false) continue;

    const providerId = model.provider;
    const apiKey = resolveApiKey(model);

    if (apiKey) {
      auth[providerId] = { type: 'api_key', key: apiKey };
    }

    if (!providers[providerId]) {
      providers[providerId] = { models: [] };
      if (model.baseUrl) {
        providers[providerId].baseUrl = model.baseUrl;
        providers[providerId].api = 'openai-completions';
        providers[providerId].authHeader = true;
      }
    }

    providers[providerId].models.push({
      id: model.modelId,
      name: alias,
    });
  }

  fs.writeFileSync(path.join(agentDir, 'auth.json'), JSON.stringify(auth, null, 2));
  fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({ providers }, null, 2));

  // 若声明了 selectedModel，也写入方便读取
  if (selectedModel) {
    fs.writeFileSync(path.join(agentDir, 'selected-model.txt'), selectedModel);
  }
}
