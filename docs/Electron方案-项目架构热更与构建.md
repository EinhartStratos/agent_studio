# Electron 方案：项目架构、热更新与构建实现

## 1. 总体架构

整个应用拆成三层：

1. **壳（Electron）**：窗口管理、本地能力桥接、热更新、Agent 调度。
2. **内容（前端网页）**：从远端下载或预置在包内的网页资源，通过热更新机制动态替换。
3. **Agent（Pi / 本地命令）**：以 Node.js/Bun 子进程或 npm 包形式运行，主进程通过 IPC 或 stdio 与其通信。

```
+---------------------------+
| Electron BrowserWindow    |  <-- 渲染内容页（本地 content/current/index.html 或远端 URL）
| - preload + contextBridge   |
+---------------------------+
             ^
             | IPC (invoke/handle)
+---------------------------+
| Electron Main Process     |  <-- Node.js
| - src/main/window.ts      |     窗口、生命周期
| - src/main/update.ts      |     热更新/版本管理
| - src/main/agent.ts       |     Pi / Agent 集成
| - src/main/security.ts    |     命令白名单/权限/审计
+---------------------------+
       |                |
  Pi npm 包/        userData/content/
  pi 二进制           热更内容目录
```

---

## 2. 目录结构

```
electron-agent-shell/
├── package.json                 # 依赖、scripts、electron-builder 配置
├── electron.vite.config.ts      # electron-vite 构建配置
├── tsconfig.json
├── scripts/
│   ├── build-all.sh             # 外网一键构建多平台
│   └── make-default-content.mjs # 将初始内容打包进应用
├── src/
│   ├── main/                    # 主进程（Node.js，有完整系统权限）
│   │   ├── index.ts             # 应用入口
│   │   ├── window.ts            # BrowserWindow 创建与管理
│   │   ├── update.ts            # 热更新逻辑
│   │   ├── agent.ts             # Agent / Pi 集成
│   │   ├── security.ts          # 权限/命令白名单
│   │   └── utils/
│   ├── preload/                 # preload 脚本（渲染进程与主进程的安全桥梁）
│   │   └── index.ts
│   ├── renderer/                # 壳本身的最小前端入口（通常只是 loading/空壳）
│   │   └── index.html
│   └── shared/
│       └── ipc-channels.ts      # IPC 通道常量
├── resources/
│   ├── bin/                     # pi 二进制 / 本地 Agent 可执行文件
│   │   ├── pi-linux-x64
│   │   ├── pi-linux-arm64
│   │   └── pi-win.exe
│   └── default-content/         # 预置内容包（可选）
│       └── index.html
├── assets/                      # 图标、logo
├── build/                       # electron-builder 资源（icon.icns 等）
└── dist/                        # 构建产物
```

---

## 3. 主进程职责与 Agent 集成

### 3.1 主进程职责

| 模块 | 职责 |
|------|------|
| `index.ts` | 应用入口：初始化热更新、创建窗口、拉起 Agent、处理生命周期 |
| `window.ts` | `BrowserWindow` 创建、窗口状态、加载本地/远端页面 |
| `update.ts` | 版本检查、内容包下载/校验/解压/回滚 |
| `agent.ts` | 启动/停止 Pi 进程，转发 Agent 消息到渲染进程 |
| `security.ts` | 命令白名单、路径审计、请求签名、IPC 权限限制 |

### 3.2 Agent（Pi）集成方式

因为 `earendil-works/pi` 是 Node.js/Bun + TypeScript 项目，与 Electron 主进程同生态，有三种集成方式：

#### 方式 A：直接引用 Pi npm 包（推荐，若 Pi 暴露 Node API）

```ts
// src/main/agent.ts
import { createAgent } from '@earendil-works/pi-coding-agent';

export async function startAgent() {
  const agent = createAgent({ /* config */ });
  // 将 agent 的事件转发给主窗口
  agent.on('message', (msg) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('agent:message', msg);
  });
  return agent;
}
```

