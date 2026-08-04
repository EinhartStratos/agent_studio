import path from 'node:path';
import fs from 'node:fs';
import { app, ipcMain } from 'electron';
import AdmZip from 'adm-zip';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { MarketplaceAgent, MarketplaceCategory, UploadAgentRequest } from '../shared/types';
import { loadConfig } from './config';

const DEFAULT_CATEGORIES: MarketplaceCategory[] = [
  { id: 'all', label: '全部' },
  { id: 'dev', label: '开发工具' },
  { id: 'ui', label: '界面设计' },
  { id: 'content', label: '内容创作' },
  { id: 'efficiency', label: '效率提升' },
  { id: 'data', label: '数据分析' },
];

const CUSTOM_EMOJIS = ['📦', '⚡', '🌟', '💡', '🎯', '🛠️', '📚', '🔮', '🎪', '🚂'];

function getWorkspacePath(): string {
  const config = loadConfig();
  const configured = config.native?.defaultWorkspace?.trim();
  if (configured) {
    try {
      fs.mkdirSync(configured, { recursive: true });
      if (fs.existsSync(configured)) return configured;
    } catch {
      /* ignore */
    }
  }
  return app.getPath('userData');
}

function getAgentsDir(): string {
  const workspace = getWorkspacePath();
  const agentsDir = path.join(workspace, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  return agentsDir;
}

function getMetaPath(): string {
  return path.join(getAgentsDir(), 'agents-meta.json');
}

function readCustomAgents(): MarketplaceAgent[] {
  const metaPath = getMetaPath();
  if (!fs.existsSync(metaPath)) return [];
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[marketplace] Failed to read custom agents meta:', err);
    return [];
  }
}

function writeCustomAgents(agents: MarketplaceAgent[]): void {
  const metaPath = getMetaPath();
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(agents, null, 2), 'utf-8');
}

function findMarketplaceAgent(agentId: string): MarketplaceAgent | undefined {
  if (!agentId) return undefined;
  return readCustomAgents().find((agent) => agent.id === agentId);
}

function getMarketplaceAgentFilePath(agent: MarketplaceAgent): string | null {
  if (!agent.filePath) return null;
  const filePath = path.join(getAgentsDir(), agent.filePath);
  return fs.existsSync(filePath) ? filePath : null;
}

function stripFrontmatter(markdown: string): string {
  const raw = markdown.replace(/^\uFEFF/, '').trim();
  const fmMatch = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
}

function readSkillMarkdownFromArchive(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md') {
    const basename = path.basename(filePath).toLowerCase();
    if (basename === 'skill.md' || basename === 'skill') {
      return stripFrontmatter(fs.readFileSync(filePath, 'utf-8'));
    }
    return null;
  }

  if (ext === '.zip') {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntries().find((item) => {
      if (item.isDirectory) return false;
      const normalized = item.entryName.replace(/\\/g, '/').toLowerCase();
      return normalized === 'skill.md' || normalized.endsWith('/skill.md');
    });
    if (!entry) return null;
    return stripFrontmatter(zip.readAsText(entry, 'utf-8'));
  }

  return null;
}

export function getMarketplaceAgentSkillPrompt(agentId?: string): string | null {
  if (!agentId || agentId === 'simple') return null;
  const agent = findMarketplaceAgent(agentId);
  if (!agent) return null;
  const filePath = getMarketplaceAgentFilePath(agent);
  if (!filePath) return null;
  const skillMarkdown = readSkillMarkdownFromArchive(filePath);
  if (!skillMarkdown) return null;
  return [
    `你当前选择的智能体是「${agent.name}」。`,
    '以下内容来自该智能体附件中的 skill.md，请将其作为当前对话必须遵循的智能体技能说明来执行。',
    skillMarkdown,
  ].join('\n\n').trim();
}

function normalizeError(err: unknown): { ok: false; error: string } {
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, error: msg || 'Unknown error' };
}

function generateId(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '') || 'Agent';
  const timestamp = Date.now().toString(36);
  return `${base}_${timestamp}`;
}

function pickEmoji(seed: number): string {
  return CUSTOM_EMOJIS[seed % CUSTOM_EMOJIS.length];
}

export function registerMarketplaceIpc(): void {
  ipcMain.handle(IPC_CHANNELS.MARKETPLACE_GET_CATEGORIES, async () => {
    try {
      return { ok: true, categories: DEFAULT_CATEGORIES };
    } catch (err) {
      return normalizeError(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE_LIST_AGENTS, async () => {
    try {
      const customAgents = readCustomAgents();
      return { ok: true, agents: customAgents };
    } catch (err) {
      return normalizeError(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE_UPLOAD_AGENT, async (_event, request: UploadAgentRequest) => {
    try {
      const { name, description, category, fileName, fileData } = request;

      if (!name || !name.trim()) {
        return { ok: false, error: '智能体名称不能为空' };
      }
      if (!description || !description.trim()) {
        return { ok: false, error: '智能体描述不能为空' };
      }
      if (!category || category === 'all') {
        return { ok: false, error: '请选择有效的智能体分类' };
      }
      if (!fileName || !fileData) {
        return { ok: false, error: '请上传智能体文件' };
      }

      const agentsDir = getAgentsDir();
      const id = generateId(name);
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._\-\\u4e00-\\u9fa5]/g, '_');
      const fileBaseName = path.basename(safeFileName);
      const ext = path.extname(fileBaseName);
      const storedFileName = `${id}${ext || '.zip'}`;
      const storedFilePath = path.join(agentsDir, storedFileName);

      const buffer = Buffer.from(fileData, 'base64');
      fs.writeFileSync(storedFilePath, buffer);

      const customAgents = readCustomAgents();
      const newAgent: MarketplaceAgent = {
        id,
        name: name.trim(),
        emoji: pickEmoji(customAgents.length + Math.floor(Math.random() * 100)),
        cat: category,
        desc: description.trim(),
        tags: [],
        downloads: '0',
        filePath: storedFileName,
        custom: true,
      };

      customAgents.unshift(newAgent);
      writeCustomAgents(customAgents);

      return { ok: true, agent: newAgent };
    } catch (err) {
      return normalizeError(err);
    }
  });
}
