export interface SessionRef {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  name?: string;
}

export interface TranscriptItem {
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

export interface AgentTemplate {
  id: string;
  name: string;
  emoji?: string;
  iconUrl?: string;
  description: string;
  presetSkillNames: string[];
  systemPrompt?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export interface Project {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  path?: string;
}

export interface Task {
  id: string;
  title: string;
  sub: string;
  mode: 'simple' | 'agent';
}