优点：调用简单、共享内存、无需跨进程序列化。
缺点：
- Pi 的异常可能拖垮整个 Electron 主进程。
- **Pi 的 `package.json` 要求 `node >= 22.19.0`**；Electron 33 内嵌 Node 20，不能直接运行 Pi。需要：
  - 使用 **Electron 35/36 最新 patch**（内嵌 Node 22.14.0），或
  - 将 Pi 作为独立 Node 22 进程启动（见方式 B）。

#### 方式 B：调用 Pi 独立二进制（推荐，若 Pi 已发布 standalone bin）

```ts
// src/main/agent.ts
import { spawn } from 'node:child_process';
import { app } from 'electron';
import path from 'node:path';

export function startAgent() {
  const arch = process.arch; // x64 / arm64
  const platform = process.platform; // win32 / linux / darwin
  const binName = platform === 'win32' ? 'pi.exe' : `pi-${platform}-${arch}`;
  const piBin = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', binName)
    : path.join(__dirname, '../../resources/bin', binName);

  const agent = spawn(piBin, ['server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: app.getPath('userData'),
  });

  agent.stdout.on('data', (data) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('agent:stdout', data.toString());
  });

  agent.stderr.on('data', (data) => console.error(`[agent err] ${data}`));
  return agent;
}
```

优点：Agent 崩溃不影响主进程；可独立升级 Agent 二进制。
缺点：需要跨进程通信协议（stdio/IPC/gRPC/HTTP）。

#### 方式 C：本地 HTTP / stdio 服务

如果 Pi 提供 `pi server` 或类似命令，主进程启动后监听本地端口/stdin，渲染进程通过 preload 暴露的 API 调用。

---

## 4. 渲染进程与 Preload

### 4.1 安全原则

- **渲染进程禁用 Node 集成**：`nodeIntegration: false`。
- **启用上下文隔离**：`contextIsolation: true`。
- **沙箱**：`sandbox: true`（ Electron 20+ 默认）。
- 所有本地能力（文件、命令、Agent）通过 `contextBridge` + IPC 暴露。

### 4.2 Preload 示例

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Agent
  invokeAgent: (command: string, args: unknown[]) =>
    ipcRenderer.invoke('agent:invoke', command, args),
  onAgentMessage: (callback: (msg: string) => void) =>
    ipcRenderer.on('agent:message', (_event, msg) => callback(msg)),

  // 本地命令（白名单控制）
  executeCommand: (cmd: string, args: string[]) =>
    ipcRenderer.invoke('shell:execute', cmd, args),

  // 热更新/内容
  loadContentVersion: (version: string) =>
    ipcRenderer.invoke('content:load', version),
  getContentVersions: () =>
    ipcRenderer.invoke('content:get-versions'),
  onUpdateProgress: (callback: (progress: number) => void) =>
    ipcRenderer.on('update:progress', (_event, progress) => callback(progress)),
});
```

### 4.3 渲染进程调用示例

```ts
// content/current/src/app.tsx（热更包里的前端代码）
window.electronAPI.onAgentMessage((msg) => console.log(msg));

async function runTask(prompt: string) {
  const result = await window.electronAPI.invokeAgent('run', [prompt]);
  return result;
}

async function runShell(cmd: string, args: string[]) {
  const result = await window.electronAPI.executeCommand(cmd, args);
  return result;
}
```

---

## 5. 安全与权限

### 5.1 命令执行白名单

```ts
// src/main/security.ts
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';

const ALLOWED_COMMANDS = new Set([
  'git', 'python3', 'node', 'pi', 'ls', 'cat', 'mkdir', 'rm', 'cp', 'mv',
]);

const ALLOWED_DIRS = [
  '/home/user/workspace',
  '/tmp',
];

