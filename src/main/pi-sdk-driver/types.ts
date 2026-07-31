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
}

/** 时间线上的单条消息或事件 */
export interface SessionTranscriptItem {
  /** 条目类型 */
  type: 'user' | 'assistant' | 'tool' | 'system' | 'compact' | 'branch' | 'model' | 'thinking' | 'custom' | 'error';
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
  /** 自定义数据 */
  details?: unknown;
}

/** 工具调用信息 */
export interface ToolCallInfo {
  /** 工具名 */
  name: string;
  /** 调用参数 */
  input?: Record<string, unknown>;
  /** 调用结果 */
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
