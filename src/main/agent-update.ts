import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import tar from 'tar';
import AdmZip from 'adm-zip';
import { getAgentDir, restartAgent, getAgentStatus, getAgentBinaryPath } from './agent';
import { loadConfig } from './config';
import { broadcastToAllViews } from './utils/broadcast';

const UPDATE_DIR = path.join(app.getPath('userData'), 'updates');
const USER_AGENT_DIR = path.join(app.getPath('userData'), 'agent-bin');

export interface AgentUpdateInfo {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
  hash: string | null;
  error?: string;
}

interface UpdateManifest {
  version: string;
  url: string;
  hash?: string;
}

export function getCurrentAgentVersion(): string | null {
  const versionFile = path.join(getAgentDir(), 'version');
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf-8').trim();
  }
  if (!app.isPackaged) {
    const devPkg = path.join(app.getAppPath(), 'third_party/pi/packages/coding-agent/package.json');
    if (fs.existsSync(devPkg)) {
      try {
        return JSON.parse(fs.readFileSync(devPkg, 'utf-8')).version ?? null;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function resolveDownloadUrl(url: string, version: string): string {
  return url.replace(/\{version\}/g, version);
}

function sendProgress(progress: number): void {
  broadcastToAllViews('agent:update-progress', progress);
}

function sendStatus(status: string): void {
  broadcastToAllViews('agent:update-status', status);
}

export async function checkForUpdate(): Promise<AgentUpdateInfo> {
  const currentVersion = getCurrentAgentVersion();
  const config = loadConfig();
  const updateUrl = config.pi.updateManifestUrl || process.env.PI_UPDATE_MANIFEST_URL || '';
  if (!updateUrl) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      downloadUrl: null,
      hash: null,
      error: 'Pi update manifest URL not configured',
    };
  }

  try {
    const response = await fetch(updateUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const manifest = (await response.json()) as UpdateManifest;
    const downloadUrl = resolveDownloadUrl(manifest.url, manifest.version);
    const updateAvailable = currentVersion !== manifest.version;
    return {
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable,
      downloadUrl,
      hash: manifest.hash ?? null,
    };
  } catch (err) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      downloadUrl: null,
      hash: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function downloadFile(url: string, dest: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }

      const total = parseInt(response.headers['content-length'] ?? '0', 10) || 0;
      let loaded = 0;
      const file = fs.createWriteStream(dest);

      response.on('data', (chunk: Buffer) => {
        loaded += chunk.length;
        if (onProgress) onProgress(loaded, total);
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function verifyHash(filePath: string, expected: string): Promise<void> {
  const prefix = 'sha256:';
  const expectedHash = expected.startsWith(prefix) ? expected.slice(prefix.length) : expected;
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  const actual = hash.digest('hex');
  if (actual !== expectedHash) {
    throw new Error(`Hash mismatch for ${filePath}`);
  }
}

function getArchiveExtension(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.tar.gz') || pathname.endsWith('.tgz')) return '.tar.gz';
  if (pathname.endsWith('.zip')) return '.zip';
  if (pathname.endsWith('.tar')) return '.tar';
  return '.tar.gz';
}

async function extractArchive(archivePath: string, dest: string): Promise<void> {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(dest, true);
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) {
    await tar.x({ file: archivePath, cwd: dest });
  } else {
    throw new Error(`Unsupported archive format: ${archivePath}`);
  }
}

function flattenSingleRoot(dir: string): void {
  const entries = fs.readdirSync(dir);
  const dirs = entries.filter((e) => fs.statSync(path.join(dir, e)).isDirectory());
  const files = entries.filter((e) => !fs.statSync(path.join(dir, e)).isDirectory());
  if (dirs.length === 1 && files.length === 0) {
    const root = path.join(dir, dirs[0]);
    for (const child of fs.readdirSync(root)) {
      fs.renameSync(path.join(root, child), path.join(dir, child));
    }
    fs.rmdirSync(root);
  }
}

function getArchAliases(): string[] {
  const arch = process.arch;
  const aliases: string[] = [arch];
  if (arch === 'x64') aliases.push('x86_64');
  if (arch === 'arm64') aliases.push('aarch64');
  return aliases;
}

function ensureBinaryName(dir: string): void {
  const expected = path.basename(getAgentBinaryPath());
  if (fs.existsSync(path.join(dir, expected))) return;

  const candidates = ['pi', 'pi.exe'];
  for (const arch of getArchAliases()) {
    candidates.push(`pi-${process.platform}-${arch}`);
    candidates.push(`pi-${arch}`);
  }
  candidates.push(`pi-${process.platform}`);

  for (const candidate of candidates) {
    const candidatePath = path.join(dir, candidate);
    if (fs.existsSync(candidatePath)) {
      fs.renameSync(candidatePath, path.join(dir, expected));
      return;
    }
  }
}

async function waitForAgentReady(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getAgentStatus();
    if (status.connected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Pi did not become ready after update');
}

export async function installUpdate(info: { version: string; url: string; hash?: string }): Promise<void> {
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  fs.mkdirSync(USER_AGENT_DIR, { recursive: true });
  sendStatus('Preparing update...');
  sendProgress(5);

  const ext = getArchiveExtension(info.url);
  const archiveName = `pi-update-${info.version}${ext}`;
  const archivePath = path.join(UPDATE_DIR, archiveName);

  sendStatus(`Downloading Pi ${info.version}...`);
  sendProgress(10);
  await downloadFile(info.url, archivePath, (loaded, total) => {
    if (total > 0) {
      sendProgress(10 + Math.floor((loaded / total) * 40));
    }
  });

  if (info.hash) {
    sendStatus('Verifying checksum...');
    sendProgress(55);
    await verifyHash(archivePath, info.hash);
  }

  sendStatus('Extracting...');
  sendProgress(60);

  const backupDir = `${USER_AGENT_DIR}.backup`;
  if (fs.existsSync(USER_AGENT_DIR)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.renameSync(USER_AGENT_DIR, backupDir);
  }
  fs.mkdirSync(USER_AGENT_DIR, { recursive: true });

  try {
    await extractArchive(archivePath, USER_AGENT_DIR);
    flattenSingleRoot(USER_AGENT_DIR);
    ensureBinaryName(USER_AGENT_DIR);
    fs.writeFileSync(path.join(USER_AGENT_DIR, 'version'), info.version);
  } catch (err) {
    fs.rmSync(USER_AGENT_DIR, { recursive: true, force: true });
    if (fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, USER_AGENT_DIR);
    }
    throw err;
  }

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  sendStatus('Restarting Pi...');
  sendProgress(85);
  await restartAgent();

  sendStatus('Waiting for Pi to be ready...');
  sendProgress(90);
  await waitForAgentReady(60000);

  sendStatus('Pi updated and running');
  sendProgress(100);
}

export function registerAgentUpdateIpc(): void {
  ipcMain.handle('agent:get-update-info', async () => checkForUpdate());

  ipcMain.handle('agent:install-update', async (_event, info: { version: string; url: string; hash?: string }) => {
    try {
      await installUpdate(info);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
