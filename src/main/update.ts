import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import https from 'node:https';
import http from 'node:http';
import extract from 'extract-zip';
import { getDefaultContentPath, getUserDataPath } from './utils/paths';

interface ContentPackage {
  version: string;
  url: string;
  hash: string;
}

interface ContentManifest {
  latest: string;
  required: boolean;
  packages: Record<string, ContentPackage>;
}

interface VersionsManifest {
  content: ContentManifest;
}

const CONTENT_DIR = getUserDataPath('content');
const CURRENT_FILE = path.join(CONTENT_DIR, 'current.txt');
const MANIFEST_URL = process.env.CONTENT_MANIFEST_URL ?? '';

export function getContentIndexPath(): string {
  const current = getCurrentVersion();
  if (current) {
    return path.join(CONTENT_DIR, current, 'index.html');
  }
  return getDefaultContentPath();
}

function getCurrentVersion(): string | null {
  if (!fs.existsSync(CURRENT_FILE)) return null;
  try {
    return fs.readFileSync(CURRENT_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

function setCurrentVersion(version: string): void {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(CURRENT_FILE, version);
}

export async function ensureContent(mainWindow?: BrowserWindow): Promise<void> {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });

  if (!MANIFEST_URL) {
    console.log('CONTENT_MANIFEST_URL not set, skipping hot-update check.');
    return;
  }

  const manifest = await fetchManifest().catch((err: Error) => {
    console.warn('Unable to fetch content manifest:', err.message);
    return null;
  });

  if (!manifest) return;

  const latest = manifest.content.latest;
  const current = getCurrentVersion();

  if (current === latest) {
    console.log(`Content is up to date: ${current}`);
    return;
  }

  const pkg = manifest.content.packages[latest];
  if (!pkg) {
    console.warn(`No package info for version ${latest}`);
    return;
  }

  const targetDir = path.join(CONTENT_DIR, latest);
  if (fs.existsSync(targetDir)) {
    setCurrentVersion(latest);
    return;
  }

  mainWindow?.webContents.send('update:progress', 10);
  const zipPath = path.join(CONTENT_DIR, `${latest}.zip`);

  await downloadFile(pkg.url, zipPath);
  mainWindow?.webContents.send('update:progress', 60);

  await verifyHash(zipPath, pkg.hash);
  mainWindow?.webContents.send('update:progress', 80);

  await extract(zipPath, { dir: targetDir });
  mainWindow?.webContents.send('update:progress', 95);

  setCurrentVersion(latest);
  mainWindow?.webContents.send('update:progress', 100);
}

async function fetchManifest(): Promise<VersionsManifest> {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as VersionsManifest;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(dest);
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
