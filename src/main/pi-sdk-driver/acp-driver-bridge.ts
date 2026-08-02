import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname as pathDirname, join as pathJoin, basename as pathBasename } from 'node:path';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type * as schema from '@agentclientprotocol/sdk/dist/schema/types.gen.js';
import { PiAcpAgent, findPiSession, listPiSessions, SessionStore } from 'pi-acp';
import type { PiSessionListItem } from 'pi-acp';
import type { AgentTemplate, SessionRef, SessionTranscriptItem, SkillInfo, ToolCallInfo, UserMessageInput } from './types';
import { diagLog, getDebugLogPath } from './debug-logger';

const TAG = 'AcpDriverBridge';
const MAX_INMEMORY_SESSIONS = 100;
const TRANSCRIPT_LINE_MARKER_UPDATE = '__u';

export const BUILTIN_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'requirement-splitter',
    name: '需求拆解大师',
    emoji: '🧩',
    description: '帮您把模糊的产品需求，自动拆成可执行的小任务列表（按「功能模块 / 优先级 / 验收标准 / 风险点」四段输出）。',
    presetSkillNames: [],
    systemPrompt:
      '你是一名资深产品经理兼架构师。用户输入的任何需求描述，请按如下结构输出：\n' +
      '1) 🎯 核心目标（1-2 句话总结这个需求要解决什么问题）\n' +
      '2) 📦 功能模块拆解（按独立可交付的模块，每个模块写模块名 + 简述）\n' +
      '3) 🏗️ 任务清单（每个模块下的原子任务，带优先级 P0/P1/P2）\n' +
      '4) ✅ 验收标准（每个模块完成的判定条件）\n' +
      '5) ⚠️ 风险点 & 依赖（外部依赖/潜在坑/跨端影响）\n' +
      '全程用中文，结构化输出，避免含糊词汇。',
  },
];

/** 返回 id → AgentTemplate 索引 */
export function getAgentTemplate(id: string): AgentTemplate | undefined {
  return BUILTIN_AGENT_TEMPLATES.find((t) => t.id === id);
}

const fs = {
  existsSync, mkdirSync, appendFileSync, readFileSync, statSync, readdirSync,
};
const path = { dirname: pathDirname, join: pathJoin, basename: pathBasename };
const os = { homedir };

function getAgentStudioTranscriptsDir(): string {
  return path.join(os.homedir(), '.pi', 'pi-acp', 'agent-studio-transcripts');
}
function getTranscriptJsonlPath(sessionId: string): string {
  return path.join(getAgentStudioTranscriptsDir(), `${sessionId}.jsonl`);
}
function ensureTranscriptsDir(): void {
  const dir = getAgentStudioTranscriptsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function safeListPiSessions(): PiSessionListItem[] {
  try {
    return Array.isArray((listPiSessions as any)?.()) ? (listPiSessions as any)() : [];
  } catch (e: any) {
    diagLog(TAG, `listPiSessions threw: ${e?.message ?? String(e)}`);
    return [];
  }
}
function pathsEqual(a: string, b: string): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const A = String(a).trim().replace(/\\/g, '/').replace(/\/$/, '');
  const B = String(b).trim().replace(/\\/g, '/').replace(/\/$/, '');
  return A === B;
}
function statMtimeMs(p: string): number {
  try {
    if (!p || !fs.existsSync(p)) return 0;
    return Number(fs.statSync(p).mtimeMs) || 0;
  } catch {
    return 0;
  }
}

type DriverEventHandler = (sessionId: string, event: any) => void;

type AssistantAccumulator = {
  id: string;
  parentId: string | null;
  textParts: string[];
  thinkingParts: string[];
  timestamp: number;
};

class BridgeInMemoryConnection {
  private readonly _abortController = new AbortController();
  private readonly _closedPromise: Promise<void> = new Promise(() => {});

  constructor(
    private readonly onSessionUpdate: (sessionId: string, update: schema.SessionUpdate) => void,
    private readonly onRequestPermission?: (
      req: schema.RequestPermissionRequest
    ) => schema.RequestPermissionResponse | Promise<schema.RequestPermissionResponse>
  ) {}

  async sessionUpdate(params: schema.SessionNotification): Promise<void> {
    this.onSessionUpdate(params.sessionId, params.update);
  }

  async requestPermission(
    params: schema.RequestPermissionRequest
  ): Promise<schema.RequestPermissionResponse> {
    if (this.onRequestPermission) {
      const result = await Promise.resolve(this.onRequestPermission(params));
      return result as schema.RequestPermissionResponse;
    }
    const options = (params as any)?.options ?? [];
    const allowOpt = options.find((o: any) => o?.kind === 'allow_once') ?? options[0];
    if (allowOpt) {
      return {
        outcome: {
          outcome: 'selected',
          optionId: String(allowOpt.optionId),
        },
      } as unknown as schema.RequestPermissionResponse;
    }
    return { outcome: { outcome: 'cancelled' } } as unknown as schema.RequestPermissionResponse;
  }

  async readTextFile(_params: schema.ReadTextFileRequest): Promise<schema.ReadTextFileResponse> {
    throw new Error('readTextFile not implemented in memory bridge');
  }

  async writeTextFile(_params: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse> {
    throw new Error('writeTextFile not implemented in memory bridge');
  }

  async createTerminal(
    _params: schema.CreateTerminalRequest
  ): Promise<any> {
    throw new Error('createTerminal not implemented in memory bridge');
  }

  async extMethod(_method: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {};
  }

  async extNotification(_method: string, _params: Record<string, unknown>): Promise<void> {
    /* no-op */
  }

  get signal(): AbortSignal {
    return this._abortController.signal;
  }

  get closed(): Promise<void> {
    return this._closedPromise;
  }
}

export class AcpDriverBridge {
  private piAgent?: PiAcpAgent;
  private conn?: BridgeInMemoryConnection;
  private transcriptCache = new Map<string, SessionTranscriptItem[]>();
  /** 每个 session 下一次 push() 使用的 monotonically increasing internalSeq，保证同一 timestamp 下仍然按事件到达顺序稳定排序 */
  private transcriptNextSeq = new Map<string, number>();
  private transcriptLastAccess = new Map<string, number>();
  private sessionMeta = new Map<
    string,
    { sessionFile: string; cwd: string; title?: string; needsName?: boolean; agentTemplateId?: string; }
  >();
  private readonly store = new SessionStore();
  private assistantAccumulator = new Map<string, AssistantAccumulator>();
  private toolCallCache = new Map<string, { id: string; toolCallId: string; tool: ToolCallInfo; timestamp: number; parentId: string | null; }>();
  private currentRoundId = new Map<string, string>();
  /** 每次 prompt() 开始时重置为 0，每收到一次 tool/plan 更新后自增，用于切断 thinking/assistant accumulator 的跨阶段复用 */
  private currentPhaseId = new Map<string, number>();
  private forcedModel: { providerId: string; modelId: string } | null = null;
  private skillsCache = new Map<string, SkillInfo[]>();
  private lastSkillsScanAt = new Map<string, number>();

