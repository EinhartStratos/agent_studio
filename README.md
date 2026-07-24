# Agent Studio

Agent Studio 是一个跨平台 Electron 桌面外壳，用于嵌入 Pi 智能体（`earendil-works/pi`）并通过热更新机制加载远程网页内容。

## 项目定位

- **Shell（壳）**：负责窗口、WebView 容器、本地命令分发、Agent 生命周期和热更新。
- **Content（内容）**：业务网页以独立内容包形式发布，Shell 启动时从远程地址拉取并加载。
- **Agent（Pi）**：通过子进程运行 `pi --mode rpc`，与 Shell 通过 stdin/stdout JSON-RPC 通信。

## 目录结构

```
agent_studio/
├── .github/workflows/       GitHub Actions 构建工作流
├── build/                   构建资源（图标等）
├── resources/
│   ├── bin/                 Pi 二进制及其运行时资源
│   │   ├── pi-win.exe
│   │   ├── pi-linux-x64
│   │   ├── pi-linux-arm64
│   │   ├── theme/           Pi 运行时主题/资源
│   │   ├── assets/
│   │   └── export-html/
│   └── default-content/     默认内容页（服务状态页）
├── src/
│   ├── main/                Electron 主进程
│   ├── preload/             Preload 脚本
│   ├── renderer/            渲染进程（dev 调试页）
│   └── shared/              IPC 通道常量
├── third_party/pi           Pi 子模块
├── electron.vite.config.ts  electron-vite 配置
└── package.json             Electron 项目配置
```

## 开发环境要求

- Node.js >= 22.0.0
- npm
- 可选：Bun（用于编译独立 Pi 二进制）

## 本地开发

1. 确保 Pi 子模块已初始化：
   ```bash
   git submodule update --init --recursive
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 准备 Pi 二进制及其资源。CI 会自动做这一步；本地可以：
   ```bash
   cd third_party/pi
   npm install --ignore-scripts
   npm run hydrate:model-data
   cd packages/coding-agent
   bun run build:binary
   cd ../../..
   # 复制产物到 resources/bin
   mkdir -p resources/bin
   cp third_party/pi/packages/coding-agent/dist/pi resources/bin/pi-linux-x64   # 或对应平台
   cp -r third_party/pi/packages/coding-agent/dist/theme resources/bin/theme
   cp -r third_party/pi/packages/coding-agent/dist/assets resources/bin/assets
   cp -r third_party/pi/packages/coding-agent/dist/export-html resources/bin/export-html
   ```

4. 启动开发模式：
   ```bash
   npm run dev
   ```

## 构建与打包

```bash
npm run build          # 编译主进程/preload/渲染进程
npm run dist           # 打包当前平台安装包
npm run dist:win       # Windows
npm run dist:linux:x64 # Linux x64
npm run dist:linux:arm64 # Linux arm64
```

## 热更新

Shell 启动时会读取 `CONTENT_MANIFEST_URL` 指向的 JSON 文件，拉取最新内容 ZIP 包到用户数据目录并解压加载。未配置或拉取失败时显示默认状态页。

`versions.json` 示例：

```json
{
  "content": {
    "latest": "1.2.0",
    "required": false,
    "packages": {
      "1.2.0": {
        "version": "1.2.0",
        "url": "https://example.com/content-1.2.0.zip",
        "hash": "sha256:..."
      }
    }
  }
}
```

## Pi Agent 状态检查

默认内容页会每 3 秒调用 `window.electronAPI.getAgentStatus()`，显示：

- Agent 二进制是否存在
- 进程是否在运行
- 与 Pi 的 JSON-RPC 是否连通（通过 `get_state` 作为 health 检查）
- 最后输出/错误

## 本地命令白名单

渲染进程通过 `electronAPI.executeCommand(command, args)` 调用主进程。目前允许的命令：`git`, `python3`, `python`, `node`, `pi`。

## CI 构建

`.github/workflows/build.yml` 会在 GitHub Actions 中构建：

- Linux x64 (`ubuntu-22.04`)
- Linux arm64 (`ubuntu-22.04-arm`)
- Windows (`windows-latest`)
- macOS (`macos-latest`)

每个 job 会先尝试构建 Pi 二进制（需要网络下载模型数据），再打包 Electron。Pi 构建失败不会阻塞 Electron 打包。

发布：推送 `v*` tag 时，`electron-builder` 会使用 `GH_TOKEN` 自动发布到 GitHub Releases。
