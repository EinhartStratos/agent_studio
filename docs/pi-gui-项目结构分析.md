# pi-gui 项目结构分析

## 1. 项目概述

**pi-gui** 是一个基于 [pi](https://github.com/earendil-works/pi)（AI 编程代理）的 **Codex 风格桌面 GUI 应用**，使用 Electron + React + TypeScript 构建。项目采用 pnpm monorepo 架构，目标是为 `pi` 命令行代理提供完整的桌面体验，包括多会话管理、工作区导航、差异对比、终端集成等功能。

- **名称**: `pi-gui`
- **版本**: `0.1.0-beta.33`
- **许可证**: MIT
- **包管理器**: pnpm@10.25.0

---

## 2. 目录总览

```
pi-gui-0.1.0-beta.33/
├── apps/
│   ├── desktop/          # Electron 桌面应用（核心）
│   └── website/          # 官网/文档站点（Next.js）
├── packages/
│   ├── pi-sdk-driver/    # pi 运行时桥接层（SDK 驱动核心）
│   ├── session-driver/   # 会话驱动抽象接口（类型契约）
│   └── catalogs/         # 工作区/会话目录存储
├── video/                # 视频录制/演示工具
├── docs/                 # 文档与媒体资源
├── plans/                # 项目计划文档
├── scripts/              # 构建/发布脚本
├── tools/                # 辅助工具（pnpm 执行器）
├── patches/              # 上游依赖补丁
└── .github/workflows/    # CI/CD 工作流
```

---

## 3. 架构分层

```
┌─────────────────────────────────────────────────────┐
│                    Electron Renderer                │
│  apps/desktop/src/  (React UI: 时间线、编辑器、侧栏) │
├─────────────────────────────────────────────────────┤
│              Electron Preload (IPC Bridge)           │
│  apps/desktop/electron/preload.ts                    │
├─────────────────────────────────────────────────────┤
│              Electron Main Process                   │
│  apps/desktop/electron/                              │
│  ├── main.ts            (IPC注册、窗口管理)          │
│  ├── app-store.ts       (状态管理、驱动协调)         │
│  ├── app-store-*.ts     (按功能拆分的Store模块)      │
│  ├── terminal-service.ts (终端服务)                  │
│  ├── notification-*.ts   (通知系统)                  │
│  └── orchestration-*.ts  (子会话编排)                │
├─────────────────────────────────────────────────────┤
│              SDK 驱动层 (packages/pi-sdk-driver/)     │
│  ├── PiSdkDriver (实现SessionDriver接口)             │
│  ├── SessionSupervisor (会话生命周期管理)            │
│  └── RuntimeSupervisor (运行时资源: 模型/技能/扩展)  │
├─────────────────────────────────────────────────────┤
│          抽象接口层 (packages/session-driver/)        │
│  SessionDriver接口定义                                │
├─────────────────────────────────────────────────────┤
│         pi 核心 (@earendil-works/pi-coding-agent)    │
│  AuthStorage / ModelRegistry / SessionManager / ...  │
└─────────────────────────────────────────────────────┘
```

---

## 4. 核心模块详细分析

### 4.1 `apps/desktop/` — Electron 桌面应用

| 子目录/文件 | 职责 |
|---|---|
| `electron/main.ts` | Electron 主进程入口，IPC 注册，窗口管理，菜单构建 |
| `electron/preload.ts` | 预加载脚本，`contextBridge` 暴露 API 给渲染进程 |
| `electron/app-store.ts` | 核心状态管理，协调 PiSdkDriver 与 UI 状态 |
| `electron/app-store-composer.ts` | 消息编写器逻辑（发送、取消、队列消息） |
| `electron/app-store-workspace.ts` | 工作区增删改查 |
| `electron/app-store-worktree.ts` | Git worktree 管理 |
| `electron/app-store-session-state.ts` | 会话状态（扩展UI状态、命令缓存） |
| `electron/app-store-timeline.ts` | 会话时间线/转录管理 |
| `electron/app-store-orchestration.ts` | 子会话编排 |
| `electron/app-store-diff.ts` | Git 差异对比 |
| `electron/app-store-files.ts` | 工作区文件浏览 |
| `electron/app-store-persistence.ts` | 持久化层 |
| `electron/terminal-service.ts` | PTY 终端服务 |
| `electron/notification-manager.ts` | 通知管理 |
| `electron/theme-manager.ts` | 主题管理 |
| `electron/orchestration-runtime.ts` | 编排运行时扩展 |
| `electron/session-state-map.ts` | 会话 UI 状态映射 |
| `electron/json-file-store.ts` | JSON 文件持久化 |
| `electron/atomic-file-write.ts` | 原子文件写入 |
| `src/` | React 渲染器（UI 组件） |

#### Electron 进程架构

```
┌──────────────────────────────────────────┐
│              Main Process                │
│  (app-store.ts + main.ts + 子模块)        │
│  持有 PiSdkDriver 实例                    │
└──────────────┬───────────────────────────┘
               │ IPC (ipcMain/ipcRenderer)
┌──────────────┴───────────────────────────┐
│           Preload (contextBridge)        │
│  preload.ts: window.piApp.*  API 暴露     │
└──────────────┬───────────────────────────┘
               │
┌──────────────┴───────────────────────────┐
│         Renderer (React)                 │
│  App.tsx → sidebar, timeline, composer   │
└──────────────────────────────────────────┘
```

---

### 4.2 `packages/pi-sdk-driver/` — pi SDK 驱动层

这是 GUI 与 pi 之间的核心桥接层，将所有 pi 原生能力封装为 `SessionDriver` 接口的实现。

| 文件 | 职责 |
|---|---|
| `index.ts` | 包导出入口 |
| `pi-sdk-driver.ts` | **核心类 `PiSdkDriver`**，实现 `SessionDriver` 接口 |
| `session-supervisor.ts` | **`SessionSupervisor`**：会话生命周期管理（创建/打开/归档/分叉/消息） |
| `runtime-supervisor.ts` | **`RuntimeSupervisor`**：运行时资源管理（模型/提供商/技能/扩展/认证） |
| `runtime-deps.ts` | pi 运行时依赖初始化（AuthStorage、ModelRegistry） |
| `json-catalog-store.ts` | 工作区和会话目录的 JSON 持久化 |
| `session-schema.ts` | 会话 schema 版本检测 |
| `session-lease.ts` | 会话文件租约（防止并发写入冲突） |
| `session-supervisor-utils.ts` | 会话管理工具函数 |
| `extension-ui-state.ts` | 扩展 UI 状态管理 |
| `thread-title-generator.ts` | 线程标题生成 |
| `transcript.ts` | 转录数据类型 |
| `custom-provider-store.ts` | 自定义模型提供商存储 |
| `npm-package-fallback.ts` | npm 包回退策略 |

---

### 4.3 `packages/session-driver/` — 会话驱动抽象层

定义纯粹的 TypeScript 接口，不包含任何 pi 或 GUI 的实现细节。

| 文件 | 职责 |
|---|---|
| `index.ts` | 包导出入口 |
| `types.ts` | **核心类型定义**：`SessionDriver` 接口、事件类型、快照类型 |
| `runtime-types.ts` | 运行时类型定义（模型/技能/扩展/提供商） |

---

### 4.4 `packages/catalogs/` — 目录存储

| 文件 | 职责 |
|---|---|
| `index.ts` | 包导出入口 |
| `storage.ts` | 目录存储容器 |
| `types.ts` | 目录类型定义 |

---

## 5. 数据流

```
用户操作 (Renderer React)
    │
    ▼
window.piApp.createSession(...)  ← preload 暴露的 API
    │
    ▼
IPC → main.ts → DesktopAppStore → PiSdkDriver
    │                                    │
    │                          ┌─────────┴───────────┐
    │                          │ SessionSupervisor   │ → SessionManager
    │                          │ RuntimeSupervisor   │ → AuthStorage/ModelRegistry
    │                          └─────────────────────┘
    │                                    │
    ▼                                    ▼
状态变更 ← DesktopAppState ←── 会话事件回调
    │
    ▼
IPC → Renderer 重渲染
```

---

## 6. 依赖关系

```
website               desktop (Electron)
                          │
                ┌─────────┼──────────┐
                │         │          │
           pi-sdk-driver  │    @earendil-works/
                │         │    pi-coding-agent
           session-driver │    (pi 核心包)
                │         │
            catalogs      │
                │         │
        (类型契约)    (运行时实现)
```

关键依赖版本：
- `@earendil-works/pi-coding-agent@^0.80.6` — pi 核心运行时
- `electron@37.10.3` — Electron 框架
- `react@^19.1.0` — UI 渲染
- `@anthropic-ai/sdk@0.91.1` — Anthropic API
- `openai@6.26.0` — OpenAI API

---

## 7. 测试架构

项目使用 Playwright 进行端到端测试，分为三个测试层次：

| 测试套件 | 位置 | 说明 |
|---|---|---|
| `core` | `tests/core/` | 核心功能（导航、归档、持久化） |
| `live` | `tests/live/` | 实时功能（通知、工具调用、扩展） |
| `native` | `tests/native/` | 原生功能（打开文件夹、粘贴、图片附件） |
| `production` | `tests/production/` | 打包后烟雾测试 |

---

## 8. 技术栈总结

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 37 |
| UI 框架 | React 19 |
| 构建工具 | electron-vite, Vite 6 |
| 类型系统 | TypeScript 5.9 |
| 包管理 | pnpm workspace |
| 测试 | Playwright |
| AI 核心 | `@earendil-works/pi-coding-agent` (pi) |
| AI API | Anthropic SDK, OpenAI SDK, AWS Bedrock, Google GenAI, Mistral |
| 终端 | node-pty + xterm.js |
| 主题 | 自定义 ThemeManager |
| 多窗口 | Electron BrowserWindow + 状态同步 |