  constructor(private readonly eventHandler: DriverEventHandler) {}

  async initialize(_cwd: string): Promise<void> {
    diagLog(TAG, `initialize: cwd=${_cwd} PI_ACP_PI_COMMAND=${process.env.PI_ACP_PI_COMMAND ?? '(unset)'} PI_CODING_AGENT_DIR=${process.env.PI_CODING_AGENT_DIR ?? '(unset)'} debugLogPath=${getDebugLogPath() ?? '(unset)'}`);
    this.conn = new BridgeInMemoryConnection(
      (sessionId, update) => this.handleAcpSessionUpdate(sessionId, update),
      (req) => {
        diagLog(TAG, `requestPermission: reason=${(req as any)?.reason ?? ''} toolCalls=${JSON.stringify((req as any)?.toolCalls ?? [])}`);
        const options = (req as any)?.options ?? [];
        const allowOpt = options.find((o: any) => o?.kind === 'allow_once') ?? options[0];
        if (allowOpt) {
          return {
            outcome: {
              outcome: 'selected',
              optionId: String(allowOpt.optionId),
            },
          } as unknown as schema.RequestPermissionResponse;
        }
        return { outcome: { outcome: 'cancelled' } } as unknown as schema.RequestPermissionResponse;
      }
    );
    this.piAgent = new PiAcpAgent(this.conn as unknown as AgentSideConnection);
    diagLog(TAG, `initialize: constructed PiAcpAgent, calling initialize({protocolVersion:1})...`);
    await this.piAgent.initialize({ protocolVersion: 1, clientCapabilities: {} });
    diagLog(TAG, `initialize: piAgent.initialize OK`);
  }

  /** 从全局 ModelsConfig + selectedModel 推导 (providerId, modelId)，并强制在 createSession 后设置 */
  setForcedModelFromConfig(
    modelsConfig: Record<string, any> | undefined,
    selectedModel: string | undefined
  ): { providerId: string; modelId: string } | null {
    if (!modelsConfig) { this.forcedModel = null; return null; }
    const alias = (selectedModel && typeof selectedModel === 'string') ? selectedModel : (Object.keys(modelsConfig)[0] ?? null);
    if (!alias) { this.forcedModel = null; return null; }
    const modelCfg = modelsConfig[alias];
    if (!modelCfg) { this.forcedModel = null; return null; }
    const providerId = String(modelCfg.provider ?? '').trim();
    const modelId = String(modelCfg.modelId ?? '').trim();
    if (!providerId || !modelId) { this.forcedModel = null; return null; }
    this.forcedModel = { providerId, modelId };
    diagLog(TAG, `forcedModel = ${providerId}/${modelId} (alias=${alias})`);
    return this.forcedModel;
  }

  async createSession(workspacePath: string, name?: string, agentTemplateId?: string): Promise<SessionRef> {
    if (!this.piAgent) throw new Error('AcpDriverBridge not initialized');
    diagLog(TAG, `createSession: workspacePath=${workspacePath} name=${name ?? ''} agentTemplateId=${agentTemplateId ?? ''}`);
    const t0 = Date.now();
    const resp = await this.piAgent.newSession({ cwd: workspacePath } as schema.NewSessionRequest);
    const dt = Date.now() - t0;
    const sessionId = resp.sessionId;
    diagLog(TAG, `createSession: OK sessionId=${sessionId} took=${dt}ms`);

    // 1. 强制把模型切换到配置里指定的 (providerId, modelId)，避免 pi 默认模型错配
    if (this.forcedModel) {
      try {
        const before = (this.piAgent as any).sessions?.maybeGet(sessionId)?.proc;
        const currentModelId: string | null | undefined = (resp as any)?.models?.currentModelId ?? null;
        diagLog(TAG, `createSession: piAcp reported currentModelId=${currentModelId} setting forced ${this.forcedModel.providerId}/${this.forcedModel.modelId}...`);
        if (typeof (this.piAgent as any).unstable_setSessionModel === 'function') {
          await (this.piAgent as any).unstable_setSessionModel({ sessionId, providerId: this.forcedModel.providerId, modelId: this.forcedModel.modelId });
        } else if (before?.setModel) {
          await before.setModel(this.forcedModel.providerId, this.forcedModel.modelId);
        }
        const afterState: any = before?.getState ? await before.getState().catch(() => null) : null;
        diagLog(TAG, `createSession: after setModel, state.model = ${JSON.stringify(afterState?.model ?? '(unknown)')}`);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.warn(`[${TAG}] createSession: setModel warning (non-fatal): ${msg}`);
        diagLog(TAG, `createSession: setModel warning (non-fatal): ${msg}`);
      }
    }
    // 2. 额外诊断：把 pi 报告的 availableModels/currentModel 打出来
    try {
      const s = (this.piAgent as any).sessions?.maybeGet(sessionId);
      if (s?.proc) {
        const [aModels, st] = await Promise.all([
          s.proc.getAvailableModels?.().catch(() => null),
          s.proc.getState?.().catch(() => null),
        ]);
        diagLog(TAG, `createSession: pi.getAvailableModels.models = ${JSON.stringify(Array.isArray((aModels as any)?.models) ? (aModels as any).models.map((m: any) => ({provider: m.provider, id: m.id, name: m.name})) : aModels).slice(0, 800)}`);
        diagLog(TAG, `createSession: pi.getState().model = ${JSON.stringify((st as any)?.model ?? null)}  cost=${JSON.stringify((st as any)?.cost ?? null)}  sessionFile=${(st as any)?.sessionFile ?? ''}`);
      }
    } catch { /* non-fatal */ }

    let sessionFile: string | undefined;

    const stored = this.store.get(sessionId);
    if (stored?.sessionFile) {
      sessionFile = stored.sessionFile;
    } else {
      const found = findPiSession(sessionId);
      if (found) {
        sessionFile = found.sessionFile;
        this.store.upsert({ sessionId, cwd: workspacePath, sessionFile });
      }
    }

    if (!sessionFile) {
      try {
        const state: any = await (this.piAgent as any).sessions?.maybeGet(sessionId)?.proc?.getState?.().catch(() => null);
        if (state?.sessionFile && typeof state.sessionFile === 'string') {
          const sessionFileStr: string = state.sessionFile;
          sessionFile = sessionFileStr;
          this.store.upsert({ sessionId, cwd: workspacePath, sessionFile: sessionFileStr });
        }
      } catch {
        /* ignore */
      }
    }

    const fallbackSessionFile = sessionFile ?? '';
    this.sessionMeta.set(sessionId, {
      sessionFile: fallbackSessionFile,
      cwd: workspacePath,
      title: name,
      needsName: !name,
      agentTemplateId,
    });

    ensureTranscriptsDir();
    this.transcriptCache.set(sessionId, []);
    this.transcriptNextSeq.set(sessionId, 0);
    this.currentPhaseId.set(sessionId, 0);
    this.markAccess(sessionId);
    this.evictLruIfNeeded();

    const ref: SessionRef = {
      sessionId,
      sessionFile: fallbackSessionFile,
      cwd: workspacePath,
      name,
    };

    this.eventHandler(sessionId, { type: 'entry_appended' });

    return ref;
  }

