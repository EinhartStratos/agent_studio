/** 会话引用 */
export interface SessionRef {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  name?: string;
}

/** 用户输入 */
export interface UserMessageInput {
  text: string;
  images?: Array<{ data: string; mediaType?: string }>;
}

/** 会话树节点 */
export interface SessionNode {
  id: string;
  parentId?: string | null;
  type: string;
  label?: string;
  children: SessionNode[];
}

/** 文件树节点 */
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

/** 转录项 */
export interface SessionTranscriptItem {
  type: 'user' | 'assistant' | 'tool' | 'system' | 'compact' | 'branch' | 'model' | 'thinking' | 'custom' | 'error' | 'plan';
  id: string;
  parentId?: string | null;
  timestamp: number;
  content?: string;
  tool?: {
    name: string;
    title?: string;
    kind?: string;
    status?: string;
    locations?: Array<{ path: string; range?: unknown }>;
    input?: Record<string, unknown>;
    contentText?: string;
    diffText?: string;
    result?: unknown;
    error?: string;
  };
  plan?: {
    entries: Array<{ content: string; status: string; priority?: unknown }>;
  };
  details?: unknown;
}

/** 驱动健康状态 */
export interface DriverHealth {
  ok: boolean;
  packageVersion?: string;
  runtimeReady: boolean;
  currentModel?: string;
  error?: string;
}

/** 智能体模板：智能体市场里的预设智能体 */
export interface AgentTemplate {
  id: string;
  name: string;
  /** emoji 用作 icon，优先展示 */
  emoji?: string;
  /** 图片 URL（可选） */
  iconUrl?: string;
  description: string;
  /** 启动后自动注入的 skills（按 skill name） */
  presetSkillNames: string[];
  /** 可选：长期 system prompt（每轮 prompt 前注入） */
  systemPrompt?: string;
}

/** Skill 摘要 */
export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  /** user / project / acp / temporary */
  source: string;
  enabled: boolean;
  disableModelInvocation: boolean;
  /** slash 命令形式：/skill:xxx */
  slashCommand: string;
}
