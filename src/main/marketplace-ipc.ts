import path from 'node:path';
import fs from 'node:fs';
import { ipcMain } from 'electron';
import AdmZip from 'adm-zip';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { MarketplaceAgent, MarketplaceCategory, UploadAgentRequest } from '../shared/types';
import { getAppAgentDir, ensureAppAgentDir, getAppSkillsDir, ensureAppSkillsDir, getUserDataPath } from './utils/paths';
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

/** 智能体市场元数据与文件的根目录（应用级，不再随工作区切换而变化） */
function getMarketplaceBaseDir(): string {
  return path.join(ensureAppAgentDir(), 'marketplace');
}

/** 上传的非 zip 智能体文件保存目录 */
function getMarketplaceFilesDir(): string {
  const dir = path.join(getMarketplaceBaseDir(), 'files');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getMetaPath(): string {
  return path.join(getMarketplaceBaseDir(), 'agents-meta.json');
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
  // filePath 统一记录为相对 getAppAgentDir() 的路径，也兼容旧绝对路径
  const candidates = [path.join(getAppAgentDir(), agent.filePath), agent.filePath];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function stripFrontmatter(markdown: string): string {
  const raw = markdown.replace(/^\uFEFF/, '').trim();
  const fmMatch = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
}

/** 在目录（含子目录）中查找 SKILL.md 或 skill.md */
function findSkillMdInDir(dir: string): string | null {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.toLowerCase() === 'skill.md') {
        return path.join(dir, ent.name);
      }
    }
    for (const ent of entries) {
      if (ent.isDirectory() && !ent.name.startsWith('.') && ent.name !== 'node_modules') {
        const found = findSkillMdInDir(path.join(dir, ent.name));
        if (found) return found;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readSkillMarkdownFromArchive(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  if (fs.statSync(filePath).isDirectory()) {
    const skillMd = findSkillMdInDir(filePath);
    if (!skillMd) return null;
    return stripFrontmatter(fs.readFileSync(skillMd, 'utf-8'));
  }

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

/** 生成一个适合作为文件/目录名的字符串 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 40);
}

/** 把 skill 的 zip 包解压到应用级 skills 目录，并返回 skill 目录名 */
function extractSkillZip(id: string, name: string, zipBuffer: Buffer): string {
  const baseName = sanitizeFileName(name) || 'skill';
  const skillDirName = `${baseName}_${id.slice(-8)}`;
  const skillDir = path.join(ensureAppSkillsDir(), skillDirName);
  // 同名覆盖：删除旧目录后重新解压
  fs.rmSync(skillDir, { recursive: true, force: true });
  fs.mkdirSync(skillDir, { recursive: true });
  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(skillDir, true);
  return path.join('skills', skillDirName);
}

/** 旧版智能体市场目录：userData/agents */
function getLegacyUserAgentsDir(): string {
  return path.join(getUserDataPath(), 'agents');
}

/** 旧版工作区智能体市场目录 */
function getLegacyWorkspaceAgentsDir(): string | null {
  const ws = loadConfig().native?.defaultWorkspace?.trim();
  if (!ws) return null;
  return path.join(ws, 'agents');
}

/** 一次性迁移旧版智能体市场数据到应用级 .pi/agent/marketplace */
function migrateLegacyMarketplace(): void {
  if (fs.existsSync(getMetaPath())) return;
  const sources = Array.from(
    new Set([getLegacyUserAgentsDir(), getLegacyWorkspaceAgentsDir()].filter((d): d is string => Boolean(d)))
  );
  for (const sourceDir of sources) {
    const sourceMeta = path.join(sourceDir, 'agents-meta.json');
    if (!fs.existsSync(sourceMeta)) continue;
    try {
      const raw = fs.readFileSync(sourceMeta, 'utf-8');
      const data = JSON.parse(raw);
      const agents: MarketplaceAgent[] = Array.isArray(data) ? data : [];
      const filesDir = getMarketplaceFilesDir();
      for (const agent of agents) {
        if (!agent.filePath) continue;
        const oldFile = path.join(sourceDir, agent.filePath);
        if (!fs.existsSync(oldFile)) continue;
        const ext = path.extname(agent.filePath).toLowerCase();
        if (ext === '.zip') {
          const zipBuffer = fs.readFileSync(oldFile);
          agent.filePath = extractSkillZip(agent.id, agent.name, zipBuffer);
          try {
            fs.rmSync(oldFile, { force: true });
          } catch {}
        } else {
          const fileName = path.basename(agent.filePath);
          const newAbs = path.join(filesDir, fileName);
          fs.copyFileSync(oldFile, newAbs);
          try {
            fs.unlinkSync(oldFile);
          } catch {}
          agent.filePath = path.join('marketplace', 'files', fileName);
        }
      }
      writeCustomAgents(agents);
      try {
        fs.rmSync(sourceMeta, { force: true });
      } catch {}
      console.log('[marketplace] Migrated legacy agents from', sourceDir);
      return;
    } catch (err) {
      console.error('[marketplace] Legacy migration failed for', sourceDir, err);
    }
  }
}

export function registerMarketplaceIpc(): void {
  // 启动时一次性迁移旧版市场数据
  migrateLegacyMarketplace();

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

      const id = generateId(name);
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
      const fileBaseName = path.basename(safeFileName);
      const ext = path.extname(fileBaseName).toLowerCase();
      const buffer = Buffer.from(fileData, 'base64');

      let storedFilePath: string;

      if (ext === '.zip') {
        storedFilePath = extractSkillZip(id, name, buffer);
      } else {
        const agentsDir = getMarketplaceFilesDir();
        const storedFileName = `${id}${ext || ''}`;
        const storedFileAbs = path.join(agentsDir, storedFileName);
        fs.writeFileSync(storedFileAbs, buffer);
        storedFilePath = path.join('marketplace', 'files', storedFileName);
      }

      const customAgents = readCustomAgents();
      const newAgent: MarketplaceAgent = {
        id,
        name: name.trim(),
        emoji: pickEmoji(customAgents.length + Math.floor(Math.random() * 100)),
        cat: category,
        desc: description.trim(),
        tags: [],
        downloads: '0',
        filePath: storedFilePath,
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