  async prompt(sessionId: string, input: UserMessageInput): Promise<void> {
    if (!this.piAgent) throw new Error('AcpDriverBridge not initialized');
    const meta = this.sessionMeta.get(sessionId);
    if (!meta) throw new Error(`Unknown session: ${sessionId}`);
    diagLog(TAG, `prompt: sessionId=${sessionId} textLength=${(input.text ?? '').length}`);

    // ⬇⬇⬇ smart body：如果该会话绑定了 AgentTemplate
    // - presetSkillNames 非空 → 每个 skill 自动注入 /skill:xxx 前缀
    // - systemPrompt 非空 → 每轮 prompt 开头自动拼
    let text = input.text ?? '';
    if (meta.agentTemplateId) {
      const tmpl = getAgentTemplate(meta.agentTemplateId);
      if (tmpl) {
        const pieces: string[] = [];
        if (Array.isArray(tmpl.presetSkillNames) && tmpl.presetSkillNames.length > 0) {
          const allSkills = this.listSkills(sessionId);
          const nameSet = new Set(allSkills.map((s) => s.name));
          for (const sName of tmpl.presetSkillNames) {
            if (!sName) continue;
            if (!nameSet.has(sName)) continue;
            pieces.push(`/skill:${sName}`);
          }
        }
        if (tmpl.systemPrompt && !text.startsWith('<<<SYSTEM>>>')) {
          pieces.push(`<<<SYSTEM>>>\n${tmpl.systemPrompt}\n<<</SYSTEM>>>`);
        }
        if (pieces.length > 0) {
          text = `${pieces.join('\n')}\n\n${text}`.trim();
        }
      }
    }

    // ⬇⬇⬇ 关键：每一次 prompt 就是新的一轮对话，强制分配一个新 roundId，保证 accumulator 每轮都是新实例，
    // 绝对不会出现第二轮 assistant/thinking 复用第一轮 accum → 内容被 append 到旧 bubble 的问题！
    // 同时 phaseId = 0：每遇到一次 tool / plan 触发，phaseId++，就会切断同一 round 内跨阶段的 accumulator 复用
    // （例如"think A → tool → think B → answer"中 think B 和 answer 会生成新的独立 bubble 紧接在 tool 下面，
    // 而不是回写到 think A 的旧 thinking bubble 里）
    const newRoundId = randomUUID();
    this.currentRoundId.set(sessionId, newRoundId);
    this.currentPhaseId.set(sessionId, 0);

    const { parentId: userParentId, lastTs: userLastTs } = this.findNextParentAnchor(sessionId);
    const userItemId = randomUUID();
    const userItem: SessionTranscriptItem = {
      type: 'user',
      id: userItemId,
      parentId: userParentId,
      timestamp: userLastTs ? Math.max(userLastTs + 1, Date.now()) : Date.now(),
      content: input.text,
    };
    this.ensureItemPresent(sessionId, userItem, 'user');
    this.eventHandler(sessionId, { type: 'entry_appended' });

    const promptBlocks: schema.ContentBlock[] = [{ type: 'text', text: input.text }];
    if (input.images?.length) {
      for (const img of input.images) {
        promptBlocks.push({
          type: 'image',
          data: img.data,
          mimeType: img.mediaType ?? 'image/png',
        } as schema.ImageContent & { type: 'image' });
      }
    }

    try {
      await this.piAgent.prompt({
        sessionId,
        prompt: promptBlocks,
      } as schema.PromptRequest);
      diagLog(TAG, `prompt resolved: sessionId=${sessionId} (prompt done without throw)`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error(`[${TAG}] prompt THREW for sessionId=${sessionId}: ${msg}`, e);
      diagLog(TAG, `prompt THREW for sessionId=${sessionId}: ${msg}`);
      throw e;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    if (!this.piAgent) return;
    diagLog(TAG, `cancel: sessionId=${sessionId}`);
    await this.piAgent.cancel({ sessionId });
  }

  listSkills(sessionId: string): SkillInfo[] {
    const existing = this.skillsCache.get(sessionId);
    if (existing) return existing;
    const result = this.scanSkillsForSession(sessionId);
    this.skillsCache.set(sessionId, result);
    this.lastSkillsScanAt.set(sessionId, Date.now());
    return result;
  }

  async invokeSkill(sessionId: string, skillName: string, args?: string): Promise<void> {
    if (!this.piAgent) throw new Error('AcpDriverBridge not initialized');
    const all = this.listSkills(sessionId);
    const found = all.find((s) => s.name === skillName);
    if (!found) throw new Error(`Skill not found: ${skillName}`);
    const command = args ? `/skill:${skillName} ${args}`.trim() : `/skill:${skillName}`;
    await this.prompt(sessionId, { text: command });
  }

  private scanSkillsForSession(sessionId: string): SkillInfo[] {
    const meta = this.sessionMeta.get(sessionId);
    const workspace = meta?.cwd ?? '';
    const userPromptsDir = path.join(os.homedir(), '.pi', 'prompts');
    const candidates: Array<{ dir: string; source: SkillInfo['source'] }> = [
      { dir: userPromptsDir, source: 'user' },
    ];
    if (workspace) candidates.push({ dir: path.join(workspace, '.pi', 'prompts'), source: 'project' });
    const seen = new Set<string>();
    const result: SkillInfo[] = [];
    for (const { dir, source } of candidates) {
      try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of files) {
          if (ent.isDirectory()) continue;
          if (!ent.name.toLowerCase().endsWith('.md')) continue;
          const fullPath = path.join(dir, ent.name);
          const key = fullPath.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          let name = ent.name.replace(/\.md$/i, '').trim();
          let description = '';
          let disableModelInvocation = false;
          let content = '';
          try {
            content = fs.readFileSync(fullPath, 'utf8');
          } catch {
            content = '';
          }
          if (content) {
            const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
            if (fmMatch) {
              const front = fmMatch[1] ?? '';
              for (const rawLine of front.split('\n')) {
                const line = rawLine.trim();
                if (!line) continue;
                const idx = line.indexOf(':');
                if (idx <= 0) continue;
                const k = line.slice(0, idx).trim().toLowerCase();
                let v = line.slice(idx + 1).trim();
                if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
                if (k === 'name' && v) name = v;
                else if (k === 'description' && v) description = v;
                else if (k === 'disable_model_invocation' || k === 'disableModelInvocation') disableModelInvocation = /^(true|1|yes|on)$/i.test(v);
              }
            }
            if (!description) {
              const body = fmMatch ? content.slice(fmMatch[0].length) : content;
              const firstNonEmpty = body.split('\n').map((ln) => ln.trim()).find(Boolean) ?? '';
              description = firstNonEmpty ? firstNonEmpty.slice(0, 160) : `${name} skill`;
            }
          }
          if (!name) name = ent.name.replace(/\.md$/i, '');
          result.push({
            name,
            description,
            filePath: fullPath,
            baseDir: dir,
            source,
            enabled: !disableModelInvocation,
            disableModelInvocation,
            slashCommand: `/skill:${name}`,
          });
        }
      } catch {
        /* ignore scan error */
      }
    }
    result.sort((a, b) => (a.source === 'project' ? -1 : 1) - (b.source === 'project' ? -1 : 1) || a.name.localeCompare(b.name));
    return result;
  }

