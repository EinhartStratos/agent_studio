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
│   ├── default-content/     默认内容页（服务状态页）
│   ├── config/              编译后应用配置文件
│   └── titlebar/            自定义标题栏页面
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

- Node.js >= 24.18.1
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

## 旧 CPU / 无 AVX2 兼容性

Bun 的默认 x64 编译产物依赖 AVX2 指令集，部分较老的 CPU（如 ZHAOXIN 开先 KX-U6780、部分 Intel Nehalem 及更早型号）不支持 AVX2，运行 `pi-linux-x64` 等二进制会出现 `Illegal instruction` / `SIGILL` 崩溃。

CI 中的 x64 构建（Linux、Windows、macOS Intel）会额外用 `bun build --compile --target=bun-<os>-x64-baseline` 重编译一份 baseline 版本，产物不再依赖 AVX2，可在更老的 CPU 上运行。ARM 平台（Apple Silicon、ARM64 Linux）不受影响。

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

## 应用配置

程序启动时会读取两套配置并合并：

1. **默认配置**：`resources/config/app-config.json`（打包后位于应用资源目录的 `config/app-config.json`）。这是出厂默认值，软件更新时会被替换。
2. **用户覆盖配置**：保存在用户数据目录的 `config/app-config.json`。通过远端网页接口或手动创建，优先级高于默认配置。

运行时网页可以通过 `window.electronAPI` 调用接口读取、修改配置。接口只写入用户数据目录，不会修改应用资源里的默认配置，因此软件更新不会覆盖用户的最新配置。未覆盖的字段会自动跟随打包时的最新默认值。

注意：使用 `npm run dev` 启动开发模式时，程序会优先加载 `src/renderer` 调试页；打包后的应用才会使用 `app-config.json` 中的首页配置。

### 配置文件示例

```json
{
  "homepage": {
    "type": "default",
    "url": "",
    "file": "",
    "title": "Agent Studio"
  },
  "pi": {
    "updateManifestUrl": "",
    "args": ["--mode", "rpc"]
  },
  "logo": "logo.ico"
}
```

### 首页配置参数

- `homepage.type`：首页加载类型
  - `default`（默认）：优先显示热更新内容包；没有内容包或热更新失败时显示默认状态页。
  - `url`：打开 `homepage.url` 指定的网页地址，例如 `https://example.com`。
  - `file`：打开 `homepage.file` 指定的本地 HTML 文件。
- `homepage.url`：当 `type` 为 `url` 时必填，支持 `http://` 或 `https://` 地址。
- `homepage.file`：当 `type` 为 `file` 时使用，可以是绝对路径，也可以是相对 `resources/config/` 目录的相对路径。例如把 `custom.html` 放在 `resources/config/` 下，并填写 `"file": "custom.html"`。
- `homepage.title`：窗口标题。不填写时默认为 `Agent Studio`。

### Pi Agent 配置参数

- `pi.updateManifestUrl`：Pi 更新清单地址。为空时使用环境变量 `PI_UPDATE_MANIFEST_URL`。
- `pi.args`：启动 Pi 时传入的命令行参数数组。默认是 `["--mode", "rpc"]`。

### Logo 配置

- `logo`：应用图标/Logo 文件路径。支持绝对路径，或相对 `resources/config/`（默认配置目录）和 `userData/config/`（用户运行时配置目录）的相对路径。

注意区分两个层面的 Logo：

1. **打包后的可执行文件图标**（.exe / .app 在文件管理器里显示的图标）必须在编译前通过 `build/icon.ico`（Windows）或 `build/icon.icns`（macOS）指定，并重新打包才能生效。
2. **窗口标题栏图标 / 任务栏图标 / Dock 图标**可以在运行时通过 `logo` 配置项修改，改完后重启应用生效（也可以在远端网页调用 `setAppConfig`/`updateAppConfig` 后由程序自动应用）。

### 扩展字段

配置不限制字段，`homepage` 和 `pi` 里可以添加任意自定义字段。程序只关心上面列出的已知字段，其它字段都会原样保留并合并。

### 配置示例

打开指定网页：

```json
{
  "homepage": {
    "type": "url",
    "url": "https://www.example.com",
    "title": "Example"
  }
}
```

加载本地自定义页面：

```json
{
  "homepage": {
    "type": "file",
    "file": "custom.html",
    "title": "Custom Page"
  }
}
```

自定义 Pi 启动命令行：

```json
{
  "pi": {
    "updateManifestUrl": "https://example.com/pi-latest.json",
    "args": ["--mode", "rpc", "--debug"]
  }
}
```

如果配置加载失败或目标不存在，程序会自动回退到默认状态页。

### 远端网页接口

远端网页可以通过 `window.electronAPI` 读取和修改配置：

