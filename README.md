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
│   ├── agent-tools/         Pi 依赖的外部工具（rg、fd）
│   │   ├── rg / rg.exe
│   │   └── fd / fd.exe
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

4. （可选）下载 Pi 依赖的 `rg`、`fd` 工具到 `resources/agent-tools/`，避免内网环境运行时下载失败：
   ```bash
   mkdir -p resources/agent-tools
   # Linux x64 示例（其他平台见 .github/workflows/build.yml）
   FD_VERSION=10.4.2
   RG_VERSION=15.2.0
   curl -L -o /tmp/fd.tar.gz "https://github.com/sharkdp/fd/releases/download/v${FD_VERSION}/fd-v${FD_VERSION}-x86_64-unknown-linux-musl.tar.gz"
   curl -L -o /tmp/rg.tar.gz "https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz"
   tar -xzf /tmp/fd.tar.gz -C /tmp && find /tmp -name 'fd' -type f -exec cp {} resources/agent-tools/ \;
   tar -xzf /tmp/rg.tar.gz -C /tmp && find /tmp -name 'rg' -type f -exec cp {} resources/agent-tools/ \;
   chmod +x resources/agent-tools/fd resources/agent-tools/rg
   ```

5. 启动开发模式：
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
- macOS Apple Silicon (`macos-latest`)
- macOS Intel x64 (`macos-13`)

每个 job 会做：

1. 下载对应平台的 `rg`（ripgrep）和 `fd` 预编译二进制到 `resources/agent-tools/`，避免内网运行时下载失败。
2. 构建 Pi 二进制（需要网络下载模型数据）及其运行时资源到 `resources/bin/`。
3. 编译并打包 Electron。

Pi 或工具下载失败不会阻塞 Electron 打包。

发布：推送 `v*` tag 时，`electron-builder` 会使用 `GH_TOKEN` 自动发布到 GitHub Releases。

### GLIBC 2.28 兼容性验证

Linux x64 产物会在 `rockylinux/rockylinux:8` 容器（glibc 2.28）中做一次符号检查：

- 用 `objdump -T` 检查 Electron 主程序、`.so`、Pi 二进制、`rg`、`fd` 是否包含 `GLIBC_2.29` 或更高版本的符号。
- 如果检查失败，CI 会报错，说明当前 Electron/Pi/工具链需要更高版本的 glibc。

本地也可以手动验证：

```bash
# 在 Rocky Linux 8 / AlmaLinux 8 / CentOS Stream 8 等 glibc 2.28 环境中
dnf install -y binutils
tar -xzf 'Agent Studio-*.tar.gz'
cd 'Agent Studio-*'
objdump -T 'Agent Studio' | grep -E 'GLIBC_2\.(29|3[0-9])'
objdump -T resources/bin/pi-linux-x64 | grep -E 'GLIBC_2\.(29|3[0-9])'
```

没有输出即表示兼容 glibc 2.28。若出现 `GLIBC_2.29` 等符号，需要降级 Electron 或改用更新的系统运行。