  private applyAvailableCommandsUpdate(sessionId: string, payload: any): void {
    const arr = Array.isArray((payload as any)?.commands) ? (payload as any).commands as any[] : [];
    if (!arr.length) return;
    const mapped: SkillInfo[] = [];
    for (const c of arr) {
      const cmdId = typeof c === 'object' && c ? String(c.id ?? c.name ?? '') : String(c ?? '');
      if (!cmdId) continue;
      const m = cmdId.match(/^skill:(.+)$/);
      if (!m) continue;
      const name = m[1].trim();
      if (!name) continue;
      mapped.push({
        name,
        description: typeof c === 'object' && c?.description ? String(c.description) : `${name} skill`,
        filePath: typeof c === 'object' && (c?.path || c?.filePath) ? String(c.path || c.filePath) : '',
        baseDir: typeof c === 'object' && (c?.baseDir || c?.base_dir) ? String(c.baseDir || c.base_dir) : '',
        source: 'acp',
        enabled: !((c as any)?.disableModelInvocation ?? false),
        disableModelInvocation: Boolean((c as any)?.disableModelInvocation),
        slashCommand: `/skill:${name}`,
      });
    }
    if (mapped.length > 0) {
      diagLog(TAG, `available_commands_update: sessionId=${sessionId} mappedSkills=${mapped.length}`);
      this.skillsCache.set(sessionId, mapped);
      this.lastSkillsScanAt.set(sessionId, Date.now());
      this.eventHandler(sessionId, { type: 'acp_update', subtype: 'skills_changed', payload: { skills: mapped } });
    }
  }

  closeSession(sessionId: string): void {
    diagLog(TAG, `closeSession: sessionId=${sessionId}`);
    this.transcriptCache.delete(sessionId);
    this.transcriptLastAccess.delete(sessionId);
    this.transcriptNextSeq.delete(sessionId);
    this.sessionMeta.delete(sessionId);
    this.currentRoundId.delete(sessionId);
    this.currentPhaseId.delete(sessionId);
    this.skillsCache.delete(sessionId);
    this.lastSkillsScanAt.delete(sessionId);
    for (const k of Array.from(this.assistantAccumulator.keys())) {
      if (k.startsWith(`${sessionId}:`)) this.assistantAccumulator.delete(k);
    }
    for (const [k, v] of Array.from(this.toolCallCache.entries())) {
      if (k.startsWith(`${sessionId}:`) || v.id.startsWith(sessionId)) this.toolCallCache.delete(k);
    }
    try {
      (this.piAgent as any)?.sessions?.close?.(sessionId);
    } catch {
      /* ignore */
    }
  }

  getTranscript(sessionId: string): SessionTranscriptItem[] {
    this.markAccess(sessionId);
    const cache = this.transcriptCache.get(sessionId);
    if (!cache) return [];
    const rawItems: SessionTranscriptItem[] = [];
    for (const item of cache) {
      if (item.type === 'assistant' || item.type === 'thinking') {
        const roundId = this.currentRoundId.get(sessionId);
        const accKeys = roundId
          ? [`${sessionId}:${roundId}:${item.id}`, `${sessionId}:${item.id}`]
          : [`${sessionId}:${item.id}`];
        let acc: AssistantAccumulator | undefined;
        for (const k of accKeys) {
          acc = this.assistantAccumulator.get(k);
          if (acc) break;
        }
        if (acc) {
          const parts = item.type === 'thinking' ? acc.thinkingParts : acc.textParts;
          rawItems.push({ ...item, content: parts.join('') });
          continue;
        }
      }
      rawItems.push(item);
    }
    const sorted = rawItems.slice().sort((a, b) => {
      // ⬇⬇⬇ 关键兜底：任何 item 只要 internalSeq = undefined（历史残留 / 直接 list.push 绕过 ensureItemPresent），
      // 临时给它分配 sortSeq = Number.MAX_SAFE_INTEGER，保证它永远排到最后——绝对不会插入上一轮 assistant/tool bubble 前面。
      const sa = typeof a.internalSeq === 'number' ? a.internalSeq : Number.MAX_SAFE_INTEGER;
      const sb = typeof b.internalSeq === 'number' ? b.internalSeq : Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      const ta = a.timestamp || 0;
      const tb = b.timestamp || 0;
      if (ta !== tb) return ta - tb;
      return String(a.id).localeCompare(String(b.id));
    });
    return sorted.map(({ internalSeq: _internalSeq, ...rest }) => rest as SessionTranscriptItem);
  }

  getSessionAgentTemplateId(sessionId: string): string | undefined {
    return this.sessionMeta.get(sessionId)?.agentTemplateId;
  }

  /** 工具/plan 插入 parentId 锚定：找当前会话里最后一条 user/assistant/thinking id，保证 visual 顺序正确 */
  private findNextParentAnchor(sessionId: string): { parentId: string | null; lastTs: number } {
    const list = this.transcriptCache.get(sessionId);
    if (!list || !list.length) return { parentId: null, lastTs: Date.now() };
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (!it) continue;
      if (it.type === 'assistant' || it.type === 'thinking' || it.type === 'user') {
        return { parentId: it.id ?? null, lastTs: it.timestamp || Date.now() };
      }
    }
    const last = list[list.length - 1];
    return { parentId: last?.id ?? null, lastTs: last?.timestamp || Date.now() };
  }