```javascript
// 读取配置
const config = await window.electronAPI.getAppConfig();

// 完整替换配置
const result = await window.electronAPI.setAppConfig({
  homepage: { type: 'url', url: 'https://example.com', title: 'Example' },
  pi: { updateManifestUrl: 'https://example.com/pi-latest.json', args: ['--mode', 'rpc'] },
});

// 局部更新配置
const result2 = await window.electronAPI.updateAppConfig({
  homepage: { type: 'file', file: 'custom.html' },
});

// 重启 Pi 使新的命令行参数生效
await window.electronAPI.restartAgent();
```

`setAppConfig` 和 `updateAppConfig` 返回 `{ ok: true, config }` 或 `{ ok: false, error }`。它们会把改动写入用户数据目录，下次启动仍然有效。

## 菜单、标题栏与右键

窗口默认隐藏系统顶部菜单栏（Windows / Linux 上按 `Alt` 也不会显示）。程序使用自定义标题栏，样式参考 poi-master 使用的 `electron-react-titlebar`（GitHub Desktop 风格）：

- 标题取自配置文件 `homepage.title`。
- 标题栏显示 `agent connected`（绿色圆点）或 `agent disconnected`（红色圆点），每秒刷新。
- 左侧有「菜单」按钮，点击弹出原生菜单，可选择「重新加载」「退出」。
- 右侧是三大金刚按钮：最小化、最大化/还原、关闭，鼠标悬停有高亮效果（关闭为红色）。
- 标题栏区域可拖动窗口；按钮和菜单不可拖动。
- 标题栏和网页是两个独立视图：网页显示在标题栏下方的专属区域，不会互相遮挡，网页顶部的固定导航和滚动条都不受影响。

### 开发者工具

在配置文件中添加 `"devTools": true` 后，标题栏的「菜单」里会多出「开发者工具」选项，点击即可打开/关闭当前内容页的 DevTools。不再注册全局 F12 / Ctrl+Shift+I 快捷键，避免与内嵌网页冲突。

右键网页时会弹出上下文菜单，支持：

- 撤销 / 重做
- 剪切
- 复制
- 粘贴
- 全选

## Pi Agent 状态检查

默认内容页会每 3 秒调用 `window.electronAPI.getAgentStatus()`，显示：

- Agent 二进制是否存在
- 进程是否在运行
- 与 Pi 的 JSON-RPC 是否连通（通过 `get_state` 作为 health 检查）
- 最后输出/错误

## Pi Agent 自动更新

Shell 启动后，默认状态页每 30 秒检查一次 Pi 更新。检查地址优先读取 `resources/config/app-config.json` 中的 `pi.updateManifestUrl`，如果为空则使用环境变量 `PI_UPDATE_MANIFEST_URL`：

```bash
PI_UPDATE_MANIFEST_URL=https://example.com/pi-latest.json
```

接口应返回 JSON：

```json
{
  "version": "1.2.3",
  "url": "https://example.com/pi-1.2.3.tar.gz",
  "hash": "sha256:..."
}
```

- `version`：最新 Pi 版本号。
- `url`：压缩包下载地址，支持 `.tar.gz`、`.tgz`、`.tar`、`.zip`。可用 `{version}` 占位符。
- `hash`（可选）：SHA-256 校验值，带或不带 `sha256:` 前缀均可。

如果 `version` 与本地 `version` 文件不一致，状态页会显示 **Update Pi** 按钮。点击后：

1. 下载压缩包到 `userData/updates/`。
2. 校验 `hash`。
3. 解压到 `userData/agent-bin/`（优先于打包时内置的 `resources/bin/`）。
4. 写入新的 `version` 文件。
5. 停止并重启 Pi 进程。
6. 监控 Pi 连接状态，直到 `get_state` 返回成功。

更新失败时会自动恢复到之前的 `userData/agent-bin/`。

## Skill 调用

原生对话模式支持加载并调用当前工作区下的 skill。

- 输入框左侧有“技能”按钮，点击可弹出当前会话已加载的 skill 列表。
- 也可以直接在输入框中输入 `/skill:<name> <参数>`（或全角 `：`），按 `Enter` 发送，Pi 会展开该 skill 并执行。
- 在输入框中输入 `/` 或 `/skill:` 时，上方会自动弹出可用技能列表，支持上下方向键选择、回车确认或用鼠标点击；选择后会自动在输入框中插入 `/skill:<name> `，可继续输入参数。
- 选择 skill 后，命令会渲染成一个“技能芯片”显示在输入框左侧，和下方“智能体”按钮样式一致；输入框只保留参数部分。
- 当技能芯片存在且输入框为空时，按 `Backspace` 会一次性删除整个技能命令，而不是逐个字符删除。
- 点击技能芯片上的 `×` 也可以一键移除。
- 发送后，聊天记录中的 skill 消息会显示为「调用 `<name>` 技能」提示（类似智能体调用提示），下方只展示参数文本，不再把 `/skill:<name>` 以纯文本展示。
- 没有会话时，点击“技能”按钮会提示先发送消息以加载列表；调用 skill 时会自动创建会话。

