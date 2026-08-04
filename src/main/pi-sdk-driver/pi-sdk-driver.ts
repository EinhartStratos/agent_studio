import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../config';
import type { AgentDriverMode } from '../../shared/config';
import {
  createRuntimeDependencies,
  ensureAgentDir,
  getAgentDir,
  syncAgentModelConfig,
} from './runtime-deps';
import { SessionSupervisor } from './session-supervisor';
import { AcpDriverBridge } from './acp-driver-bridge';
import type {
  DriverHealth,
  FileTreeNode,
  RuntimeDependencies,
  SessionNode,
  SessionRef,
  SessionTranscriptItem,
  SkillInfo,
  UserMessageInput,
  WorkspaceSummary,
} from './types';
import { diagLog, setUserDataResolver, getDebugLogPath } from './debug-logger';

const TAG = 'PiSdkDriver';

/** 打包后内置的 pi 二进制目录 */
function getPackagedAgentDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

/** 热更下载后的 pi 二进制目录 */
function getUserAgentDir(): string {
  return path.join(app.getPath('userData'), 'agent-bin');
}

/** 返回所有候选的 pi 可执行文件名（Windows 同时支持 pi-win.exe / pi.exe） */
function getAgentBinCandidates(): string[] {
  if (process.platform === 'win32') return ['pi-win.exe', 'pi.exe'];
  return [`pi-${process.platform}-${process.arch}`];
}

/** 解析打包/热更的 pi 二进制路径：优先 userData/agent-bin，其次 resources/bin */
function getBuiltInAgentBinaryPath(): string {
  const userDir = getUserAgentDir();
  const packagedDir = getPackagedAgentDir();
  for (const name of getAgentBinCandidates()) {
    const userBin = path.join(userDir, name);
    if (fs.existsSync(userBin)) return userBin;
  }
  for (const name of getAgentBinCandidates()) {
    const packagedBin = path.join(packagedDir, name);
    if (fs.existsSync(packagedBin)) return packagedBin;
  }
  // 都未找到时回退到第一个候选（便于后续报错提示）
  return path.join(packagedDir, getAgentBinCandidates()[0]);
}

/** 解析 pi 可执行文件路径：
 * 1. 优先使用显式环境变量 PI_ACP_PI_COMMAND
 * 2. 其次使用打包/热更的 pi 二进制（支持热更）
 * 3. 再回退到 node_modules/.bin/pi（开发环境）
 * 4. 最后回退到 PATH 中的 pi
 */
export function resolvePiBinaryPath(): string {
  if (process.env.PI_ACP_PI_COMMAND && fs.existsSync(process.env.PI_ACP_PI_COMMAND)) {
    return process.env.PI_ACP_PI_COMMAND;
  }

  const builtInBinary = getBuiltInAgentBinaryPath();
  if (fs.existsSync(builtInBinary)) {
    return builtInBinary;
  }

  const candidateViaNodeModules = path.resolve(app.getAppPath(), 'node_modules', '.bin', process.platform === 'win32' ? 'pi.cmd' : 'pi');
  if (fs.existsSync(candidateViaNodeModules)) return candidateViaNodeModules;
  // dev 模式下 app.getAppPath() 是项目根目录；打包后可能是 resources/app
  const candidateViaCwd = path.resolve(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'pi.cmd' : 'pi');
  if (fs.existsSync(candidateViaCwd)) return candidateViaCwd;
  return process.platform === 'win32' ? 'pi.cmd' : 'pi';
}