  /** 列出指定工作区的所有历史会话（来自 pi 原生 ~/.pi/agent/sessions/*.jsonl + 交叉补 SessionStore） */
  async listSessions(workspacePath: string): Promise<SessionRef[]> {
    ensureTranscriptsDir();
    const normalized = workspacePath ? String(workspacePath).trim() : '';
    const piList: PiSessionListItem[] = safeListPiSessions();
    const byCwdFromPi = normalized
      ? piList.filter((s) => pathsEqual(s.cwd, normalized))
      : piList;
    const piRefs = new Map<string, SessionRef>();
    for (const s of byCwdFromPi) {
      piRefs.set(s.sessionId, {
        sessionId: s.sessionId,
        sessionFile: s.sessionFile,
        cwd: s.cwd,
        name: s.title ?? undefined,
      });
    }
    // 交叉补 SessionStore（避免 pi 原生 session 被移动/改名还能查到我们自己记录过的）
    try {
      for (const stored of this.store.listAll()) {
        if (normalized && !pathsEqual(stored.cwd, normalized)) continue;
        if (piRefs.has(stored.sessionId)) continue;
        piRefs.set(stored.sessionId, {
          sessionId: stored.sessionId,
          sessionFile: stored.sessionFile ?? '',
          cwd: stored.cwd,
          name: undefined,
        });
      }
    } catch {
      /* ignore */
    }
    const refs = Array.from(piRefs.values());
    // 按最近更新排序（优先 transcript JSONL mtime > store.updatedAt）
    refs.sort((a, b) => {
      const ma = statMtimeMs(getTranscriptJsonlPath(a.sessionId));
      const mb = statMtimeMs(getTranscriptJsonlPath(b.sessionId));
      if (ma !== mb) return mb - ma;
      return 0;
    });
    return refs;
  }

  /** 打开历史会话（支持传 sessionFile 或 sessionId），把磁盘 JSONL 回放进 transcriptCache + sessionMeta 恢复上下文 */
  async openSession(sessionFileOrSessionId: string): Promise<SessionRef> {
    ensureTranscriptsDir();
    const resolved = this.resolveSessionRef(sessionFileOrSessionId);
    if (!resolved) throw new Error(`Session not found: ${sessionFileOrSessionId}`);
    const { sessionId, sessionFile, cwd } = resolved;
    // 1. 回放 transcript
    this.hydrateSessionFromDisk(sessionId);
    // 2. 恢复 sessionMeta（needsName=false，因为是历史会话）
    const existing = this.sessionMeta.get(sessionId);
    this.sessionMeta.set(sessionId, {
      sessionFile: existing?.sessionFile ?? sessionFile ?? '',
      cwd: existing?.cwd ?? cwd,
      title: existing?.title ?? resolved?.name,
      needsName: false,
    });
    // 3. 让 piAgent 内部也有这个 session（若还没）——best-effort
    try {
      if (this.piAgent && sessionFile && fs.existsSync(sessionFile)) {
        const anyAgent = this.piAgent as any;
        if (typeof anyAgent?.sessions?.maybeGet === 'function' && !anyAgent.sessions.maybeGet(sessionId)) {
          if (typeof anyAgent?.sessions?.resumeFromSessionFile === 'function') {
            await anyAgent.sessions.resumeFromSessionFile(sessionFile).catch(() => null);
          } else if (typeof anyAgent?.sessions?.open === 'function') {
            await anyAgent.sessions.open(sessionId, sessionFile).catch(() => null);
          }
        }
      }
    } catch {
      /* ignore */
    }
    this.markAccess(sessionId);
    this.evictLruIfNeeded();
    return {
      sessionId,
      sessionFile: sessionFile ?? '',
      cwd,
      name: resolved?.name,
    };
  }

  dispose(): void {
    try {
      this.piAgent?.dispose?.();
    } catch {
      /* ignore */
    }
    this.piAgent = undefined;
    this.conn = undefined;
    this.transcriptCache.clear();
    this.transcriptLastAccess.clear();
    this.sessionMeta.clear();
    this.assistantAccumulator.clear();
    this.toolCallCache.clear();
    this.currentRoundId.clear();
    this.currentPhaseId.clear();
  }

  private markAccess(sessionId: string): void {
    this.transcriptLastAccess.set(sessionId, Date.now());
  }

  private evictLruIfNeeded(): void {
    if (this.transcriptCache.size <= MAX_INMEMORY_SESSIONS) return;
    const entries = Array.from(this.transcriptCache.keys())
      .map((sid) => ({ sid, t: this.transcriptLastAccess.get(sid) ?? 0 }))
      .sort((a, b) => a.t - b.t);
    const toDelete = entries.slice(0, Math.max(1, entries.length - MAX_INMEMORY_SESSIONS));
    for (const { sid } of toDelete) {
      // ⚠️ 只清内存缓存，不清磁盘 JSONL（下次 openSession 还能 hydrate）
      this.transcriptCache.delete(sid);
      this.transcriptLastAccess.delete(sid);
    }
  }

  private appendTranscriptLine(sessionId: string, obj: Record<string, unknown>): void {
    try {
      ensureTranscriptsDir();
      const p = getTranscriptJsonlPath(sessionId);
      fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
    } catch (e: any) {
      diagLog(TAG, `appendTranscriptLine FAIL sessionId=${sessionId}: ${e?.message ?? String(e)}`);
    }
  }

