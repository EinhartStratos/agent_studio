export interface SessionRef {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  name?: string;
}

export interface TranscriptItem {
  type: 'user' | 'assistant' | 'tool' | 'system' | 'compact' | 'branch' | 'model' | 'thinking' | 'custom' | 'error';
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

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

export interface DriverHealth {
  ok: boolean;
  packageVersion?: string;
  runtimeReady: boolean;
  currentModel?: string;
  error?: string;
}

export interface ModelInfo {
  providerId: string;
  modelId: string;
  label?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
  enabled: boolean;
  disableModelInvocation: boolean;
  slashCommand: string;
}
