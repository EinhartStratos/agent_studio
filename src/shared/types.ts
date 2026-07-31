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
  type: 'user' | 'assistant' | 'tool' | 'system' | 'compact' | 'branch' | 'model' | 'thinking' | 'custom';
  id: string;
  parentId?: string | null;
  timestamp: number;
  content?: string;
  tool?: {
    name: string;
    input?: Record<string, unknown>;
    result?: unknown;
    error?: string;
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
