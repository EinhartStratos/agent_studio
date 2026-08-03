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

/**
 * 从自有 transcript JSONL 文件中**轻量扫描**（最多前 N 行）首个干净的 user 消息作为会话标题。
 * 不依赖 pi 原生 listPiSessions 返回的 title，因为发给 pi 的 prompt 拼接了 AgentTemplate System Prompt，
 * pi 内部据此生成的 title 会把 System Prompt 当作用户输入显示。
 *
 * 设计原则：只读 JSONL「头 40 行 + 尾 40 行」避免对长历史文件做全量 IO；
 * 跳过所有带 __u:true 的增量更新行以及非 user 类型；
 * 截取首 36 字（中文单字宽度），去掉首尾空白与换行。
 */
function guessTitleFromTranscriptJsonl(sessionId: string): string | undefined {
  const p = getTranscriptJsonlPath(sessionId);
  if (!fs.existsSync(p)) return undefined;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw) return undefined;
    const all = raw.split(/\r?\n/);
    const HEAD_LIMIT = 40;
    const TAIL_LIMIT = 40;
    let scanLines: string[];
    if (all.length <= HEAD_LIMIT + TAIL_LIMIT) {
      scanLines = all;
    } else {
      scanLines = [...all.slice(0, HEAD_LIMIT), ...all.slice(all.length - TAIL_LIMIT)];
    }
    // 按写入顺序保留，HEAD 部分永远在前
    for (const line of scanLines) {
      if (!line) continue;
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed[TRANSCRIPT_LINE_MARKER_UPDATE] === true) continue; // 跳过增量更新行
      if (parsed.type !== 'user') continue;
      const content = typeof parsed.content === 'string' ? String(parsed.content) : '';
      const trimmed = content.replace(/\s+/g, ' ').trim();
      if (!trimmed) continue;
      return trimmed.length > 36 ? `${trimmed.slice(0, 36)}…` : trimmed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

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
    return { contents: '' } as unknown as schema.ReadTextFileResponse;
  }

  async writeTextFile(_params: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse> {
    return {} as unknown as schema.WriteTextFileResponse;
  }

  async createTerminal(
    _params: schema.CreateTerminalRequest
  ): Promise<any> {
    return {
      terminalId: randomUUID(),
      output: ''
    };
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
  /** openSession 期间的临时 loading flag：用于跳过 pi-acp 内部回放事件，避免与自有 JSONL 回放重复 */
  private readonly _loadingSessionIds = new Set<string>();

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
    const session = (this.piAgent as any).sessions?.maybeGet(sessionId);
    const proc = session?.proc ?? null;

    // 1. 会话文件快速定位（同步 + 低开销，优先走 store/findPiSession，避免额外 RPC）
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

    // 2. 强制把模型切换到配置里指定的 (providerId, modelId)，避免 pi 默认模型错配
    //    ⚠️ 关键优化：setModel 和 诊断 RPC 放在后台异步执行，不阻塞 ref 返回给用户——
    //       因为会话 ref 已经可以用了（sessionId / cwd 都在 newSession 时就拿到了），
    //       模型切换 + 诊断是"尽量做"的副作用，不影响前端立即进入新会话。
    let afterState: any = null;
    if (this.forcedModel) {
      const currentModelId: string | null | undefined = (resp as any)?.models?.currentModelId ?? null;
      diagLog(TAG, `createSession: piAcp reported currentModelId=${currentModelId} setting forced ${this.forcedModel.providerId}/${this.forcedModel.modelId} (background)...`);
      // 后台执行模型切换，完成后再打 diagLog
      (async () => {
        try {
          if (typeof (this.piAgent as any).unstable_setSessionModel === 'function') {
            await (this.piAgent as any).unstable_setSessionModel({ sessionId, providerId: this.forcedModel.providerId, modelId: this.forcedModel.modelId });
          } else if (proc?.setModel) {
            await proc.setModel(this.forcedModel.providerId, this.forcedModel.modelId);
          }
          const st: any = proc?.getState ? await proc.getState().catch(() => null) : null;
          if (st?.sessionFile && !sessionFile) {
            sessionFile = st.sessionFile;
            this.store.upsert({ sessionId, cwd: workspacePath, sessionFile });
          }
          diagLog(TAG, `createSession: after setModel (bg), state.model = ${JSON.stringify(st?.model ?? '(unknown)')}`);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          console.warn(`[${TAG}] createSession: setModel warning (non-fatal, bg): ${msg}`);
          diagLog(TAG, `createSession: setModel warning (non-fatal, bg): ${msg}`);
        }
      })().catch(() => null);
    }

    // 3. 额外诊断日志：availableModels + getState —— 永远后台执行，绝不阻塞 ref 返回
    if (proc) {
      (async () => {
        try {
          const [aModels, st] = await Promise.all([
            proc.getAvailableModels?.().catch(() => null),
            proc.getState?.().catch(() => null),
          ]);
          if (st?.sessionFile && !sessionFile) {
            sessionFile = st.sessionFile;
            this.store.upsert({ sessionId, cwd: workspacePath, sessionFile });
          }
          diagLog(TAG, `createSession: (bg) pi.getAvailableModels.models = ${JSON.stringify(Array.isArray((aModels as any)?.models) ? (aModels as any).models.map((m: any) => ({provider: m.provider, id: m.id, name: m.name})) : aModels).slice(0, 800)}`);
          diagLog(TAG, `createSession: (bg) pi.getState().model = ${JSON.stringify((st as any)?.model ?? null)}  cost=${JSON.stringify((st as any)?.cost ?? null)}  sessionFile=${(st as any)?.sessionFile ?? ''}`);
        } catch { /* non-fatal */ }
      })().catch(() => null);
    }

    // 4. 如果同步路径没拿到 sessionFile，尝试用 setModel 之前已经拿到的 afterState（不再 await 新 RPC）——
    //    这里不再额外调 getState，把任何可能阻塞的 RPC 留给后台任务补；仍拿不到就允许 sessionFile 为空（自有 transcript JSONL 不依赖它）
    void afterState;

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

  /** 已应用 forcedModel 的会话集合，用于跳过幂等 setModel 二次调用的开销 */
  private readonly _forcedModelAppliedSessions = new Set<string>();

  async prompt(sessionId: string, input: UserMessageInput): Promise<void> {
    if (!this.piAgent) throw new Error('AcpDriverBridge not initialized');
    const meta = this.sessionMeta.get(sessionId);
    if (!meta) throw new Error(`Unknown session: ${sessionId}`);
    diagLog(TAG, `prompt: sessionId=${sessionId} textLength=${(input.text ?? '').length}`);

    // ⚠️ createSession 把 unstable_setSessionModel 放到后台异步执行了（为了让新建会话立即返回）。
    // 这里做兜底：第一次进入某会话的 prompt 时，若有 forcedModel 且标记未应用，则 await 一次强制切模型。
    // 注意：unstable_setSessionModel 本身是幂等的——后台已切完则极快 return；没切完则阻塞到切完再发 prompt，保证首条消息绝不会跑在错误的默认模型上。
    if (this.forcedModel && !this._forcedModelAppliedSessions.has(sessionId)) {
      try {
        const t0 = Date.now();
        if (typeof (this.piAgent as any).unstable_setSessionModel === 'function') {
          await (this.piAgent as any).unstable_setSessionModel({
            sessionId,
            providerId: this.forcedModel.providerId,
            modelId: this.forcedModel.modelId,
          });
        } else {
          const proc = (this.piAgent as any).sessions?.maybeGet(sessionId)?.proc;
          if (proc?.setModel) await proc.setModel(this.forcedModel.providerId, this.forcedModel.modelId);
        }
        diagLog(TAG, `prompt: ensure model ${this.forcedModel.providerId}/${this.forcedModel.modelId} took=${Date.now() - t0}ms`);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.warn(`[${TAG}] prompt: ensure setModel warning: ${msg}`);
        diagLog(TAG, `prompt: ensure setModel warning: ${msg}`);
      } finally {
        this._forcedModelAppliedSessions.add(sessionId);
      }
    }

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

    const promptBlocks: schema.ContentBlock[] = [{ type: 'text', text }];
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
    this._forcedModelAppliedSessions.delete(sessionId);
    this._loadingSessionIds.delete(sessionId);
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

  /** 删除会话（按文档 §2.9：删 pi JSONL session file + pi-acp 映射 + 自有 transcript JSONL；幂等） */
  async deleteSession(sessionId: string): Promise<void> {
    diagLog(TAG, `deleteSession: sessionId=${sessionId}`);
    // 1. 先 close，确保 pi 进程不再持有该 session 文件
    this.closeSession(sessionId);
    // 2. 调用 pi-acp 标准 deleteSession（删除 pi 原生 JSONL + SessionStore 映射）
    try {
      if (this.piAgent && typeof (this.piAgent as any).deleteSession === 'function') {
        await (this.piAgent as any).deleteSession({ sessionId } as schema.DeleteSessionRequest);
      }
    } catch (e: any) {
      diagLog(TAG, `deleteSession: piAgent.deleteSession warning (non-fatal): ${e?.message ?? String(e)}`);
    }
    // 3. 删除自有 transcript JSONL（Agent Studio 自己写的那份）
    try {
      ensureTranscriptsDir();
      const p = getTranscriptJsonlPath(sessionId);
      if (fs.existsSync(p)) {
        (fs as any).unlinkSync?.(p);
        diagLog(TAG, `deleteSession: removed transcript JSONL: ${p}`);
      }
    } catch (e: any) {
      diagLog(TAG, `deleteSession: remove transcript JSONL warning (non-fatal): ${e?.message ?? String(e)}`);
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
    // ⬇⬇⬇ 关键：不盲目信任 pi 原生 title（可能把 System Prompt 当标题）
    // 优先使用自有 transcript JSONL 提取的首个干净 user 消息作为 name
    for (const ref of refs) {
      const guessed = guessTitleFromTranscriptJsonl(ref.sessionId);
      if (guessed) {
        ref.name = guessed;
        // 同步到 sessionMeta（如果已在内存里），确保后续 listSessions / openSession 一致
        const meta = this.sessionMeta.get(ref.sessionId);
        if (meta && !meta.title) meta.title = guessed;
      }
    }
    return refs;
  }

  /** 打开历史会话（支持传 sessionFile 或 sessionId），把磁盘 JSONL 回放进 transcriptCache + sessionMeta 恢复上下文 */
  async openSession(sessionFileOrSessionId: string): Promise<SessionRef> {
    ensureTranscriptsDir();
    const resolved = this.resolveSessionRef(sessionFileOrSessionId);
    if (!resolved) throw new Error(`Session not found: ${sessionFileOrSessionId}`);
    const { sessionId, sessionFile, cwd } = resolved;
    // 1. 回放自有 JSONL transcript（含 internalSeq、update marker 合并，信息比 pi 原生回放更完整）
    this.hydrateSessionFromDisk(sessionId);
    // 2. 恢复 sessionMeta（needsName=false，因为是历史会话）
    const existing = this.sessionMeta.get(sessionId);
    const finalCwd = (existing?.cwd && existing.cwd.length > 1) ? existing.cwd : cwd;
    const finalSessionFile = existing?.sessionFile ?? sessionFile ?? '';
    this.sessionMeta.set(sessionId, {
      sessionFile: finalSessionFile,
      cwd: finalCwd,
      title: existing?.title ?? resolved?.name,
      needsName: false,
    });
    // 3. 走标准 ACP loadSession：触发 closeAllExcept 清理旧进程 + 重发 available_commands_update 等
    //    期间置 loading flag，跳过 pi-acp 内部回放的 transcript 事件，避免和自有 JSONL 重复
    this._loadingSessionIds.add(sessionId);
    try {
      const isValidCwd = this.piAgent && finalCwd && typeof path.isAbsolute === 'function' && path.isAbsolute(finalCwd);
      if (isValidCwd) {
        try {
          await (this.piAgent as any).loadSession({
            sessionId,
            cwd: finalCwd,
            mcpServers: [],
          } as schema.LoadSessionRequest);
          diagLog(TAG, `openSession: piAgent.loadSession OK sessionId=${sessionId}`);
        } catch (loadErr: any) {
          const msg = loadErr?.message ?? String(loadErr);
          diagLog(TAG, `openSession: piAgent.loadSession FAILED (fallback) sessionId=${sessionId} err=${msg}`);
          // loadSession 失败时降级为老逻辑（best-effort 恢复 pi 内部状态）
          if (finalSessionFile && fs.existsSync(finalSessionFile)) {
            const anyAgent = this.piAgent as any;
            if (typeof anyAgent?.sessions?.maybeGet === 'function' && !anyAgent.sessions.maybeGet(sessionId)) {
              if (typeof anyAgent?.sessions?.resumeFromSessionFile === 'function') {
                await anyAgent.sessions.resumeFromSessionFile(finalSessionFile).catch(() => null);
              } else if (typeof anyAgent?.sessions?.open === 'function') {
                await anyAgent.sessions.open(sessionId, finalSessionFile).catch(() => null);
              }
            }
          }
        }
      } else if (this.piAgent && finalSessionFile && fs.existsSync(finalSessionFile)) {
        // cwd 为空或非绝对路径时，走老逻辑恢复（piAgent.loadSession 要求 cwd 为绝对路径）
        const anyAgent = this.piAgent as any;
        if (typeof anyAgent?.sessions?.maybeGet === 'function' && !anyAgent.sessions.maybeGet(sessionId)) {
          if (typeof anyAgent?.sessions?.resumeFromSessionFile === 'function') {
            await anyAgent.sessions.resumeFromSessionFile(finalSessionFile).catch(() => null);
          } else if (typeof anyAgent?.sessions?.open === 'function') {
            await anyAgent.sessions.open(sessionId, finalSessionFile).catch(() => null);
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      this._loadingSessionIds.delete(sessionId);
    }
    this.markAccess(sessionId);
    this.evictLruIfNeeded();
    return {
      sessionId,
      sessionFile: finalSessionFile,
      cwd: finalCwd,
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
      this.transcriptNextSeq.set(sessionId, 0);
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
                  const prevSeq = typeof (inMemory[i] as any).internalSeq === 'number'
                    ? (inMemory[i] as any).internalSeq as number
                    : undefined;
                  inMemory[i] = { ...inMemory[i], ...(patch as SessionTranscriptItem) };
                  if (prevSeq !== undefined && typeof (inMemory[i] as any).internalSeq !== 'number') {
                    (inMemory[i] as any).internalSeq = prevSeq;
                  }
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

    // ⬇⬇⬇ 关键修复：从磁盘回读的旧消息大概率没有 internalSeq（历史遗留 / 老版本写的 JSONL）。
    // 这里按 inMemory 原始顺序（等于磁盘写入顺序 = 真实时序）一次性补单调递增的 internalSeq，
    // 并把 transcriptNextSeq 同步成 inMemory.length，确保后续 ensureItemPresent 新增消息 seq 继续往后 +1，
    // 绝对不会出现『新消息 seq 从 0 开始 → 插到旧消息前面』的 bug。
    let maxSeq = -1;
    for (let i = 0; i < inMemory.length; i++) {
      const it = inMemory[i] as SessionTranscriptItem & { internalSeq?: number };
      const cur = typeof it.internalSeq === 'number' ? it.internalSeq : -1;
      if (cur >= 0) {
        if (cur > maxSeq) maxSeq = cur;
      } else {
        const assigned = Math.max(maxSeq + 1, i);
        it.internalSeq = assigned;
        maxSeq = assigned;
      }
    }
    this.transcriptNextSeq.set(sessionId, maxSeq + 1);

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

  /** 切换 Thinking Level（对应文档 §2.10 setSessionMode） */
  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    if (!this.piAgent) throw new Error('AcpDriverBridge not initialized');
    const anyAgent = this.piAgent as any;
    if (typeof anyAgent.setSessionMode === 'function') {
      await anyAgent.setSessionMode({ sessionId, modeId } as schema.SetSessionModeRequest);
      return;
    }
    const session = anyAgent.sessions?.maybeGet?.(sessionId);
    if (session?.proc?.setThinkingLevel) {
      await session.proc.setThinkingLevel(String(modeId));
      return;
    }
    throw new Error(`setSessionMode not available on pi-acp instance (modeId=${modeId})`);
  }

  /** 设置 Session Config Option（对应文档 §2.10 setSessionConfigOption；支持 model / thought_level） */
  async setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    if (!this.piAgent) throw new Error('AcpDriverBridge not initialized');
    const anyAgent = this.piAgent as any;
    if (typeof anyAgent.setSessionConfigOption === 'function') {
      await anyAgent.setSessionConfigOption({
        sessionId,
        configId,
        value,
      } as schema.SetSessionConfigOptionRequest);
      return;
    }
    const MODEL_CONFIG_ID = 'model';
    const THOUGHT_LEVEL_CONFIG_ID = 'thought_level';
    if (configId === THOUGHT_LEVEL_CONFIG_ID) {
      await this.setSessionMode(sessionId, value);
      return;
    }
    if (configId === MODEL_CONFIG_ID) {
      const slashIdx = String(value).indexOf('/');
      let providerId = '';
      let modelId = String(value);
      if (slashIdx > 0) {
        providerId = String(value).slice(0, slashIdx);
        modelId = String(value).slice(slashIdx + 1);
      }
      if (!providerId) {
        throw new Error(`setSessionConfigOption(model): value must be "provider/modelId" format, got: ${value}`);
      }
      await this.setSessionModel(sessionId, providerId, modelId);
      return;
    }
    throw new Error(`Unknown configId: ${configId}. Supported: ${MODEL_CONFIG_ID}, ${THOUGHT_LEVEL_CONFIG_ID}`);
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

    if (this._loadingSessionIds.has(sessionId)) {
      const replaySkipTypes = new Set([
        'user_message_chunk',
        'agent_message_chunk',
        'agent_thought_chunk',
        'tool_call',
        'tool_call_update',
        'plan',
        'plan_update',
        'plan_removed'
      ]);
      if (replaySkipTypes.has(type)) {
        diagLog(TAG, `sessionUpdate skipped during loadSession: sessionId=${sessionId} type=${type}`);
        return;
      }
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
        const meta = this.sessionMeta.get(sessionId);
        // ⬇⬇⬇ pi 原生 title 污染保护：pi 内部的第一条 user message 拼接了 System Prompt，生成的 title 会把 System Prompt 当用户输入
        // 防御策略：只要我们自己已经有 title（来自 ensureItemPresent 自动提取 / createSession 显式命名 / openSession 恢复），就永不被 pi 原生 title 覆盖
        let finalTitle: string | undefined = u.title;
        if (meta?.title && meta.needsName === false) {
          finalTitle = meta.title;
        } else if (u.title) {
          // 没有自有 title 时 fallback 到 pi 原生，但加一次可疑污染快速筛查：若 title 包含典型 System Prompt 开头特征，则拒绝接受
          const lower = String(u.title).toLowerCase();
          const looksSystemPrompt =
            lower.includes('你是一名') || lower.includes('你是一位') || lower.includes('you are a ') ||
            lower.includes('按如下结构') || lower.includes('核心目标') || lower.includes('\n1)') || lower.includes('\n1.');
          if (looksSystemPrompt) {
            const guessed = guessTitleFromTranscriptJsonl(sessionId);
            finalTitle = guessed ?? meta?.title;
            if (finalTitle && meta) meta.title = finalTitle;
          } else if (meta) {
            meta.title = u.title;
          }
        }
        if (meta && finalTitle && meta.needsName) meta.needsName = false;
        this.eventHandler(sessionId, {
          type: 'session_info_update',
          title: finalTitle,
          updatedAt: u.updatedAt ?? Date.now(),
        });
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
      // ⬇⬇⬇ 会话标题自动提取（对齐 SDK suggestAndSetName，这里不用 LLM，直接用首个干净 user 输入前 36 字）
      // 触发条件：首次插入 user 条目 + sessionMeta.needsName 为 true 或还没有 title
      if (item.type === 'user' && typeof item.content === 'string' && item.content.trim()) {
        const meta = this.sessionMeta.get(sessionId);
        if (meta && (!meta.title || meta.needsName)) {
          const trimmed = item.content.replace(/\s+/g, ' ').trim();
          const newTitle = trimmed.length > 36 ? `${trimmed.slice(0, 36)}…` : trimmed;
          if (newTitle && newTitle !== meta.title) {
            meta.title = newTitle;
            meta.needsName = false;
            this.eventHandler(sessionId, {
              type: 'session_info_update',
              title: newTitle,
              updatedAt: Date.now(),
            });
          }
        }
      }
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
