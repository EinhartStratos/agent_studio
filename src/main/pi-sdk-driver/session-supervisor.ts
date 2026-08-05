import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  createAgentSession,
  DefaultResourceLoader,
  parseSkillBlock,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import type { AgentSession, ResourceLoader, Skill } from '@earendil-works/pi-coding-agent';
import type { ActiveSession, RuntimeDependencies, SessionRef, SessionTranscriptItem, SessionNode, SkillInfo, ToolCallInfo, UserMessageInput } from './types';
import { createOfficeTools } from './office-tools';
import { getMarketplaceAgentSkillPrompt } from '../marketplace-ipc';
import { findPiSession, listPiSessions } from 'pi-acp';

/** 获取用户数据目录下的会话副本目录 */
function getUserSessionsDir(): string {
  return path.join(app.getPath('userData'), 'sessions');
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 比较两条路径是否指向同一位置（忽略尾部路径分隔符与正斜杠反斜杠差异） */
function pathsEqual(a: string, b: string): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const A = String(a).trim().replace(/\\/g, '/').replace(/\/$/, '');
  const B = String(b).trim().replace(/\\/g, '/').replace(/\/$/, '');
  return A === B;
}

/** 从工作区路径生成工作区名称 */
function workspaceNameFromPath(workspacePath: string): string {
  return path.basename(workspacePath) || 'untitled';
}

/** 生成会话显示名称 */
function makeSessionName(workspacePath: string, index: number): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${workspaceNameFromPath(workspacePath)} ${date} #${index + 1}`;
}

function hasMeaningfulUserEntry(sessionFile: string, workspacePath: string): boolean {
  try {
    if (!fs.existsSync(sessionFile)) return false;
    const sm = SessionManager.open(sessionFile, undefined, workspacePath);
    const entries = sm.getEntries() as any[];
    return entries.some((entry) => {
      if (entry?.type !== 'message') return false;
      const role = entry?.message?.role ?? entry?.role;
      if (role !== 'user') return false;
      const content = entry?.message?.content ?? entry?.content;
      if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim().length > 0;
      if (Array.isArray(content)) {
        return content.some((part) => {
          if (typeof part === 'string') return part.replace(/\s+/g, ' ').trim().length > 0;
          const text = typeof part?.text === 'string' ? part.text : '';
          return text.replace(/\s+/g, ' ').trim().length > 0;
        });
      }
      return false;
    });
  } catch {
    return false;
  }
}

/** 管理活动会话 */
export class SessionSupervisor {
  private runtime: RuntimeDependencies;
  private activeSessions = new Map<string, ActiveSession>();
  private workspaceSessionCounter = new Map<string, number>();
  private onEvent?: (sessionId: string, event: any) => void;

  constructor(runtime: RuntimeDependencies, onEvent?: (sessionId: string, event: any) => void) {
    this.runtime = runtime;
    this.onEvent = onEvent;
  }

  /** 获取或递增某个工作区的会话计数 */
  private nextSessionIndex(workspacePath: string): number {
    const current = this.workspaceSessionCounter.get(workspacePath) ?? 0;
    const next = current + 1;
    this.workspaceSessionCounter.set(workspacePath, next);
    return current;
  }

  /** 获取某会话的 userData 副本路径 */
  private getUserCopyPath(workspacePath: string, sessionId: string): string {
    const dir = path.join(getUserSessionsDir(), workspaceNameFromPath(workspacePath));
    ensureDir(dir);
    return path.join(dir, `${sessionId}.jsonl`);
  }

  /** 获取工作区目录下的会话保存路径 */
  private getWorkspaceSessionPath(workspacePath: string, sessionId: string): string {
    const dir = path.join(workspacePath, '.pi', 'sessions');
    ensureDir(dir);
    return path.join(dir, `${sessionId}.jsonl`);
  }