  /** 把 agent-studio-transcripts/${sessionId}.jsonl 逐行回放进 transcriptCache */
  private hydrateSessionFromDisk(sessionId: string): SessionTranscriptItem[] {
    ensureTranscriptsDir();
    const p = getTranscriptJsonlPath(sessionId);
    const inMemory: SessionTranscriptItem[] = [];
    if (!fs.existsSync(p)) {
      this.transcriptCache.set(sessionId, inMemory);
      this.markAccess(sessionId);
      return inMemory;
    }
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (const line0 of lines) {
        const line = line0.trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as any;
          if (obj && typeof obj === 'object' && obj[TRANSCRIPT_LINE_MARKER_UPDATE] === true && typeof obj?.id === 'string') {
            // update marker line：按 id 找最后一次出现的 item，Object.assign 合并
            const patch = obj.value;
            if (patch && typeof patch === 'object') {
              for (let i = inMemory.length - 1; i >= 0; i--) {
                if (inMemory[i].id === String(obj.id)) {
                  inMemory[i] = { ...inMemory[i], ...(patch as SessionTranscriptItem) };
                  break;
                }
              }
            }
          } else if (obj && typeof obj === 'object' && typeof obj.type === 'string' && typeof obj.id === 'string') {
            inMemory.push(obj as SessionTranscriptItem);
          } else {
            // unknown line: ignore
          }
        } catch {
          // ignore single bad line
        }
      }
    } catch (e: any) {
      diagLog(TAG, `hydrateSessionFromDisk FAIL sessionId=${sessionId}: ${e?.message ?? String(e)}`);
    }
    this.transcriptCache.set(sessionId, inMemory);
    this.markAccess(sessionId);
    return inMemory;
  }

  /** 支持两种输入：真实 sessionFile 路径，或直接 sessionId；找不到返回 null */
  private resolveSessionRef(input: string): (SessionRef & { sessionId: string; sessionFile: string; cwd: string; name?: string }) | null {
    if (!input) return null;
    const trimmed = input.trim();
    // 1. 纯 sessionId（36 位 UUID 或不含路径分隔符）
    if (!trimmed.includes('/') && !trimmed.includes('\\')) {
      const piFind = findPiSession(trimmed);
      if (piFind) return { sessionId: piFind.sessionId, sessionFile: piFind.sessionFile, cwd: piFind.cwd, name: piFind.title ?? undefined };
      const stored = this.store.get(trimmed);
      if (stored) return { sessionId: stored.sessionId, sessionFile: stored.sessionFile ?? '', cwd: stored.cwd };
      if (fs.existsSync(getTranscriptJsonlPath(trimmed))) return { sessionId: trimmed, sessionFile: '', cwd: '' };
    }
    // 2. sessionFile 路径（绝对路径，可能存在于磁盘）
    const piAll = safeListPiSessions();
    const byFile = piAll.find((s) => s.sessionFile === trimmed || pathsEqual(s.sessionFile, trimmed));
    if (byFile) return { sessionId: byFile.sessionId, sessionFile: byFile.sessionFile, cwd: byFile.cwd, name: byFile.title ?? undefined };
    // 3. Store listAll 反查
    for (const stored of this.store.listAll()) {
      if (stored.sessionFile && (stored.sessionFile === trimmed || pathsEqual(stored.sessionFile, trimmed))) {
        return { sessionId: stored.sessionId, sessionFile: stored.sessionFile ?? '', cwd: stored.cwd };
      }
      if (stored.sessionId === trimmed) {
        return { sessionId: stored.sessionId, sessionFile: stored.sessionFile ?? '', cwd: stored.cwd };
      }
    }
    return null;
  }

  async listModelsFromConfig(modelsConfig: Record<string, any> | undefined): Promise<{ providerId: string; modelId: string; label?: string }[]> {
    const result: { providerId: string; modelId: string; label?: string }[] = [];
    if (!modelsConfig) return result;
    for (const [alias, model] of Object.entries(modelsConfig)) {
      const m = model as { provider?: string; modelId?: string; enabled?: boolean };
      if (m.enabled === false) continue;
      if (m.provider && m.modelId) {
        result.push({ providerId: m.provider, modelId: m.modelId, label: alias });
      }
    }
    return result;
  }

  async setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    if (!this.piAgent) throw new Error('AcpDriverBridge not initialized');
    const anyAgent = this.piAgent as any;
    if (typeof anyAgent.unstable_setSessionModel === 'function') {
      await anyAgent.unstable_setSessionModel({ sessionId, providerId, modelId });
    } else {
      const session = anyAgent.sessions?.maybeGet?.(sessionId);
      if (session?.proc?.setModel) {
        await session.proc.setModel(providerId, modelId);
      }
    }
    const meta = this.sessionMeta.get(sessionId);
    if (meta) {
      /* meta  */
    }
  }

  private appendTranscriptItem(sessionId: string, item: SessionTranscriptItem): void {
    let list = this.transcriptCache.get(sessionId);
    if (!list) {
      list = [];
      this.transcriptCache.set(sessionId, list);
    }
    list.push(item);
    this.markAccess(sessionId);
    this.appendTranscriptLine(sessionId, item as unknown as Record<string, unknown>);
    this.evictLruIfNeeded();
  }

  private handleAcpSessionUpdate(sessionId: string, update: schema.SessionUpdate): void {
    const u = update as any;
    const type = String(u?.sessionUpdate ?? '');
    try {
      const raw = JSON.stringify(update);
      if (type !== 'agent_message_chunk' && type !== 'tool_call_update') {
        diagLog(TAG, `sessionUpdate: sessionId=${sessionId} type=${type} json=${raw.slice(0, 600)}`);
      } else {
        diagLog(TAG, `sessionUpdate[${type}]: sessionId=${sessionId} json=${raw.slice(0, 400)}`);
      }
    } catch {
      diagLog(TAG, `sessionUpdate: sessionId=${sessionId} type=${type} (JSON stringify failed)`);
    }

    switch (type) {
      case 'user_message_chunk': {
        const text = this.extractTextFromContent(u.content);
        if (text) {
          const id = randomUUID();
          const { parentId, lastTs } = this.findNextParentAnchor(sessionId);
          this.ensureItemPresent(sessionId, {
            type: 'user',
            id,
            parentId,
            timestamp: lastTs ? Math.max(lastTs + 1, Date.now()) : Date.now(),
            content: text,
          }, 'user');
          this.eventHandler(sessionId, { type: 'entry_appended' });
        }
        break;
      }

      case 'agent_message_chunk': {
        const text = this.extractAnswerText(u.content);
        diagLog(TAG, `agent_message_chunk: extracted=${JSON.stringify(text ?? null).slice(0, 200)} content=${JSON.stringify(u.content ?? null).slice(0, 300)}`);
        if (text) {
          const accum = this.getOrCreateAccumulator(sessionId, u.messageId);
          accum.textParts.push(text);
          const fullText = accum.textParts.join('');
          const item: SessionTranscriptItem = {
            type: 'assistant',
            id: accum.id,
            parentId: accum.parentId,
            timestamp: accum.timestamp,
            content: fullText,
          };
          this.ensureItemPresent(sessionId, item, 'assistant');
          this.eventHandler(sessionId, { type: 'entry_appended' });
        }
        break;
      }

      case 'agent_thought_chunk': {
        const text = this.extractThinkingText(u.content);
        if (text) {
          const accum = this.getOrCreateAccumulator(sessionId, u.messageId);
          accum.thinkingParts.push(text);
          const fullThinking = accum.thinkingParts.join('');
          const item: SessionTranscriptItem = {
            type: 'thinking',
            id: `thinking-${accum.id}`,
            parentId: accum.parentId,
            timestamp: accum.timestamp,
            content: fullThinking,
          };
          this.ensureItemPresent(sessionId, item, 'thinking');
          this.eventHandler(sessionId, { type: 'entry_appended' });
        }
        break;
      }

      case 'tool_call': {
        const toolCallId = String(u.toolCallId ?? '');
        const toolName = String(u.name ?? (u.kind ?? 'tool'));
        const toolTitle = String(u.title ?? toolName);
        const toolKind = String(u.kind ?? 'execute');
        const toolStatus = String(u.status ?? 'pending');
        const locations = Array.isArray(u.locations) ? u.locations : [];
        if (!toolCallId) break;
        const cacheKey = `${sessionId}:${toolCallId}`;
        if (!this.toolCallCache.has(cacheKey)) {
          const id = randomUUID();
          const { parentId, lastTs } = this.findNextParentAnchor(sessionId);
          this.toolCallCache.set(cacheKey, {
            id,
            toolCallId,
            tool: {
              name: toolName,
              title: toolTitle,
              kind: toolKind,
              status: toolStatus,
              input: u.rawInput as Record<string, unknown> | undefined,
              locations: locations.map((loc: any) => ({
                path: String(loc?.path ?? ''),
                range: loc?.range ?? undefined,
              })).filter((loc: any) => loc.path),
              contentText: this.extractToolResultText(u),
            },
            timestamp: lastTs ? Math.max(lastTs + 1, Date.now()) : Date.now(),
            parentId,
          });
        } else {
          const cached = this.toolCallCache.get(cacheKey)!;
          cached.tool.title = toolTitle || cached.tool.title;
          cached.tool.kind = toolKind || cached.tool.kind;
          cached.tool.status = toolStatus || cached.tool.status;
          if (u.rawInput !== undefined && u.rawInput !== null) cached.tool.input = u.rawInput;
          const newLocs = locations.map((loc: any) => ({
            path: String(loc?.path ?? ''),
            range: loc?.range ?? undefined,
          })).filter((loc: any) => loc.path);
          if (newLocs.length) cached.tool.locations = newLocs;
          const freshContent = this.extractToolResultText(u);
          if (freshContent) cached.tool.contentText = freshContent;
        }
        const cached = this.toolCallCache.get(cacheKey)!;
        const item: SessionTranscriptItem = {
          type: 'tool',
          id: cached.id,
          parentId: cached.parentId,
          timestamp: cached.timestamp,
          tool: { ...cached.tool },
        };
        this.ensureItemPresent(sessionId, item, 'tool');
        this.eventHandler(sessionId, { type: 'entry_appended' });
        // 任何 tool_call 初次写入：phase++ 保证后续 think/assistant 是独立 bubble
        this.bumpPhaseId(sessionId);
        break;
      }

      case 'tool_call_update': {
        const toolCallId = String(u.toolCallId ?? '');
        if (!toolCallId) break;
        const cacheKey = `${sessionId}:${toolCallId}`;
        const cached = this.toolCallCache.get(cacheKey);
        if (!cached) break;
        const status = String(u.status ?? cached.tool.status ?? '');
        const newTitle = String(u.title ?? '');
        const newKind = String(u.kind ?? '');
        const locations = Array.isArray(u.locations) ? u.locations : [];
        if (newTitle) cached.tool.title = newTitle;
        if (newKind) cached.tool.kind = newKind;
        if (status) cached.tool.status = status;
        const newLocs = locations.map((loc: any) => ({
          path: String(loc?.path ?? ''),
          range: loc?.range ?? undefined,
        })).filter((loc: any) => loc.path);
        if (newLocs.length) cached.tool.locations = newLocs;
        const contentText = this.extractToolResultText(u);
        const diffText = this.extractDiffText(u);
        if (u.rawOutput !== undefined && u.rawOutput !== null) {
          cached.tool.result = u.rawOutput;
        }
        if (contentText && cached.tool.result === undefined) {
          cached.tool.result = contentText;
        }
        if (contentText) cached.tool.contentText = contentText;
        if (diffText) cached.tool.diffText = diffText;
        if (status === 'failed') {
          cached.tool.error = contentText || 'tool failed';
        }
        const item: SessionTranscriptItem = {
          type: 'tool',
          id: cached.id,
          parentId: cached.parentId,
          timestamp: cached.timestamp,
          tool: { ...cached.tool },
        };
        this.ensureItemPresent(sessionId, item, 'tool');
        this.eventHandler(sessionId, { type: 'entry_appended' });
        // tool_call_update 每次触发：phase++ 保证后续 think/assistant 是新 bubble（不会回写旧 think/content）
        this.bumpPhaseId(sessionId);
        break;
      }

      case 'session_info_update': {
        if (u.title) {
          const meta = this.sessionMeta.get(sessionId);
          if (meta) meta.title = u.title;
        }
        this.eventHandler(sessionId, { type: 'session_info_update', title: u.title, updatedAt: u.updatedAt });
        break;
      }

      case 'plan':
      case 'plan_update':
      case 'plan_removed': {
        const entries = Array.isArray(u.entries) ? u.entries : [];
        diagLog(TAG, `plan(${type}): sessionId=${sessionId} entries.len=${entries.length}`);
        const planId = `plan-${type}-${sessionId}`;
        const { parentId: planParentId, lastTs: planLastTs } = this.findNextParentAnchor(sessionId);
        const item: SessionTranscriptItem = {
          type: 'plan',
          id: planId,
          parentId: planParentId,
          timestamp: planLastTs ? Math.max(planLastTs + 1, Date.now()) : Date.now(),
          plan: {
            entries: entries.map((e: any) => ({
              content: String(e?.content ?? ''),
              status: String(e?.status ?? 'pending'),
              priority: e?.priority ?? undefined,
            })),
          },
        };
        this.ensureItemPresent(sessionId, item, 'tool');
        this.eventHandler(sessionId, { type: 'acp_update', subtype: type, payload: u });
        this.eventHandler(sessionId, { type: 'entry_appended' });
        // plan 更新后也 bump phase：后续 think/assistant 作为独立 bubble 追加在 plan 之后
        this.bumpPhaseId(sessionId);
        break;
      }

      case 'available_commands_update': {
        this.applyAvailableCommandsUpdate(sessionId, u);
        this.eventHandler(sessionId, { type: 'acp_update', subtype: type, payload: u });
        break;
      }
      case 'current_mode_update':
      case 'config_option_update':
      case 'usage_update': {
        this.eventHandler(sessionId, { type: 'acp_update', subtype: type, payload: u });
        break;
      }

      default: {
        diagLog(TAG, `[UNHANDLED sessionUpdate] sessionId=${sessionId} type=${type} json=${JSON.stringify(u ?? null).slice(0, 500)}`);
        this.eventHandler(sessionId, { type: 'acp_update', subtype: type, payload: u });
        break;
      }
    }
  }

  private getOrCreateAccumulator(sessionId: string, messageId?: string | null): AssistantAccumulator {
    // ⬇⬇⬇ 核心修复：accumulator key = sessionId + currentRoundId + currentPhaseId
    // - 每轮 prompt 必换 roundId（跨轮不共享 accum）
    // - 每触发一次 tool/plan 事件，必 bump phaseId（同轮内跨阶段不共享 accum）
    // → 效果：think A → tool → think B → answer 会各自生成独立的 thinking/assistant bubble
    //   紧挨着从上往下追加，而不是回写到旧 bubble 的 content 尾部。
    const roundId = this.currentRoundId.get(sessionId) ?? 'round-0';
    const phaseId = this.currentPhaseId.get(sessionId) ?? 0;
    const mid = messageId && messageId !== 'default' ? String(messageId) : `r:${roundId}:p:${phaseId}`;
    const key = `${sessionId}:${roundId}:${phaseId}:${mid}`;
    let acc = this.assistantAccumulator.get(key);
    if (!acc) {
      const id = messageId && messageId !== 'default'
        ? String(messageId)
        : `${roundId}-${phaseId}`;
      const { parentId, lastTs } = this.findNextParentAnchor(sessionId);
      acc = {
        id,
        parentId,
        textParts: [],
        thinkingParts: [],
        timestamp: lastTs ? Math.max(lastTs + 1, Date.now()) : Date.now(),
      };
      this.assistantAccumulator.set(key, acc);
    }
    return acc;
  }

  private bumpPhaseId(sessionId: string): void {
    const next = (this.currentPhaseId.get(sessionId) ?? 0) + 1;
    this.currentPhaseId.set(sessionId, next);
  }

  private ensureItemPresent(
    sessionId: string,
    item: SessionTranscriptItem,
    _kind: 'assistant' | 'thinking' | 'tool' | 'user'
  ): void {
    let list = this.transcriptCache.get(sessionId);
    if (!list) {
      list = [];
      this.transcriptCache.set(sessionId, list);
      this.transcriptNextSeq.set(sessionId, 0);
    }
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) {
      const prevSeq = typeof list[idx].internalSeq === 'number' ? list[idx].internalSeq : undefined;
      list[idx] = { ...item, internalSeq: prevSeq ?? (this.transcriptNextSeq.get(sessionId) ?? 0) };
      if (prevSeq === undefined) {
        const next = (this.transcriptNextSeq.get(sessionId) ?? 0) + 1;
        this.transcriptNextSeq.set(sessionId, next);
      }
      // ⬇⬇⬇ 追加 update marker line（JSONL append-only，不重写文件）
      this.appendTranscriptLine(sessionId, {
        [TRANSCRIPT_LINE_MARKER_UPDATE]: true,
        id: String(item.id),
        value: item as unknown as Record<string, unknown>,
        _ts: Date.now(),
      } as unknown as Record<string, unknown>);
    } else {
      const next = this.transcriptNextSeq.get(sessionId) ?? 0;
      const withSeq: SessionTranscriptItem = { ...item, internalSeq: next };
      list.push(withSeq);
      this.transcriptNextSeq.set(sessionId, next + 1);
      this.appendTranscriptLine(sessionId, item as unknown as Record<string, unknown>);
    }
    this.markAccess(sessionId);
    this.evictLruIfNeeded();
  }

  private extractAnswerText(content: unknown): string {
    if (!content || typeof content !== 'object') return '';
    const c = content as any;
    // 优先从结构化 content blocks 里拿「仅正文块」，跳过 reasoning/thinking 块
    if (Array.isArray(c)) {
      return c
        .map((block: any) => {
          if (!block || typeof block !== 'object') return '';
          const b = block as any;
          const bType = String(b.type ?? b.kind ?? b.mimeType ?? '').toLowerCase();
          if (bType.includes('reason') || bType.includes('think')) return '';
          if (typeof b.text === 'string') return b.text;
          return '';
        })
        .filter(Boolean)
        .join('');
    }
    // 单块 object：先判断是否 reasoning 块，如果是就跳过不返回正文
    const contentType = String(c.type ?? c.kind ?? c.mimeType ?? '').toLowerCase();
    if (contentType.includes('reason') || contentType.includes('think')) return '';
    if (typeof c.text === 'string') return c.text;
    return '';
  }

  private extractThinkingText(content: unknown): string {
    if (!content || typeof content !== 'object') return '';
    const c = content as any;
    if (Array.isArray(c)) {
      return c
        .map((block: any) => {
          if (!block || typeof block !== 'object') return '';
          const b = block as any;
          const bType = String(b.type ?? b.kind ?? b.mimeType ?? '').toLowerCase();
          // 仅 reasoning/thinking 块被当作 think 内容；普通 text 块不出现在 think 区域
          if (bType.includes('reason') || bType.includes('think')) {
            return typeof b.text === 'string' ? b.text : '';
          }
          // 如果块完全没有类型信息但整包就是 thought_chunk，也全量收下（退化兜底）
          if (typeof b.text === 'string' && !bType) return b.text;
          return '';
        })
        .filter(Boolean)
        .join('');
    }
    const contentType = String(c.type ?? c.kind ?? c.mimeType ?? '').toLowerCase();
    if (typeof c.text === 'string') {
      // 有明确 type=reason/think 才收下；否则不返回（避免正文串进 think 区域）
      if (!contentType || contentType.includes('reason') || contentType.includes('think')) return c.text;
      return '';
    }
    return '';
  }

  private extractTextFromContent(content: unknown): string {
    // 保留给 user_message_chunk 等不区分 reasoning/text 的路径
    if (!content || typeof content !== 'object') return '';
    const c = content as any;
    if (typeof c.text === 'string') return c.text;
    if (Array.isArray(c)) {
      return c
        .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('');
    }
    return '';
  }

  private extractToolResultText(u: any): string {
    if (!u) return '';
    const content = u.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((block: any) => {
          if (block?.type === 'content' && typeof block.content?.text === 'string') return block.content.text;
          if (block?.type === 'diff') {
            const pieces: string[] = [];
            if (typeof block.oldText === 'string') pieces.push(`--- old:${block.path ?? ''}`);
            if (typeof block.newText === 'string') pieces.push(`+++ new:${block.path ?? ''}`);
            return pieces.join('\n');
          }
          if (typeof block?.content?.text === 'string') return block.content.text;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  private extractDiffText(u: any): string {
    if (!u) return '';
    const content = u.content;
    if (!Array.isArray(content)) return '';
    const parts: string[] = [];
    for (const block of content) {
      if (!block) continue;
      if (typeof block.diff === 'string') {
        parts.push(block.diff);
      } else if (typeof block.newText === 'string' || typeof block.oldText === 'string') {
        // fallback: unified-diff style
        const o = (typeof block.oldText === 'string' ? block.oldText : '').split('\n');
        const n = (typeof block.newText === 'string' ? block.newText : '').split('\n');
        const hunk: string[] = [];
        const maxL = Math.max(o.length, n.length);
        for (let i = 0; i < maxL; i++) {
          const ol = o[i];
          const nl = n[i];
          if (ol !== undefined && nl !== undefined && ol === nl) hunk.push(` ${ol}`);
          else {
            if (ol !== undefined) hunk.push(`-${ol}`);
            if (nl !== undefined) hunk.push(`+${nl}`);
          }
        }
        if (hunk.length) {
          parts.push(`--- a/${block.path ?? ''}\n+++ b/${block.path ?? ''}\n@@ @@\n${hunk.join('\n')}`);
        }
      }
    }
    return parts.join('\n\n');
  }
}