ipcMain.handle('shell:execute', async (_event, cmd: string, args: string[]) => {
  if (!ALLOWED_COMMANDS.has(cmd)) {
    throw new Error(`Command not allowed: ${cmd}`);
  }
  // 审计日志
  console.log(`[AUDIT] execute: ${cmd} ${args.join(' ')}`);
  // 注意：生产环境应做路径解析、参数转义、超时、输出上限等处理
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ALLOWED_DIRS[0] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`Exit ${code}: ${stderr}`));
    });
  });
});
```

### 5.2 其他安全措施

- 内容包下载：强制 HTTPS，校验 SHA-256 + 签名证书。
- 渲染进程：禁止 `nodeIntegration`，所有系统调用走 IPC。
- 更新：记录版本链，防止降级攻击；支持强制更新与灰度。
- 本地文件：只暴露 `userData` 下指定目录，禁止直接访问用户主目录。

---

## 6. 热更新设计（壳-内容分离）

### 6.1 远端版本配置

```json
{
  "shell": {
    "version": "1.0.0",
    "minVersion": "1.0.0",
    "downloadUrl": "https://cdn.example.com/shell/"
  },
  "content": {
    "latest": "1.2.3",
    "required": true,
    "packages": {
      "1.2.3": {
        "url": "https://cdn.example.com/content/content-1.2.3.zip",
        "hash": "sha256:abc123...",
        "signature": "..."
      },
      "1.2.2": {
        "url": "https://cdn.example.com/content/content-1.2.2.zip",
        "hash": "sha256:def456..."
      }
    }
  }
}
```

### 6.2 本地内容目录

```
userData/
└── content/
    ├── current -> 1.2.3/          # 符号链接/记录文件
    ├── 1.2.3/
    │   └── index.html
    ├── 1.2.2/
    │   └── index.html
    └── 1.2.3.zip
```

### 6.3 热更新流程

1. **启动检查**：主进程读取远端 `versions.json`。
2. **版本对比**：本地 `current` 版本 vs `content.latest`。
3. **下载**：若落后且 `required=true`，下载 zip 到 `userData/content/{version}.zip`。
4. **校验**：SHA-256 + 可选 RSA 签名。
5. **解压**：解压到 `userData/content/{version}/`。
6. **切换**：原子更新 `current` 指针（Windows 用 junction，Linux/macOS 用 symlink）。
7. **加载**：`BrowserWindow.loadFile('userData/content/current/index.html')`。
8. **回滚**：若加载失败或校验不通过，切回上一个已知可用版本。

### 6.4 热更新核心代码

```ts
// src/main/update.ts
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream';

const pump = promisify(pipeline);

const CONTENT_DIR = path.join(app.getPath('userData'), 'content');
const VERSIONS_URL = 'https://cdn.example.com/versions.json';

export interface ContentInfo {
  version: string;
  url: string;
  hash: string;
}

export interface VersionsManifest {
  content: {
    latest: string;
    required: boolean;
    packages: Record<string, ContentInfo>;
  };
}