  /** 从会话文件路径反推工作区根目录（会话文件位于 <workspace>/.pi/sessions/<id>.jsonl） */
  private resolveWorkspaceFromSessionFile(sessionFile: string): string {
    const sessionsDir = path.dirname(sessionFile);
    const piDir = path.dirname(sessionsDir);
    return path.dirname(piDir);
  }

  /** 在工作区下查找唯一的会话副本路径 */
  private resolveSessionFilePath(workspacePath: string, sessionId: string): string {
    // 优先使用工作区目录，同步时再写入 userData
    return this.getWorkspaceSessionPath(workspacePath, sessionId);
  }

  /** 从任意路径或 id 中提取 UUID 形式的会话 id */
  private extractSessionId(input: string): string | null {
    const base = path.extname(input) === '.jsonl' ? path.basename(input, '.jsonl') : path.basename(input);
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(base)) {
      return base;
    }
    return null;
  }

  /** 根据 sessionId 双向查找会话文件：先 SQLite / userData / 工作区 .pi/sessions，再 pi agentDir */
  private resolveSessionById(sessionId: string, preferredWorkspace?: string): { sessionFile: string; cwd: string } | null {
    // 1. SQLite 会话索引
    try {
      const idx = this.runtime.sessionIndex.getSessionById(sessionId);
      if (idx?.workspaceFilePath && fs.existsSync(idx.workspaceFilePath)) {
        return { sessionFile: idx.workspaceFilePath, cwd: idx.workspacePath };
      }
      if (idx?.userCopyPath && fs.existsSync(idx.userCopyPath)) {
        return { sessionFile: idx.userCopyPath, cwd: idx.workspacePath };
      }
      if (idx?.workspacePath) {
        const wsFile = this.getWorkspaceSessionPath(idx.workspacePath, sessionId);
        if (fs.existsSync(wsFile)) return { sessionFile: wsFile, cwd: idx.workspacePath };
      }
    } catch { /* ignore */ }

    // 2. 指定的工作区目录
    if (preferredWorkspace) {
      const wsFile = this.getWorkspaceSessionPath(preferredWorkspace, sessionId);
      if (fs.existsSync(wsFile)) return { sessionFile: wsFile, cwd: preferredWorkspace };
    }

    // 3. pi agentDir / pi-acp sessions（兼容 ACP 模式创建的会话）
    try {
      const piFind = findPiSession(sessionId);
      if (piFind?.sessionFile && fs.existsSync(piFind.sessionFile)) {
        return { sessionFile: piFind.sessionFile, cwd: piFind.cwd };
      }
    } catch { /* ignore */ }

    return null;
  }

  /** 创建新会话 */
  async createSession(workspacePath: string, name?: string): Promise<SessionRef> {
    console.log('[session-supervisor] create workspace:', workspacePath);
    ensureDir(workspacePath);
    const sessionId = randomUUID();
    const sessionFile = this.resolveSessionFilePath(workspacePath, sessionId);
    const userCopyPath = this.getUserCopyPath(workspacePath, sessionId);

    const sessionManager = SessionManager.create(workspacePath, path.dirname(sessionFile), {
      id: path.basename(sessionFile, '.jsonl'),
    });

    const resourceLoader = new DefaultResourceLoader({
      cwd: workspacePath,
      agentDir: this.runtime.agentDir,
      settingsManager: this.runtime.settingsManager,
    });
    console.log('[session-supervisor] project trusted before reload:', this.runtime.settingsManager.isProjectTrusted());
    await resourceLoader.reload({ resolveProjectTrust: async () => true });
    console.log('[session-supervisor] project trusted after reload:', this.runtime.settingsManager.isProjectTrusted());
    const skillResult = resourceLoader.getSkills();
    console.log('[session-supervisor] loaded skills:', skillResult.skills.length, 'diagnostics:', skillResult.diagnostics.length);
    for (const s of skillResult.skills) {
      console.log('[session-supervisor] skill:', s.name, s.sourceInfo?.scope ?? s.sourceInfo?.source ?? 'unknown', s.filePath);
    }
    for (const d of skillResult.diagnostics) {
      console.warn('[session-supervisor] skill diagnostic:', d.type, d.message, d.path);
    }

    const { session } = await createAgentSession({
      cwd: workspacePath,
      agentDir: this.runtime.agentDir,
      modelRuntime: this.runtime.modelRuntime,
      settingsManager: this.runtime.settingsManager,
      sessionManager,
      resourceLoader,
      customTools: createOfficeTools(workspacePath),
    });

    const ref: SessionRef = {
      sessionId,
      sessionFile,
      cwd: workspacePath,
      name: name ?? makeSessionName(workspacePath, this.nextSessionIndex(workspacePath)),
    };

    this.bindSession(ref, sessionManager, session, resourceLoader);

    // 新会话首次完成一轮对话后自动命名
    const active = this.activeSessions.get(ref.sessionId);
    if (active) active.needsName = true;

    // 写入初始会话信息
    sessionManager.appendSessionInfo(ref.name!);

    // 同步到 userData 并写入索引
    this.syncSessionCopy(ref, userCopyPath);
    this.upsertIndex(ref, userCopyPath);

    return ref;
  }

  /** 打开已有会话（支持直接传 sessionFile 或仅传 sessionId） */
  async openSession(sessionFile: string, cwdOverride?: string): Promise<SessionRef> {
    let finalFile = sessionFile;
    let finalCwd = cwdOverride;

    if (!fs.existsSync(finalFile)) {
      const sessionId = this.extractSessionId(finalFile);
      if (sessionId) {
        const resolved = this.resolveSessionById(sessionId, finalCwd);
        if (resolved) {
          finalFile = resolved.sessionFile;
          finalCwd = resolved.cwd;
        }
      }
    }

    if (!fs.existsSync(finalFile)) {
      throw new Error(`Session file not found: ${sessionFile}`);
    }

    const cwd = finalCwd ?? this.resolveWorkspaceFromSessionFile(finalFile);
    console.log('[session-supervisor] open sessionFile:', finalFile);
    console.log('[session-supervisor] open cwd:', cwd);
    const sessionManager = SessionManager.open(finalFile, undefined, cwd);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: this.runtime.agentDir,
      settingsManager: this.runtime.settingsManager,
    });
    console.log('[session-supervisor] open project trusted before reload:', this.runtime.settingsManager.isProjectTrusted());
    await resourceLoader.reload({ resolveProjectTrust: async () => true });
    console.log('[session-supervisor] open project trusted after reload:', this.runtime.settingsManager.isProjectTrusted());
    const skillResult = resourceLoader.getSkills();
    console.log('[session-supervisor] loaded skills:', skillResult.skills.length, 'diagnostics:', skillResult.diagnostics.length);
    for (const s of skillResult.skills) {
      console.log('[session-supervisor] skill:', s.name, s.sourceInfo?.scope ?? s.sourceInfo?.source ?? 'unknown', s.filePath);
    }
    for (const d of skillResult.diagnostics) {
      console.warn('[session-supervisor] skill diagnostic:', d.type, d.message, d.path);
    }

    const { session } = await createAgentSession({
      cwd,
      agentDir: this.runtime.agentDir,
      modelRuntime: this.runtime.modelRuntime,
      settingsManager: this.runtime.settingsManager,
      sessionManager,
      resourceLoader,
      customTools: createOfficeTools(cwd),
    });

    const sessionId = sessionManager.getSessionId() ?? randomUUID();
    const userCopyPath = this.getUserCopyPath(cwd, sessionId);
    const ref: SessionRef = {
      sessionId,
      sessionFile: finalFile,
      cwd,
      name: sessionManager.getSessionName() ?? `Session ${sessionId.slice(0, 8)}`,
    };

    this.bindSession(ref, sessionManager, session, resourceLoader);
    this.syncSessionCopy(ref, userCopyPath);
    this.upsertIndex(ref, userCopyPath);
    return ref;
  }

  /** 列出某工作区的会话 */
  async listSessions(workspacePath: string): Promise<SessionRef[]> {
    ensureDir(workspacePath);

    // 优先使用持久化的 SQLite 索引
    const indexed = this.runtime.sessionIndex.getSessionsByWorkspace(workspacePath).map((r) => ({
      sessionId: r.sessionId,
      sessionFile: r.workspaceFilePath,
      cwd: r.workspacePath,
      name: r.title ?? `Session ${r.sessionId.slice(0, 8)}`,
    }));

    // 扫描工作区 .pi/sessions 目录作为兜底
    const sessionsDir = path.join(workspacePath, '.pi', 'sessions');
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
      for (const file of files) {
        const sessionFile = path.join(sessionsDir, file);
        const id = path.basename(file, '.jsonl');
        const existing = indexed.find((s) => s.sessionFile === sessionFile);
        if (!existing) {
          try {
            const sm = SessionManager.open(sessionFile, undefined, workspacePath);
            indexed.push({
              sessionId: sm.getSessionId() ?? id,
              sessionFile,
              cwd: workspacePath,
              name: sm.getSessionName() ?? `Session ${id.slice(0, 8)}`,
            });
          } catch (err) {
            console.error('[session-supervisor] open session failed:', sessionFile, err);
            indexed.push({ sessionId: id, sessionFile, cwd: workspacePath, name: `Session ${id.slice(0, 8)}` });
          }
        }
      }
    }

    // 扫描 pi agentDir / pi-acp 会话，兼容 ACP 模式
    try {
      const piAll = listPiSessions();
      for (const s of piAll) {
        if (!pathsEqual(s.cwd, workspacePath)) continue;
        if (indexed.find((r) => r.sessionId === s.sessionId || pathsEqual(r.sessionFile, s.sessionFile))) continue;
        indexed.push({
          sessionId: s.sessionId,
          sessionFile: s.sessionFile,
          cwd: s.cwd,
          name: s.title ?? `Session ${s.sessionId.slice(0, 8)}`,
        });
      }
    } catch {
      /* ignore */
    }

    return indexed.filter((ref) => {
      const sessionFile = ref.sessionFile || this.resolveSessionFilePath(workspacePath, ref.sessionId);
      return hasMeaningfulUserEntry(sessionFile, workspacePath);
    });
  }

  /** 关闭某会话 */
  closeSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;
    active.unsubscribe();
    this.activeSessions.delete(sessionId);
  }

  /** 删除会话：删 workspace 原始 JSONL + userData 副本 + SQLite 索引；幂等 */
  async deleteSession(sessionId: string): Promise<void> {
    // 1. 先关闭
    this.closeSession(sessionId);
    // 2. 删 SQLite 索引
    try {
      if ((this.runtime as any).sessionIndex && typeof (this.runtime as any).sessionIndex.deleteSession === 'function') {
        (this.runtime as any).sessionIndex.deleteSession(sessionId);
      }
    } catch { /* ignore */ }
    // 3. 扫 workspace 路径找对应 session 文件（从 listSessions 反查或遍历已知目录）
    const tryUnlink = (p: string) => {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
    };
    // 3a. userData/sessions 下所有子目录里找 ${sessionId}.jsonl
    try {
      const root = getUserSessionsDir();
      if (fs.existsSync(root)) {
        const wsDirs = fs.readdirSync(root, { withFileTypes: true });
        for (const d of wsDirs) {
          if (!d.isDirectory()) continue;
          const candidate = path.join(root, d.name, `${sessionId}.jsonl`);
          tryUnlink(candidate);
        }
      }
    } catch { /* ignore */ }
    // 3b. listSessions 里找到的（若之前调用过缓存）——没缓存就不删，留给下次 listSessions 时自然消失
    // (SDK 模式的 listSessions 是从 sessionIndex + filesystem 动态读取的，删了文件就不会显示)
  }

  /** 获取已打开的会话 */
  getSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /** 发送用户消息 */
  async sendMessage(sessionId: string, input: UserMessageInput): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);

    const agentSkillPrompt = getMarketplaceAgentSkillPrompt(input.selectedAgentId);
    const text = agentSkillPrompt
      ? `<<<SYSTEM>>>\n${agentSkillPrompt}\n<<</SYSTEM>>>\n\n${input.text}`
      : input.text;
    // 暂不支持图片，留好接口
    try {
      await active.agentSession.prompt(text, {
        source: 'interactive',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 先保存用户消息，再写入错误提示，确保 UI 能显示
      active.sessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now(),
      } as any);
      active.sessionManager.appendCustomMessageEntry(
        'native_error',
        `发送失败：${msg}\n请检查 .pi/agent/models.json 和 auth.json 中的模型与 API Key 配置。`,
        true,
        { error: true }
      );
      throw new Error(msg);
    }
  }

  /** 取消当前运行 */
  async cancelRun(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);
    await active.agentSession.abort();
  }

  /** 列出可用模型 */
  async listAvailableModels(): Promise<Array<{ providerId: string; modelId: string; label?: string }>> {
    const { modelRuntime } = this.runtime;
    await modelRuntime.refresh();
    const available = await modelRuntime.getAvailable();
    const list: Array<{ providerId: string; modelId: string; label?: string }> = [];

    for (const model of available) {
      const modelId = (model as any).id ?? (model as any).modelId ?? '';
      const modelName = (model as any).name ?? modelId;
      const providers = modelRuntime.getProviders();
      const providerId =
        providers.find((p) => {
          const models = modelRuntime.getModels(p.id);
          return models.some((m) => ((m as any).id ?? (m as any).modelId ?? '') === modelId);
        })?.id ?? 'unknown';
      list.push({ providerId, modelId, label: modelName });
    }

    return list;
  }

  /** 切换当前会话模型并保存默认值 */
  async setModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);

    const { modelRuntime, settingsManager } = this.runtime;
    const model = modelRuntime.getModel(providerId, modelId);
    if (!model) throw new Error(`Model not available: ${providerId} / ${modelId}`);

    await active.agentSession.setModel(model);
    if (typeof (settingsManager as any).setDefaultModelAndProvider === 'function') {
      (settingsManager as any).setDefaultModelAndProvider(providerId, modelId);
    }
  }

  /** 导航会话树 */
  async navigateTree(sessionId: string, targetId: string, summarize = false): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);
    await active.agentSession.navigateTree(targetId, { summarize });
  }

  /** 获取会话树 */
  getSessionTree(sessionId: string): SessionNode[] {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);
    const tree = active.sessionManager.getTree();
    return this.mapTreeNodes(tree);
  }

  /** 获取转录 */
  getTranscript(sessionId: string): SessionTranscriptItem[] {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);
    const entries = active.sessionManager.getEntries();
    return this.mapEntriesToTranscript(entries as any[]);
  }

  /** 获取当前会话加载的 skills */
  listSkills(sessionId: string): SkillInfo[] {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);
    const { skills } = active.resourceLoader?.getSkills() ?? { skills: [] };
    return skills.map((skill: Skill) => this.mapSkill(skill));
  }

  /** 调用指定 skill */
  async invokeSkill(sessionId: string, skillName: string, args?: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);
    const { skills } = active.resourceLoader?.getSkills() ?? { skills: [] };
    const skill = skills.find((s: Skill) => s.name === skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    const command = args ? `/skill:${skillName} ${args}`.trim() : `/skill:${skillName}`;
    await active.agentSession.prompt(command, { source: 'interactive' });
  }

  /** 把 SDK Skill 映射为 SkillInfo */
  private mapSkill(skill: Skill): SkillInfo {
    return {
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      baseDir: skill.baseDir,
      source: skill.sourceInfo.scope ?? skill.sourceInfo.source ?? 'project',
      enabled: !skill.disableModelInvocation,
      disableModelInvocation: skill.disableModelInvocation,
      slashCommand: `/skill:${skill.name}`,
    };
  }

  /** 绑定会话与事件监听 */
  private bindSession(ref: SessionRef, sessionManager: SessionManager, agentSession: AgentSession, resourceLoader?: ResourceLoader): void {
    const active: ActiveSession = {
      ref,
      sessionManager,
      agentSession,
      resourceLoader,
      unsubscribe: () => {
        /* no-op for now */
      },
    };

    // 订阅事件，通过 PiSdkDriver 的 onEvent 机制分发
    const unsubscribe = agentSession.subscribe((event) => {
      this.handleSessionEvent(active, event);
    });
    active.unsubscribe = unsubscribe;

    // 限制文件类工具只能访问工作区目录
    this.enforceWorkspaceTools(active);

    this.activeSessions.set(ref.sessionId, active);
  }

  /** 在 Agent 的 beforeToolCall 钩子中限制文件工具只能操作工作区 */
  private enforceWorkspaceTools(active: ActiveSession): void {
    const workspacePath = path.resolve(active.ref.cwd);
    const agent = active.agentSession.agent as any;
    const original = agent.beforeToolCall;

    agent.beforeToolCall = async ({ toolCall, args }: { toolCall: { name: string; id?: string }; args: any }) => {
      const filePath = this.findArgPath(args);
      if (filePath) {
        const resolved = path.resolve(workspacePath, filePath);
        if (!this.isWithinWorkspace(resolved, workspacePath)) {
          throw new Error(`工具 ${toolCall.name} 只能访问工作区 ${workspacePath} 内的文件，请求路径 ${resolved} 被拒绝。`);
        }
      }
      return original?.({ toolCall, args });
    };
  }

  /** 从工具参数中提取可能的路径 */
  private findArgPath(args: any): string | undefined {
    if (!args || typeof args !== 'object') return undefined;
    for (const key of ['path', 'file_path', 'target', 'file', 'new_path']) {
      const v = args[key];
      if (typeof v === 'string' && v) return v;
    }
    return undefined;
  }

  /** 判断绝对路径是否在工作区根下 */
  private isWithinWorkspace(resolved: string, workspace: string): boolean {
    const root = path.resolve(workspace);
    const norm = path.resolve(resolved);
    return norm === root || norm.startsWith(root + path.sep);
  }

  /** 处理会话事件 */
  private handleSessionEvent(active: ActiveSession, event: any): void {
    // 事件由 PiSdkDriver 的 event handler 进一步分发到渲染进程
    // eslint-disable-next-line no-console
    console.log(`[session ${active.ref.sessionId}] event:`, event.type);

    // 新增条目时同步 userData 副本与索引
    if (event.type === 'entry_appended' || event.type === 'agent_end' || event.type === 'agent_settled') {
      this.syncSessionCopy(active.ref);
      this.upsertIndex(active.ref);
    }

    // 新会话首次结束时，使用当前模型生成简短名称
    if ((event.type === 'agent_end' || event.type === 'agent_settled') && active.needsName) {
      this.suggestAndSetName(active.ref.sessionId).catch(() => { /* 命名失败不应中断主流程 */ });
    }

    // 把增量事件广播出去，渲染进程可据此刷新转录和文件树
    try {
      this.onEvent?.(active.ref.sessionId, event);
    } catch (err) {
      console.error('[session-supervisor] onEvent failed:', err);
    }
  }

  /** 把 workspace 中的会话文件同步到 userData 副本 */
  private syncSessionCopy(ref: SessionRef, userCopyPath?: string): void {
    const target = userCopyPath ?? this.getUserCopyPath(ref.cwd, ref.sessionId);
    if (!fs.existsSync(ref.sessionFile)) return;
    try {
      ensureDir(path.dirname(target));
      fs.copyFileSync(ref.sessionFile, target);
    } catch (err) {
      console.error(`[session-supervisor] failed to sync copy: ${target}`, err);
    }
  }

  /** 把会话信息写入 SQLite 索引 */
  private upsertIndex(ref: SessionRef, userCopyPath?: string): void {
    try {
      this.runtime.sessionIndex.upsertSession({
        sessionId: ref.sessionId,
        workspacePath: ref.cwd,
        title: ref.name,
        userCopyPath: userCopyPath ?? this.getUserCopyPath(ref.cwd, ref.sessionId),
        workspaceFilePath: ref.sessionFile,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[session-supervisor] failed to upsert index: ${ref.sessionId}`, err);
    }
  }

  /** 把 SessionTreeNode 映射为简单的树结构 */
  private mapTreeNodes(nodes: any[]): SessionNode[] {
    return nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      type: node.type ?? 'entry',
      label: node.label,
      children: node.children ? this.mapTreeNodes(node.children) : [],
    }));
  }

  /** 把 SessionEntry 映射为转录项 */
  private mapEntriesToTranscript(entries: any[]): SessionTranscriptItem[] {
    return entries.map((entry) => {
      const base: SessionTranscriptItem = {
        type: this.inferEntryType(entry),
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
      };

      if (entry.type === 'message') {
        const role = entry.message?.role;
        if (role === 'toolResult') {
          base.type = 'tool';
          base.tool = this.extractToolResult(entry, entries);
        } else if (role === 'user') {
          const text = this.extractMessageText(entry);
          if (typeof text === 'string') {
            const skill = parseSkillBlock(text);
            if (skill) {
              base.content = skill.userMessage
                ? `调用了 skill [${skill.name}]\n\n参数：${skill.userMessage}`
                : `调用了 skill [${skill.name}]`;
            } else {
              base.content = text;
            }
          }
        } else {
          base.content = this.extractMessageText(entry);
        }
      } else if (entry.type === 'tool_call') {
        base.tool = this.extractToolCall(entry);
      } else if (entry.type === 'custom') {
        const details = entry.details as any;
        base.content = this.extractMessageText(entry) ?? (details?.error ? '错误' : JSON.stringify(entry.data ?? entry.content));
        if (details?.error) {
          base.type = 'error';
        }
      } else if (entry.type === 'plan') {
        const raw = entry.data ?? entry.plan ?? entry.content ?? entry.details;
        const rawEntries = Array.isArray(raw)
          ? raw
          : (raw?.entries ?? raw?.plan ?? raw?.steps ?? raw?.tasks ?? []);
        base.type = 'plan';
        base.plan = {
          entries: rawEntries.map((e: any) => ({
            content: String(e?.content ?? e?.title ?? e?.description ?? ''),
            status: String(e?.status ?? e?.state ?? 'pending'),
            priority: e?.priority ?? undefined,
          })),
        };
      } else if (entry.type === 'session_info') {
        // 会话元信息，不进入聊天展示
      } else if (entry.type === 'model_change') {
        // 模型切换元信息，不进入聊天展示
      } else if (entry.type === 'thinking_level_change') {
        // 思考级别元信息，不进入聊天展示
      } else if (entry.type === 'compaction') {
        // 压缩摘要，不进入聊天展示
      } else if (entry.type === 'branch_summary') {
        // 分支摘要，不进入聊天展示
      }

      return base;
    });
  }

  /** 推断条目类型 */
  private inferEntryType(entry: any): SessionTranscriptItem['type'] {
    if (entry.type === 'message') {
      const role = entry.message?.role ?? entry.role;
      if (role === 'user') return 'user';
      if (role === 'assistant') return 'assistant';
      if (role === 'system') return 'system';
      if (role === 'toolResult') return 'tool';
      return 'assistant';
    }
    if (entry.type === 'custom') {
      const details = entry.details as any;
      return details?.error ? 'error' : 'system';
    }
    if (entry.type === 'tool_call') return 'tool';
    if (entry.type === 'compaction') return 'compact';
    if (entry.type === 'branch_summary') return 'branch';
    if (entry.type === 'model_change') return 'model';
    if (entry.type === 'thinking_level_change') return 'thinking';
    if (entry.type === 'session_info') return 'system';
    if (entry.type === 'plan') return 'plan';
    return 'system';
  }

  /** 提取消息文本 */
  private extractMessageText(entry: any): string | undefined {
    const content = entry.message?.content ?? entry.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c.type === 'text' || typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('\n');
    }
    return undefined;
  }

  /** 使用当前模型给会话起一个不超十字的名称 */
  private async suggestAndSetName(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;
    if (!active.needsName) return;
    active.needsName = false;

    const entries = active.sessionManager.getEntries() as any[];
    const userEntry = entries.find((e) => e.type === 'message' && e.message?.role === 'user');
    if (!userEntry) return;

    const userText = this.extractMessageText(userEntry);
    if (!userText) return;

    // 优先使用会话当前模型，否则使用驱动初始化时保存的默认模型
    const model = (active.agentSession as any).model ?? this.runtime.currentModel;
    if (!model) return;

    const prompt = `请根据下面的用户问题，用不超过十个字给这个会话起一个简洁名称，只返回名称文本，不要解释。\n\n用户问题：${userText}`;
    const context = {
      messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }],
    };

    try {
      const result = (await this.runtime.modelRuntime.completeSimple(model as any, context, {
        maxTokens: 20,
        temperature: 0.3,
      })) as any;
      let name = this.extractAssistantText(result) ?? '';
      name = name.replace(/^["'“”]|["'“"]$/g, '').trim();
      if (!name) return;
      if (name.length > 10) name = name.slice(0, 10);

      active.ref.name = name;
      active.sessionManager.appendSessionInfo(name);
      this.syncSessionCopy(active.ref);
      this.upsertIndex(active.ref);
      this.onEvent?.(sessionId, { type: 'session_renamed', name });
    } catch (err) {
      console.error('[session-supervisor] 会话命名失败:', err);
    }
  }

  /** 从 AssistantMessage 中提取文本 */
  private extractAssistantText(message: any): string | undefined {
    if (!message || !Array.isArray(message.content)) return undefined;
    const text = message.content
      .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
      .trim();
    return text || undefined;
  }

  /** 提取工具调用 */
  private extractToolCall(entry: any): ToolCallInfo | undefined {
    const tool = entry.tool;
    if (!tool) return undefined;
    return {
      name: tool.name ?? tool.toolName ?? 'tool',
      input: tool.input ?? tool.arguments,
      result: undefined,
      error: tool.error,
    };
  }

  /** 从 toolResult 消息提取工具摘要，尝试从对应 toolCall 找回文件路径 */
  private extractToolResult(entry: any, entries: any[]): ToolCallInfo | undefined {
    const message = entry.message ?? {};
    const toolName = message.toolName ?? 'tool';
    const toolCallId = message.toolCallId;
    const isError = message.isError;
    let input: Record<string, unknown> | undefined;

    if (toolCallId && Array.isArray(entries)) {
      for (const e of entries) {
        if (e.type !== 'message' || e.message?.role !== 'assistant') continue;
        const content = e.message.content;
        if (!Array.isArray(content)) continue;
        const call = content.find((c: any) => c.type === 'toolCall' && c.id === toolCallId);
        if (call) {
          input = call.arguments;
          break;
        }
      }
    }

    return {
      name: toolName,
      input,
      result: undefined,
      error: isError ? '执行失败' : undefined,
    };
  }
}
