import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../config';
import { createRuntimeDependencies, ensureAgentDir, getAgentDir } from './runtime-deps';
import { SessionSupervisor } from './session-supervisor';
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

/** 获取原生模式的 SQLite 数据库路径 */
function getSqliteDbPath(config?: { sqliteDb?: string }): string {
  if (config?.sqliteDb) return config.sqliteDb;
  return path.join(app.getPath('userData'), 'native.sqlite');
}

/** 统一封装与 Pi 的交互 */
export class PiSdkDriver {
  private runtime?: RuntimeDependencies;
  private sessionSupervisor?: SessionSupervisor;
  private eventHandler: (sessionId: string, event: any) => void;
  private health: DriverHealth = { ok: false, runtimeReady: false };

  constructor(eventHandler?: (sessionId: string, event: any) => void) {
    this.eventHandler = eventHandler ?? (() => { /* no-op */ });
  }

  /** 初始化运行时依赖 */
  async initialize(cwd: string): Promise<DriverHealth> {
    if (this.health.runtimeReady && this.sessionSupervisor) {
      return this.health;
    }
    try {
      ensureAgentDir();
      const config = loadConfig();
      const sqliteDbPath = config.native?.sqliteDb;
      this.runtime = await createRuntimeDependencies(cwd, sqliteDbPath, config.models, config.selectedModel);
      this.sessionSupervisor = new SessionSupervisor(this.runtime, this.eventHandler);

      const selectedModel = await this.resolveSelectedModel(config.selectedModel);

      this.health = {
        ok: true,
        runtimeReady: true,
        currentModel: selectedModel ? `${selectedModel.providerId} / ${selectedModel.modelId}` : undefined,
      };
      return this.health;
    } catch (err) {
      this.health = {
        ok: false,
        runtimeReady: false,
        error: err instanceof Error ? err.message : String(err),
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

    return { providerId, modelId };
  }

  /** 创建新会话 */
  async createSession(workspacePath: string, name?: string): Promise<SessionRef> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.createSession(workspacePath, name);
  }

  /** 打开已有会话 */
  async openSession(sessionFile: string): Promise<SessionRef> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.openSession(sessionFile);
  }

  /** 列出某工作区的会话 */
  async listSessions(workspacePath: string): Promise<SessionRef[]> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.listSessions(workspacePath);
  }

  /** 关闭某会话 */
  closeSession(sessionId: string): void {
    if (!this.sessionSupervisor) return;
    this.sessionSupervisor.closeSession(sessionId);
  }

  /** 发送用户消息 */
  async sendMessage(sessionId: string, input: UserMessageInput): Promise<void> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.sendMessage(sessionId, input);
  }

  /** 取消当前运行 */
  async cancelRun(sessionId: string): Promise<void> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.cancelRun(sessionId);
  }

  /** 导航会话树 */
  async navigateTree(sessionId: string, targetId: string, summarize = false): Promise<void> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.navigateTree(sessionId, targetId, summarize);
  }

  /** 获取会话树 */
  getSessionTree(sessionId: string): SessionNode[] {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.getSessionTree(sessionId);
  }

  /** 获取转录 */
  getTranscript(sessionId: string): SessionTranscriptItem[] {
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
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.listAvailableModels();
  }

  /** 切换当前会话模型并更新健康状态 */
  async setModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    await this.sessionSupervisor.setModel(sessionId, providerId, modelId);
    if (this.health) {
      this.health.currentModel = `${providerId} / ${modelId}`;
    }
  }

  /** 列出当前会话加载的 skills */
  listSkills(sessionId: string): SkillInfo[] {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    return this.sessionSupervisor.listSkills(sessionId);
  }

  /** 调用某个 skill */
  async invokeSkill(sessionId: string, skillName: string, args?: string): Promise<void> {
    if (!this.sessionSupervisor) throw new Error('Driver not initialized');
    await this.sessionSupervisor.invokeSkill(sessionId, skillName, args);
  }

  /** 关闭驱动 */
  async shutdown(): Promise<void> {
    if (!this.sessionSupervisor) return;
    // 后续可以在这里关闭所有会话
  }
}