export async function fetchManifest(): Promise<VersionsManifest> {
  return new Promise((resolve, reject) => {
    https.get(VERSIONS_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

export async function getCurrentVersion(): Promise<string | null> {
  const currentFile = path.join(CONTENT_DIR, 'current.txt');
  if (!fs.existsSync(currentFile)) return null;
  return fs.readFileSync(currentFile, 'utf-8').trim();
}

export function getContentIndexPath(): string {
  return path.join(CONTENT_DIR, 'current', 'index.html');
}

export async function ensureContent(mainWindow?: Electron.BrowserWindow) {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const manifest = await fetchManifest();
  const latestVersion = manifest.content.latest;
  const currentVersion = await getCurrentVersion();

  if (currentVersion === latestVersion) return;

  const info = manifest.content.packages[latestVersion];
  if (!info) throw new Error(`No package info for ${latestVersion}`);

  const zipPath = path.join(CONTENT_DIR, `${latestVersion}.zip`);
  const targetDir = path.join(CONTENT_DIR, latestVersion);

  if (!fs.existsSync(targetDir)) {
    mainWindow?.webContents.send('update:progress', 10);
    await downloadFile(info.url, zipPath);
    mainWindow?.webContents.send('update:progress', 60);
    await verifyHash(zipPath, info.hash);
    mainWindow?.webContents.send('update:progress', 80);
    await extractZip(zipPath, targetDir);
  }

  setCurrentVersion(latestVersion);
  mainWindow?.webContents.send('update:progress', 100);
}

function setCurrentVersion(version: string) {
  const currentFile = path.join(CONTENT_DIR, 'current.txt');
  fs.writeFileSync(currentFile, version);
}

async function downloadFile(url: string, dest: string) {
  const file = fs.createWriteStream(dest);
  await new Promise<void>((resolve, reject) => {
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', reject);
  });
}

async function verifyHash(filePath: string, expectedHash: string) {
  const hash = createHash('sha256');
  await pump(fs.createReadStream(filePath), hash);
  const actual = hash.digest('hex');
  const expected = expectedHash.replace('sha256:', '');
  if (actual !== expected) throw new Error('Content hash mismatch');
}

async function extractZip(zipPath: string, destDir: string) {
  // 生产环境可用 adm-zip / unzipper / tar 等库
  const { Extract } = await import('unzipper');
  await fs.promises.mkdir(destDir, { recursive: true });
  await fs.createReadStream(zipPath)
    .pipe(Extract({ path: destDir }))
    .promise();
}
```

### 6.5 失败回滚

```ts
export async function rollbackTo(version: string) {
  const targetDir = path.join(CONTENT_DIR, version);
  if (!fs.existsSync(targetDir)) throw new Error(`Cannot rollback to ${version}`);
  setCurrentVersion(version);
}
```

---

## 7. 构建与打包

### 7.1 技术栈

| 工具 | 用途 |
|------|------|
| `electron` | 35/36 最新 patch（内嵌 Node 22；glibc 2.28 兼容性需选含 sysroot fix 的版本） |
| `electron-vite` | 主进程、preload、渲染进程的 TS 构建 |
| `electron-builder` | 打包 Windows / Linux / macOS |
| `@electron/rebuild` | 原生 Node 模块按目标架构重建 |

### 7.2 package.json 关键配置

```json
{
  "name": "electron-agent-shell",
  "version": "1.0.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "postinstall": "electron-builder install-app-deps",
    "dist:win": "electron-builder --win",
    "dist:linux:x64": "electron-builder --linux --x64",
    "dist:linux:arm64": "electron-builder --linux --arm64",
    "dist:all": "electron-builder -wl --x64 --arm64"
  },
  "devDependencies": {
    "electron": "~36.0.4",
    "electron-builder": "^26.0.0",
    "electron-vite": "^2.0.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^x.x.x",
    "adm-zip": "^0.5.0",
    "unzipper": "^0.12.0"
  },
  "build": {
    "appId": "com.example.electron-agent-shell",
    "productName": "Agent Shell",
    "directories": {
      "output": "dist"
    },
    "files": [
      "out/**/*",
      "assets/**/*"
    ],
    "extraResources": [
      {
        "from": "resources/bin",
        "to": "bin",
        "filter": ["**/*"]
      },
      {
        "from": "resources/default-content",
        "to": "default-content",
        "filter": ["**/*"]
      }
    ],
    "linux": {
      "target": ["AppImage", "deb", "tar.gz"],
      "category": "Utility",
      "maintainer": "your-team@example.com"
    },
    "win": {
      "target": ["nsis", "portable"]
    },
    "mac": {
      "target": ["dmg", "zip"]
    }
  }
}
```

### 7.3 多平台构建策略

#### 外网构建机方案

| 构建产物 | 宿主要求 | 说明 |
|----------|----------|------|
| Linux x64 | Linux x64（Ubuntu 22.04/20.04） | `electron-builder --linux --x64` |
| Linux arm64 | Linux x64 | `electron-builder --linux --arm64`；Electron 会下载 arm64 预编译二进制 |
| Windows x64 | Linux x64 + wine | `electron-builder --win` 可构建 nsis / portable |
| Windows x64 | Windows x64 | 更稳，签名也在 Windows 上做 |
| macOS | macOS | 必须在 macOS 上构建（或购买 Electron Build Service） |

推荐 CI 矩阵：

```yaml
# .github/workflows/build.yml 示例
jobs:
  build-linux:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: npx electron-builder --linux --x64 --arm64
  build-win:
    runs-on: windows-latest
    steps:
      - run: npm ci && npm run build
      - run: npx electron-builder --win
  build-mac:
    runs-on: macos-latest
    steps:
      - run: npm ci && npm run build
      - run: npx electron-builder --mac
```

### 7.4 原生 Node 模块处理

如果使用了 `node-pty`、`sqlite3`、`sharp` 等原生模块：

1. 在 `package.json` 加 `"postinstall": "electron-builder install-app-deps"`。
2. Linux ARM64 交叉构建时，需要提前准备对应架构的预编译 binary：
   - 使用 `@electron/rebuild --arch=arm64`；
   - 或在 CI 的 ARM64 runner / QEMU 容器中构建。
3. 尽量使用纯 JS/TS 依赖，避免原生模块。

### 7.5 glibc 2.28 兼容性与 Node 版本

- **Pi 需要 Node 22**：`earendil-works/pi` 的 `engines.node` 为 `>=22.19.0`，**Node 20 无法运行 Pi**。Node 22 官方最低 glibc 2.28，与目标系统（glibc 2.28）刚好匹配。
- **Electron 35/36 内嵌 Node 22.14.0**：可直接在主进程中 `require` Pi npm 包；Electron 33 内嵌 Node 20，只能将 Pi 作为独立 Node 22 进程启动。
- **Electron 34+ 的 glibc 2.29 问题已修复**：早期 Electron 34/35/36 在 RHEL 8 / Rocky 8（glibc 2.28）上会报 `GLIBC_2.29 not found`，官方通过 PR #45974 / #45982 / #45983 / #45984 回滚 sysroot 修复了该问题。**务必使用包含该修复的最新 patch 版本**（如 35.x / 36.x 最新版），而不是早期 34.0.x。
- **构建机**：用 Ubuntu 22.04/20.04 构建，产物可在 RHEL 8 / Rocky 8 / Ubuntu 20.04+ 运行。
- **用户已验证 Chrome 133 可跑**：说明 Chromium 133 在 glibc 2.28 环境可行；Electron 35 = Chromium 134，Electron 36 = Chromium 136，同一代内核大概率也能跑，但仍需在目标环境实测。
- **避免高 glibc 原生依赖**：构建后可用 `objdump -T` / `ldd` 检查 `.node` 文件和 `.so` 的 GLIBC 符号版本。

```bash
# 检查 native 模块的 glibc 依赖
find . -name '*.node' -o -name '*.so' | while read f; do
  echo "=== $f ==="
  objdump -T "$f" | grep GLIBC | sed 's/.*GLIBC_\([0-9.]*\).*/\1/' | sort -Vu
done
```

### 7.6 关于 CEF 的版本选择

如果后续仍想评估 **Avalonia + CEF** 或 **Flutter + CEF**，CEF 版本建议与已验证的 Chromium 版本对齐：

- **用户内网 Chrome 133 可正常使用**，说明 **Chromium 133 在 glibc 2.28 环境可行**。
- 因此 CEF 建议选择 **CEF 133.x**（对应 Chromium 133），下载地址：`https://cef-builds.spotifycdn.com/cef_binary_133.x+gXXXX+chromium-133.0.6943.x_linuxXX.tar.bz2`。
- 注意：CEF 官方预编译 binary 通常用 Ubuntu 22.04/Debian 12 工具链构建，**可能仍依赖 glibc 2.31+**。在 glibc 2.28 上跑 CEF 133，需要：
  - 在目标环境实测；或
  - 在 RHEL 8 / Rocky 8 容器内重新编译 CEF（使用 `automate-git.py` + 对应 sysroot）；或
  - 使用社区/发行版重新打包的 CEF（如 NixOS `cef-binary` 会 patch ELF/rpath）。
- 如果 Electron 方案可行，**不需要再引入 CEF**，因为 Electron 已经自带 Chromium。

---

## 8. 最小可运行原型

### 8.1 主进程入口

```ts
// src/main/index.ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { ensureContent } from './update';
import { startAgent } from './agent';

let mainWindow: BrowserWindow;

async function createWindow() {
  // 1. 热更新：确保本地有最新内容
  await ensureContent();

  // 2. 创建窗口
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 3. 加载本地内容或远端 URL
  const contentIndex = path.join(app.getPath('userData'), 'content/current/index.html');
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(contentIndex);
  }

  // 4. 拉起 Agent
  startAgent();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

### 8.2 Preload

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  invokeAgent: (command: string, args: unknown[]) =>
    ipcRenderer.invoke('agent:invoke', command, args),
  executeCommand: (cmd: string, args: string[]) =>
    ipcRenderer.invoke('shell:execute', cmd, args),
});

declare global {
  interface Window {
    electronAPI: typeof contextBridge;
  }
}
```

### 8.3 主进程 Agent IPC

```ts
// src/main/index.ts 中加入
import { ipcMain } from 'electron';
import { agentInstance } from './agent';

ipcMain.handle('agent:invoke', async (_event, command: string, args: unknown[]) => {
  return agentInstance.invoke(command, args);
});
```

---

## 9. 内网部署流程

1. **外网构建**：
   ```bash
   npm ci
   npm run build
   npx electron-builder --linux --x64 --arm64
   npx electron-builder --win
   ```
2. **产物拷贝到内网**：
   - `dist/*.AppImage` / `dist/*.deb` / `dist/*.tar.gz`
   - `dist/*.exe` / `dist/*.portable`
3. **内网首次运行**：
   - 若带预置 `default-content`，首次启动自动复制到 `userData/content`。
   - 若内网无 CDN，关闭自动热更新，改由管理员手动替换内容包。
4. **后续热更新**（可选）：
   - 内网架设私有镜像，提供 `versions.json` 和内容包 zip。
   - 或离线 U 盘拷贝 zip 到 `userData/content`，程序检测本地新版本并切换。

---

## 10. 风险与注意事项

| 风险 | 说明 | 缓解 |
|------|------|------|
| Electron 版本/补丁 | 早期 Electron 34+ 需 glibc 2.29；Pi 需 Node 22 | 使用 35/36 最新 patch；CI 在目标容器内 `ldd`/`objdump` 验证 |
| 原生 Node 模块跨架构 | arm64 构建可能包含 x64 二进制 | 用 `@electron/rebuild --arch=arm64` 或 CI matrix |
| macOS 构建 | 必须 macOS 宿主 | 用 GitHub Actions `macos-latest` |
| 内容包安全 | 中间人篡改 | HTTPS + SHA-256 + 签名 |
| 命令执行权限 | 主进程可执行任意命令 | 白名单 + 路径限制 + 审计日志 |
| 内网无 CDN | 无法自动热更 | 预置内容包 + 离线升级 |
| Pi 二进制 glibc | Bun/Node 构建的二进制可能要求更高 glibc | 在目标 glibc 2.28 容器内测试 |

---

## 11. 结论

采用 **Electron 35/36 最新 patch + electron-vite + electron-builder** 作为壳，配合：

- **壳**：负责窗口、热更新、本地命令/Agent 调度。
- **内容包**：网页资源从远端/离线方式更新，放在 `userData/content`。
- **Agent**：Pi 作为 npm 包或独立二进制运行，主进程通过 IPC 与渲染进程桥接。

可以在外网 Linux x64 构建机上一次性产出 Linux x64 / Linux arm64 / Windows x64；macOS 单独构建。整体技术栈统一、开发效率高、与 Pi 的 Node/Bun 生态天然契合。