/** 检查 pi 二进制是否存在；尝试一次 --version 调用作为烟雾测试 */
async function probePiBinary(piBin: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(piBin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (res.status === 0) {
      return { ok: true, version: (res.stdout ?? '').trim().split('\n')[0] || undefined };
    }
    return { ok: false, error: `exit=${res.status} stderr=${(res.stderr ?? '').trim()}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** 获取原生模式的 SQLite 数据库路径 */
function getSqliteDbPath(config?: { sqliteDb?: string }): string {
  if (config?.sqliteDb) return config.sqliteDb;
  return path.join(app.getPath('userData'), 'native.sqlite');
}

/** 统一封装与 Pi 的交互 */
export class PiSdkDriver {
  private static _lastCreatedDriver: PiSdkDriver | null = null;
  static getLastCreatedDriver(): PiSdkDriver | null { return PiSdkDriver._lastCreatedDriver; }

  private runtime?: RuntimeDependencies;
  private sessionSupervisor?: SessionSupervisor;
  private eventHandler: (sessionId: string, event: any) => void;
  private health: DriverHealth = { ok: false, runtimeReady: false };
  private driverMode: AgentDriverMode;
  private acpBridge?: AcpDriverBridge;

  constructor(eventHandler?: (sessionId: string, event: any) => void) {
    this.eventHandler = eventHandler ?? (() => { /* no-op */ });
    this.driverMode = (loadConfig().agent?.driverMode) ?? 'sdk';
    PiSdkDriver._lastCreatedDriver = this;
  }

  /** 初始化运行时依赖 */
  async initialize(cwd: string): Promise<DriverHealth> {
    // 最早可能的时机注册 userData resolver → 之后所有 diagLog 都写 userData/logs
    setUserDataResolver(() => app.getPath('userData'));

    const config = loadConfig();
    const sqliteDbPath = config.native?.sqliteDb;

    ensureAgentDir();
    const agentDir = getAgentDir();
    syncAgentModelConfig(agentDir, config.models, config.selectedModel);

    process.env.PI_CODING_AGENT_DIR = agentDir;

    const piBin = resolvePiBinaryPath();
    const builtInBinary = getBuiltInAgentBinaryPath();
    if (fs.existsSync(builtInBinary) && path.resolve(piBin) === path.resolve(builtInBinary)) {
      // 让 pi 二进制在同一目录找 theme/assets/export-html 等资源
      process.env.PI_PACKAGE_DIR = path.dirname(builtInBinary);
    }
    if (!process.env.PI_ACP_PI_COMMAND) {
      process.env.PI_ACP_PI_COMMAND = piBin;
    }

    const piProbe = await probePiBinary(piBin);
    diagLog(TAG, `driverMode=${this.driverMode} cwd=${cwd} agentDir=${agentDir} piBin=${piBin} piProbe.ok=${piProbe.ok} piProbe.version=${piProbe.version ?? '-'} piProbe.error=${piProbe.error ?? '-'} debugLogPath=${getDebugLogPath() ?? '(unset)'}`);

    if (this.driverMode === 'acp') {
      if (this.health.runtimeReady && this.acpBridge) {
        diagLog(TAG, `ACP already initialized, reusing existing bridge. health=${JSON.stringify(this.health)}`);
        return this.health;
      }
      try {
        diagLog(TAG, `ACP initializing bridge...`);
        this.acpBridge = new AcpDriverBridge(this.eventHandler);
        // 先注入 forced model（基于 loadConfig 的当前 selectedModel），createSession 后会立刻 setModel
        this.acpBridge.setForcedModelFromConfig(config.models as any, config.selectedModel);
        await this.acpBridge.initialize(cwd);
        diagLog(TAG, `ACP bridge initialized OK.`);

        let currentModel: string | undefined;
        if (config.selectedModel && config.models?.[config.selectedModel]) {
          const sel = config.models[config.selectedModel];
          currentModel = `${sel.provider} / ${sel.modelId}`;
        }

        this.health = {
          ok: true,
          runtimeReady: true,
          currentModel,
        };
        return this.health;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[${TAG}] ACP init FAILED: ${errMsg}`, err);
        diagLog(TAG, `ACP init FAILED: ${errMsg}`);
        this.health = {
          ok: false,
          runtimeReady: false,
          error: errMsg,
        };
        return this.health;
      }
    }

    if (this.health.runtimeReady && this.sessionSupervisor) {
      diagLog(TAG, `SDK already initialized, reusing. health=${JSON.stringify(this.health)}`);
      return this.health;
    }
    try {
      diagLog(TAG, `SDK initializing runtime deps...`);
      this.runtime = await createRuntimeDependencies(cwd, sqliteDbPath, config.models, config.selectedModel);
      this.sessionSupervisor = new SessionSupervisor(this.runtime, this.eventHandler);

      const selectedModel = await this.resolveSelectedModel(config.selectedModel);
      diagLog(TAG, `SDK runtime ready. resolvedSelectedModel=${selectedModel ? JSON.stringify(selectedModel) : '-'}`);

      this.health = {
        ok: true,
        runtimeReady: true,
        currentModel: selectedModel ? `${selectedModel.providerId} / ${selectedModel.modelId}` : undefined,
      };
      return this.health;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${TAG}] SDK init FAILED: ${errMsg}`, err);
      diagLog(TAG, `SDK init FAILED: ${errMsg}`);
      this.health = {
        ok: false,
        runtimeReady: false,
        error: errMsg,
      };
      return this.health;
    }
  }

  /** 获取健康状态 */
  getHealth(): DriverHealth {
    return this.health;
  }

  /** 获取运行时 */
  getRuntime(): ModelRuntime | undefined {
    return this.runtime?.modelRuntime;
  }

  /** 解析并设置当前选中的模型 */
  private async resolveSelectedModel(selectedAlias?: string): Promise<{ providerId: string; modelId: string } | undefined> {
    if (!this.runtime) return undefined;

    const { modelRuntime, settingsManager } = this.runtime;

    // 先刷新模型可用性
    await modelRuntime.refresh();
    const available = await modelRuntime.getAvailable();

    if (available.length === 0) {
      return undefined;
    }

    // 根据 selectedAlias 匹配可用模型，否则取第一个
    let selected = available[0];
    const config = loadConfig();
    const modelsConfig = config.models ?? {};
    if (selectedAlias && modelsConfig[selectedAlias]) {
      const target = modelsConfig[selectedAlias];
      const matched = available.find((m) => {
        const modelId = (m as { id?: string }).id ?? (m as { modelId?: string }).modelId ?? '';
        const provider = (m as { provider?: string }).provider ?? '';
        return modelId === target.modelId && provider === target.provider;
      });
      if (matched) selected = matched;
    }

    const modelId = (selected as { id?: string }).id ?? (selected as { modelId?: string }).modelId ?? 'unknown';
    const providers = modelRuntime.getProviders();
    const providerId =
      (selected as { provider?: string }).provider ??
      providers.find((p) => {
        const models = modelRuntime.getModels(p.id);
        return models.some((m) => (m as { id?: string }).id === modelId);
      })?.id ??
      'unknown';

    // 写入 settings 作为默认值（如果方法存在）
    if (typeof (settingsManager as any).setDefaultModelAndProvider === 'function') {
      (settingsManager as any).setDefaultModelAndProvider(providerId, modelId);
    }

    // 保存当前模型对象，供会话命名等场景直接使用
    this.runtime.currentModel = selected;

    return { providerId, modelId };
  }

  /** 创建新会话 */
  async createSession(workspacePath: string, name?: string, agentTemplateId?: string): Promise<SessionRef> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.createSession(workspacePath, name, agentTemplateId);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.createSession(workspacePath, name);
  }

  /** 打开已有会话（支持传 sessionFile 路径 或 直接 sessionId） */
  async openSession(sessionFile: string): Promise<SessionRef> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.openSession(sessionFile);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.openSession(sessionFile);
  }

  /** 列出某工作区的会话 */
  async listSessions(workspacePath: string): Promise<SessionRef[]> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.listSessions(workspacePath);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.listSessions(workspacePath);
  }

  /** 关闭某会话 */
  closeSession(sessionId: string): void {
    if (this.driverMode === 'acp') {
      this.acpBridge?.closeSession(sessionId);
      return;
    }
    if (!this.sessionSupervisor) return;
    this.sessionSupervisor.closeSession(sessionId);
  }

  /** 发送用户消息 */
  async sendMessage(sessionId: string, input: UserMessageInput): Promise<void> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.prompt(sessionId, input);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.sendMessage(sessionId, input);
  }

  /** 取消当前运行 */
  async cancelRun(sessionId: string): Promise<void> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.cancel(sessionId);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.cancelRun(sessionId);
  }

  /** 导航会话树 */
  async navigateTree(sessionId: string, targetId: string, summarize = false): Promise<void> {
    if (this.driverMode === 'acp') {
      throw new Error('navigateTree not implemented in ACP mode yet.');
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.navigateTree(sessionId, targetId, summarize);
  }

  /** 获取会话树 */
  getSessionTree(sessionId: string): SessionNode[] {
    if (this.driverMode === 'acp') {
      const transcript = this.getTranscript(sessionId);
      return transcript.map((item) => ({
        id: item.id,
        parentId: item.parentId ?? null,
        type: item.type,
        label:
          item.type === 'assistant'
            ? (item.content ?? '').slice(0, 40)
            : item.type === 'user'
              ? (item.content ?? '').slice(0, 40)
              : item.tool?.name ?? item.type,
        children: [],
      }));
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.getSessionTree(sessionId);
  }

  /** 获取转录 */
  getTranscript(sessionId: string): SessionTranscriptItem[] {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.getTranscript(sessionId);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.getTranscript(sessionId);
  }

  /** 获取某目录的工作区摘要 */
  async getWorkspaceSummary(workspacePath: string): Promise<WorkspaceSummary> {
    const sessions = await this.listSessions(workspacePath);
    return {
      path: workspacePath,
      name: path.basename(workspacePath) || 'untitled',
      sessions,
    };
  }

  /** 获取目录树 */
  getWorkspaceTree(dirPath: string): FileTreeNode[] {
    if (!fs.existsSync(dirPath)) return [];
    const nodes: FileTreeNode[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      const node: FileTreeNode = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
      };
      if (entry.isDirectory()) {
        try {
          node.children = this.getWorkspaceTree(fullPath);
        } catch {
          node.children = [];
        }
      }
      nodes.push(node);
    }
    return nodes;
  }

  /** 预览文本文件 */
  async getFilePreview(filePath: string, maxBytes = 256 * 1024): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    // 简单判断是否为二进制：读取前 1KB，检查空字节比例
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(1024, stats.size));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);

    const nullCount = buffer.reduce((acc, b) => acc + (b === 0 ? 1 : 0), 0);
    if (nullCount > 0) {
      return `[Binary file: ${filePath}]`;
    }

    const text = fs.readFileSync(filePath, 'utf-8');
    if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
      return text.slice(0, maxBytes) + '\n... (truncated)';
    }
    return text;
  }

  /** 获取 diff（文本形式） */
  async getDiff(filePath: string, oldContent?: string, newContent?: string): Promise<string> {
    if (oldContent !== undefined && newContent !== undefined) {
      // 使用 pi 内置的 diff 工具
      const { generateDiffString } = await import('@earendil-works/pi-coding-agent');
      const result = generateDiffString(oldContent, newContent, 3);
      return result.diff;
    }

    // 如果未提供内容，返回空或提示
    if (!fs.existsSync(filePath)) {
      return `File not found: ${filePath}`;
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** 获取 SQLite 数据库路径 */
  getSqliteDbPath(config?: { sqliteDb?: string }): string {
    return getSqliteDbPath(config);
  }

  /** 列出可用模型 */
  async listModels(): Promise<{ providerId: string; modelId: string; label?: string }[]> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      const config = loadConfig();
      return this.acpBridge.listModelsFromConfig(config.models as unknown as Record<string, any>);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.listAvailableModels();
  }

  /** 切换当前会话模型并更新健康状态 */
  async setModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      const agentDir = getAgentDir();
      const current = loadConfig();
      syncAgentModelConfig(agentDir, current.models, current.selectedModel);
      await this.acpBridge.setSessionModel(sessionId, providerId, modelId);
      if (this.health) {
        this.health.currentModel = `${providerId} / ${modelId}`;
      }
      return;
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    await this.sessionSupervisor.setModel(sessionId, providerId, modelId);
    if (this.health) {
      this.health.currentModel = `${providerId} / ${modelId}`;
    }
  }

  /** 列出当前会话加载的 skills */
  listSkills(sessionId: string): SkillInfo[] {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) return [];
      return this.acpBridge.listSkills(sessionId) ?? [];
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.listSkills(sessionId);
  }

  /** 调用某个 skill */
  async invokeSkill(sessionId: string, skillName: string, args?: string): Promise<void> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      await this.acpBridge.invokeSkill(sessionId, skillName, args);
      return;
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    await this.sessionSupervisor.invokeSkill(sessionId, skillName, args);
  }

  /** 删除会话（ACP 或 SDK 模式） */
  async deleteSession(sessionId: string): Promise<void> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.deleteSession(sessionId);
    }
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.deleteSession(sessionId);
  }

  /** 切换 Thinking Level（ACP：setSessionMode；SDK 模式下暂未实现，抛 not implemented） */
  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.setSessionMode(sessionId, modeId);
    }
    throw new Error('setSessionMode not implemented in SDK mode yet.');
  }

  /** 设置 Session Config Option（ACP：setSessionConfigOption；SDK 模式下暂未实现） */
  async setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    if (this.driverMode === 'acp') {
      if (!this.acpBridge) throw new Error('ACP Bridge not initialized');
      return this.acpBridge.setSessionConfigOption(sessionId, configId, value);
    }
    throw new Error('setSessionConfigOption not implemented in SDK mode yet.');
  }

  /** 关闭驱动 */
  async shutdown(): Promise<void> {
    if (this.driverMode === 'acp') {
      this.acpBridge?.dispose();
      this.acpBridge = undefined;
      this.health = { ok: false, runtimeReady: false };
      return;
    }
    if (!this.sessionSupervisor) return;
  }
}