skill 文件需要符合 Pi 的 skill 规范。当前应用会从以下位置加载：

1. **项目级**：`{workspace}/.pi/skills/<skill-name>/SKILL.md`
2. **应用级**：`%APPDATA%/agent-studio/.pi/agent/skills/<skill-name>/SKILL.md`（本应用使用 Electron 用户数据目录作为 agent 根目录）
3. **应用级 prompts**：`~/.pi/prompts/*.md` 和 `{workspace}/.pi/prompts/*.md`（作为扁平的 prompt/skill 文件）

建议每个 skill 使用独立目录，目录内放置 `SKILL.md` 并在 frontmatter 中声明 `name` 和 `description`。

### 智能体市场

原生模式左侧「智能体市场」支持上传自定义智能体：

- 智能体列表与上传的附件文件保存在应用级目录 `%APPDATA%/agent-studio/.pi/agent/marketplace/`，不再依赖当前工作区，切换工作区时不需要重新添加。
- 上传 `.zip` 包时，默认将其视为一个 skill，解压到应用级 `%APPDATA%/agent-studio/.pi/agent/skills/<skill-name>/`，可被 Pi 加载并在「技能」列表中出现。
- 上传其他文件（如 `.md`）时，文件保存在 `marketplace/files/` 下，若文件名为 `skill.md`，会在选择该智能体时作为系统提示注入对话。

> 注意：当前 SDK 没有直接暴露 `AgentSession.getSkills()` 或 `AgentSession.invokeSkill()` 等公共接口。实现中通过自己持有 `ResourceLoader`，调用 `resourceLoader.getSkills()` 获取列表，并通过 `agentSession.prompt('/skill:<name> <args>')` 触发 skill 展开。Shell 中 `NATIVE_LIST_SKILLS` 与 `NATIVE_INVOKE_SKILL` 两条 IPC 通道把技能能力桥接到渲染进程。

## 原生对话模式界面

原生模式（`homepage.type: "native"`）提供一个内置的桌面工作区界面：

- **左侧**：会话列表、工作区路径、健康状态和刷新/创建按钮。
- **中间主框**：使用标签页管理多个会话和文件预览。
  - 点击左侧会话列表中的会话，会在中间打开/切换到对应会话标签。
  - 会话标签显示该会话的时间线和消息输入框（`Timeline` + `Composer`）。
  - 点击右侧文件树中的文件，会在中间打开一个文件预览标签；点击 `Diff` 会打开 diff 标签。
  - 会话标签与文件标签可以同时存在，通过顶部标签栏切换。
  - 每个标签右侧有 `×` 按钮，可关闭标签。
  - 消息输入框右侧的发送按钮在模型生成过程中会变为红色「停止」按钮，点击即可取消当前会话的生成；ACP 模式下通过 `NATIVE_CANCEL_RUN` 转发给 `pi-acp`，SDK 模式下直接调用 `AgentSession.abort()`。
- **右侧**：仅保留文件树，不再显示文件预览。

### 会话自动命名

新创建会话后，第一次 AI 回复结束时会调用当前配置的模型，根据用户第一条消息生成一个不超过十个字的简短名称。名称会持久化到：

- 会话 `.jsonl` 文件（通过 `SessionManager.appendSessionInfo`）。
- SQLite 会话索引（标题字段）。
- 渲染进程的会话列表和标签标题。

如果模型调用失败，会话将回退到默认名称（`<工作区名> <日期> #<序号>`）。

## Office 文档原生工具

在 `native` 模式下，Pi Agent 会自动注册 3 个原生工具，用于读写常见 Office 文件：

- `read_office`：读取 `.docx`、`.xlsx`（或 `.xls`）、`.pptx`，把文字内容转换为 Markdown。
- `write_docx`：把 Markdown 内容写回 `.docx`。
- `write_xlsx`：把 JSON 二维数组或 Markdown 表格写回 `.xlsx`。

### 给 AI 使用

在 native 模式下打开工作区后，AI 在会话中会自动识别这些工具。你可以直接让 AI 做类似操作：

```text
把 report.docx 的内容转成 markdown
把这段 markdown 表格写入 data.xlsx
```

### 工具参数

- `read_office`
  - `path`：要读取的文件路径（相对工作区根目录或绝对路径）。
- `write_docx`
  - `path`：要写入的 `.docx` 文件路径。
  - `content`：Markdown 内容字符串。
- `write_xlsx`
  - `path`：要写入的 `.xlsx` 文件路径。
  - `content`：JSON 二维数组字符串，例如 `["A","B"],[1,2]`，或 Markdown 表格。
  - `sheetName`（可选）：工作表名称，默认 `Sheet1`。


## 相关文档

- 开发记录、修复历史、实现说明与 CI/构建环境：[docs/开发记录.md](docs/开发记录.md)
- 当前设计问题、风险优先级与分阶段重构路线：[docs/项目设计问题与重构建议.md](docs/项目设计问题与重构建议.md)