import type { AgentSession, ResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import type { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { SessionIndex } from './session-index';

/** 会话引用，渲染进程使用此对象标识一个会话 */
export interface SessionRef {
  /** 会话唯一 ID（UUID） */
  sessionId: string;
  /** 会话文件路径 */
  sessionFile: string;
  /** 工作区/当前目录 */
  cwd: string;
  /** 会话显示名称 */
  name?: string;
}

/** 用户输入内容 */
export interface UserMessageInput {
  text: string;
  images?: Array<{
    /** base64 编码的图片数据 */
    data: string;
    /** 图片类型，例如 image/png */
    mediaType?: string;
  }>;
  /** 当前对话选择的智能体 ID（来自智能体市场） */
  selectedAgentId?: string;
}

/** 时间线上的单条消息或事件 */
export interface SessionTranscriptItem {
  /** 条目类型 */
  type: 'user' | 'assistant' | 'tool' | 'system' | 'compact' | 'branch' | 'model' | 'thinking' | 'custom' | 'error' | 'plan';
  /** 条目 ID */
  id: string;
  /** 父节点 ID */
  parentId?: string | null;
  /** 时间戳 */
  timestamp: number;
  /** 文本内容 */
  content?: string;
  /** 工具调用结果 */
  tool?: ToolCallInfo;
  /** ACP 计划条目（sessionUpdate: plan / plan_update / plan_removed） */
  plan?: {
    entries: Array<{
      content: string;
      status: string;
      priority?: unknown;
    }>;
  };
  /** 自定义数据 */
  details?: unknown;
  /** 内部使用：保证同一 timestamp 下仍然按事件到达顺序稳定排序（仅内存字段，不落盘） */
  internalSeq?: number;
}

/** AgentTemplate：智能体市场里的智能体配置 */
export interface AgentTemplate {
  id: string;
  name: string;
  /** emoji 用作 icon，例如 '🧩' */
  emoji?: string;
  /** SVG 或图片 URL（可选，优先 emoji） */
  iconUrl?: string;
  description: string;
  /** 启动智能体时自动注入的 skills（按 skill name） */
  presetSkillNames: string[];
  /** 可选：长期 system prompt（自动拼在每轮 prompt 前） */
  systemPrompt?: string;
}

/** @deprecated 直接使用 AgentTemplate（保留命名兼容） */
export type AgentInfo = AgentTemplate;

/** 工具调用信息 */
export interface ToolCallInfo {
  /** 工具名 */
  name: string;
  /** ACP ToolCallUpdate.title（操作描述，展示用） */
  title?: string;
  /** ACP ToolCallUpdate.kind：read/edit/execute */
  kind?: string;
  /** ACP ToolCallUpdate/tool_call_update.status：pending/in_progress/completed/failed */
  status?: string;
  /** ACP ToolCallUpdate.locations：受影响的文件路径列表 */
  locations?: Array<{ path: string; range?: unknown }>;
  /** 调用参数 */
  input?: Record<string, unknown>;
  /** ACP content[].content.text / contentText 拼的完整输出（不含 diff） */
  contentText?: string;
  /** ACP content[].diff 拼的 unified diff 文本 */
  diffText?: string;
  /** 调用结果（rawOutput） */
  result?: unknown;
  /** 是否失败 */
  error?: string;
}

/** Skill 摘要 */
export interface SkillInfo {
  /** skill 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** skill 文件路径 */
  filePath: string;
  /** skill 所在目录 */
  baseDir: string;
  /** 来源：user / project / temporary */
  source: string;
  /** 是否已启用（可被模型调用） */
  enabled: boolean;
  /** 是否仅支持 slash 命令 */
  disableModelInvocation: boolean;
  /** slash 命令 */
  slashCommand: string;
}

/** 会话树节点 */
export interface SessionNode {
  id: string;
  parentId?: string | null;
  type: string;
  label?: string;
  children: SessionNode[];
}

/** 工作区文件树节点 */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

/** 工作区摘要 */
export interface WorkspaceSummary {
  path: string;
  name: string;
  sessions: SessionRef[];
}

/** Pi 运行时依赖 */
export interface RuntimeDependencies {
  /** 模型运行时（包含认证、模型注册表） */
  modelRuntime: ModelRuntime;
  /** 设置管理器 */
  settingsManager: SettingsManager;
  /** 会话索引（SQLite） */
  sessionIndex: SessionIndex;
  /** 当前选中的模型（对象类型内部使用，外部用 unknown） */
  currentModel?: unknown;
  /** Agent 目录（~/.pi/agent） */
  agentDir: string;
}

/** 会话包装：SessionManager + AgentSession */
export interface ActiveSession {
  ref: SessionRef;
  sessionManager: SessionManager;
  agentSession: AgentSession;
  /** 当前会话的资源加载器，用于获取 skills/prompts/themes */
  resourceLoader?: ResourceLoader;
  /** 事件监听器取消函数 */
  unsubscribe: () => void;
  /** 新会话是否需要自动命名 */
  needsName?: boolean;
}

/** 驱动健康状态 */
export interface DriverHealth {
  /** 是否可正常工作 */
  ok: boolean;
  /** 运行时代码版本 */
  packageVersion?: string;
  /** 模型运行时是否初始化 */
  runtimeReady: boolean;
  /** 当前默认模型 */
  currentModel?: string;
  /** 错误信息 */
  error?: string;
}
