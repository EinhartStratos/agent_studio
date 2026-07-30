# pi-gui vs pi-web vs pi-acp：基于 pi 构建 GUI Agent 的对比分析

> 分析日期：2026-07-30

## 一、三者定位速览

| 维度 | **pi-gui** | **pi-web / pi-web-chat** | **pi-acp** |
|---|---|---|---|
| **本质** | 完整的桌面 GUI 应用 | Web 版 UI 界面 | 协议适配器（非 GUI） |
| **运行环境** | Electron 桌面应用 | 浏览器（localhost） | stdio 子进程 |
| **与 pi 的关系** | UI shell，通过 SDK 驱动 pi | pi 扩展，通过 SDK 驱动 pi | 协议翻译层（ACP ↔ pi RPC） |
| **主要作者** | Matthew Lam | preinpost / ashwin-pc / 社区多人 | Attamusc / victor-software-house |
| **当前版本** | v0.1.0-beta.32 | pi-web-chat v0.1.13 | v0.0.32（社区版） |
| **平台** | macOS + Linux（Windows 有打包脚本） | 全平台（浏览器） | 全平台（Node.js） |

---

## 二、架构对比

### pi-gui — 三层 Electron 架构

```
Renderer (React UI)  ←──IPC──→  Preload（窄桥）  ←──→  Main (Node.js)
                                    ↕
                          pi-sdk-driver（薄适配层）
                                    ↕
                     @earendil-works/pi-coding-agent
```

- **优势**：类型安全的 IPC 层，Renderer 无权直接访问 Node API（安全），有完整的主进程能力（PTY 终端、系统通知、原生文件对话框）
- **代价**：Electron 体积大（~150MB+），三层架构调试复杂

### pi-web / pi-web-chat — WebSocket + React SPA

```
Browser (React 19 + Vite)  ←──WebSocket──→  Node.js Server  ←──SDK──→  pi
```

- **优势**：标准 Web 技术栈，轻量，跨平台，移动端友好
- **代价**：受浏览器沙箱限制，无原生系统能力

### pi-acp — 协议翻译层

```
Editor (Zed/VS Code)  ←──ACP JSON-RPC over stdio──→  pi-acp  ←──pi RPC──→  pi --mode rpc
```

- **优势**：标准化协议，可嵌入任何支持 ACP 的编辑器
- **代价**：**本身不是 GUI**，需要在此基础上再构建整个 UI

---

## 三、功能对比矩阵

| 功能 | pi-gui | pi-web-chat | pi-acp |
|---|---|---|---|
| **会话时间线** | ✅ 完整的 thread timeline | ✅ 消息列表 | ❌ 依赖编辑器 |
| **Git Worktree 隔离** | ✅ 每线程独立 worktree | ❌ | ❌ |
| **多 Agent 编排** | ✅ 父子线程协调（`create_child_thread`、`list_threads`、`send_message_to_thread`） | ❌ | ❌ |
| **集成终端 (PTY)** | ✅ `node-pty` 真终端 | ⚠️ 仅 Web 伪终端 | ❌ 依赖编辑器 |
| **内联 Diff 查看器** | ✅ 专用 Diff 面板（⌘/Ctrl+D） | ⚠️ 部分社区实现有 | ✅ write hook → 编辑器 buffer 更新 |
| **@-mention 文件** | ✅ | ❌ | ❌ |
| **图片附件（粘贴/拖拽）** | ✅ 剪贴板 + 拖拽 | ✅ 文件选择 + 剪贴板 | ✅ base64 内联图片 |
| **原生通知** | ✅ OS 级通知 | ❌ | ❌ |
| **会话归档** | ✅ | ✅ | ✅ |
| **Skills/扩展管理** | ✅ 专用视图 | ❌ | ❌ |
| **多模型/Provider** | ✅ 完整设置面板（OAuth + API Key） | ✅ 模型切换 | ✅ 配置选项 |
| **自定义端点** | ✅ | ⚠️ 有限 | ❌ |
| **主题切换** | ✅ 明/暗 + 多个预设主题 | ✅ 明/暗/跟随系统 | ❌ 依赖编辑器 |
| **移动端支持** | ❌ 桌面专用 | ✅ 移动端优先（safe-area、dvh 布局） | ❌ |
| **Computer Use** | ⚠️ 需额外 `computer-use-mcp` | ❌ | ❌ |
| **编辑器集成** | ❌ 独立应用 | ❌ 独立 Web 页 | ✅ Zed 原生集成 |
| **流式输出** | ✅ | ✅ 文本 + thinking 分离 | ✅ 文本 + thinking 分离 |
| **Tool Call 展示** | ✅ 可折叠详情 | ✅ 可展开结果 | ✅ 状态跟踪（pending → in_progress → completed/failed） |
| **Plan 推断** | ❌ | ❌ | ✅ 状态机推断（Analyzing/Implementing/Verifying/Responding） |
| **权限桥接** | ❌ | ❌ | ✅ 工具审批 → 编辑器对话框 |

---

## 四、作为 GUI Agent 基础的优劣分析

### 🥇 pi-gui — 推荐作为重型桌面 GUI Agent 的基础

#### 优势

1. **已经是完整产品** — 不需要从零搭建 UI 框架、会话管理、IPC 通信。代码结构清晰，`apps/desktop/` 下 React UI + Electron 主进程分工明确。

2. **`pi-sdk-driver` 抽象层设计精良** — `packages/pi-sdk-driver/src/pi-sdk-driver.ts` 将 pi SDK 包装为 `SessionDriver` 接口（`createSession`、`forkSession`、`sendUserMessage`、`subscribe` 等 30+ 方法），是可直接复用的干净抽象。

   ```typescript
   // pi-sdk-driver 暴露的核心接口
   export class PiSdkDriver implements SessionDriver {
     createSession(workspace, options?) → Promise<SessionSnapshot>
     forkSession(sourceRef, options)      → Promise<ForkSessionResult>
     sendUserMessage(sessionRef, input)   → Promise<void>
     subscribe(sessionRef, listener)      → Unsubscribe
     // ... 30+ 方法
   }
   ```

3. **多 Agent 编排能力内建** — `orchestration-runtime.ts` 实现了完整的父子线程协调机制：
   - `create_child_thread` — 从 orchestrator 线程派生子 worker
   - `list_threads` — 查看所有线程状态
   - `read_thread` — 读取子线程对话记录
   - `send_message_to_thread` — 向子线程发送指令
   - Supervision gate 机制（`continue` / `wake` / `stop`）

4. **Git Worktree 隔离** — `worktree-manager.ts` 为每个线程创建独立 git worktree，并行 Agent 任务互不干扰。这是多 Agent 并发工作的关键基础设施。

5. **真 PTY 终端** — 如果 GUI Agent 需要执行 shell 命令并展示交互式输出，`node-pty` + `terminal-service.ts` + xterm.js 的组合是 Web 方案无法比拟的。

6. **类型安全的 IPC** — `apps/desktop/src/ipc.ts` 使用 `desktopIpc` 定义了完整的主进程 ↔ 渲染进程通信协议，扩展新功能时类型检查能防止大量错误。

7. **架构纪律好** — main/preload/renderer 三层严格分离，preload 作为窄桥只暴露必要的 API，Renderer 无 Node.js 访问权限。安全模型清晰。

8. **验证体系完善** — Playwright + Electron E2E 测试（core / live / native 三个 lane），类型检查全覆盖。

#### 劣势

1. **Electron 体积大** — 打包后 ~150-200MB，冷启动慢
2. **平台限制** — 正式发布仅 macOS + Linux，Windows 有打包脚本但未正式支持
3. **学习曲线** — 三层架构需要理解 Electron 的进程模型
4. **不跨移动端** — 桌面专用，无法在手机浏览器使用
5. **依赖 Node.js 原生模块** — `node-pty` 等需要编译，跨平台打包有摩擦

---

### 🥈 pi-web-chat — 推荐作为轻量跨平台 GUI Agent 的基础

#### 优势

1. **全平台 + 移动端** — 浏览器即客户端，零安装，天然跨平台
2. **技术栈现代且简单** — React 19 + Vite + Tailwind CSS v4 + WebSocket，比 Electron 轻一个数量级
3. **部署极简** — `pi --web` 一键启动，默认 `localhost:3141`
4. **代码量小** — 整个前端 + 后端几千行，容易理解和修改
5. **与 pi CLI 共享 session** — 数据和 pi 命令行互通，不锁数据格式
6. **移动端体验好** — safe-area、dvh 布局、触摸优化

#### 劣势

1. **无原生系统能力** — 没有 PTY 终端、系统通知、原生文件对话框
2. **浏览器沙箱限制** — 无法直接操作文件系统、spawn 进程
3. **无 Git Worktree 隔离** — 并行 Agent 任务会相互冲突
4. **无多 Agent 编排** — 只能单会话操作
5. **无内建 Computer Use 能力** — 浏览器无法控制桌面
6. **安全模型弱** — 默认无认证，仅绑定 loopback，需额外配置 Tailscale/SSH 隧道

---

### 🥉 pi-acp — 仅适合"嵌入已有编辑器"场景

#### 优势

1. **标准化 ACP 协议** — 与 Zed 编辑器无缝集成，未来可能支持更多 ACP 兼容编辑器
2. **极轻量** — 本身只是一个翻译层，代码量小
3. **Rust 实现性能好** — `@rivet-dev/pi-acp` 启动 19ms vs JS 版 104ms，内存 3.7 MiB vs 91.5 MiB
4. **关注点分离清晰** — 协议层与 UI 层完全解耦
5. **Plan 推断** — 内建状态机推断 Agent 当前阶段（Analyzing/Implementing/Verifying/Responding）

#### 劣势

1. **本身不是 GUI** — 需要自己构建整个 UI 层，工作量大
2. **每 session 一个 pi 子进程** — 大量并发时资源消耗高
3. **ACP 协议表达能力有限** — 不如直接用 pi SDK 灵活
4. **社区分散** — 存在多个 fork（Attamusc、svkozak、victor-software-house），发展方向不一
5. **依赖编辑器实现** — 最终体验受限于编辑器的 ACP 支持程度

---

## 五、技术栈对比

| 层级 | pi-gui | pi-web-chat | pi-acp |
|---|---|---|---|
| **UI 框架** | React + Electron | React 19 + Vite | 无（协议层） |
| **样式** | 自定义 CSS + theme presets | Tailwind CSS v4 | N/A |
| **状态管理** | AppStore（主进程集中式） | TanStack Query | N/A |
| **通信** | Electron IPC（typed） | WebSocket | JSON-RPC 2.0 over stdio |
| **构建** | electron-vite | Vite | tsc / esbuild |
| **测试** | Playwright + Node test | 无公开测试 | Vitest |
| **包管理** | pnpm workspace | npm | npm |
| **pi 版本依赖** | `@earendil-works/pi-coding-agent` ^0.80.6 | pi SDK（版本跟随 pi CLI） | pi SDK + ACP SDK ^0.22.1 |

---

## 六、生态与社区

| 维度 | pi-gui | pi-web-chat | pi-acp |
|---|---|---|---|
| **GitHub Stars** | 独立仓库 | pi 主仓库 46,000+ | ~几十（各 fork） |
| **维护活跃度** | 活跃（beta 迭代中） | 活跃（2026-07-29 最新发布） | 中低 |
| **社区贡献者** | 少量核心贡献者 | 多人（preinpost、ashwin-pc、firstpick 等） | 分散在多个 fork |
| **文档质量** | README + CONTRIBUTING + AGENTS.md | README | README + PRD |
| **发布渠道** | GitHub Releases + Homebrew | npm | npm |

---

## 七、最终推荐

| 你的目标 | 推荐方案 | 核心理由 |
|---|---|---|
| **桌面端重型 GUI Agent**（类似 Codex / Cursor 的独立应用） | **🥇 pi-gui** | 完整架构、系统能力最强、多 Agent 编排内建、Git Worktree 隔离 |
| **轻量 Web Agent**（浏览器即用、跨设备） | **🥈 pi-web-chat** | 最轻量、部署快、移动端友好、代码量小易修改 |
| **IDE 插件型 Agent**（嵌入 VS Code / Zed） | **🥉 pi-acp** | 标准 ACP 协议、编辑器生态兼容 |
| **Computer Use Agent**（操控桌面 / 浏览器） | **🥇 pi-gui** + `computer-use-mcp` | 有原生桌面能力 + 已有 MCP 集成路线 |
| **移动端优先的 Agent** | **🥈 pi-web-chat** | 唯一支持移动端的方案 |
| **多 Agent 协作系统** | **🥇 pi-gui** | 唯一内建多 Agent 编排的方案 |

---

## 八、结论

**如果你要做的是一个功能完整、面向生产力的 GUI Agent，pi-gui 是最佳起点。** 它的核心价值在于：

1. **`pi-sdk-driver`** — 可直接复用的、类型安全的 pi SDK 抽象层
2. **多 Agent 编排框架** — 父子线程 + supervision gate 机制
3. **Git Worktree 隔离** — 并行 Agent 安全的文件系统隔离
4. **PTY 终端 + Diff 面板** — 桌面级开发体验的关键组件
5. **类型安全的 IPC 架构** — 扩展新功能时有完整的类型保护

pi-web-chat 和 pi-acp 在各自的细分场景（Web 轻量访问、编辑器集成）有价值，但它们在系统集成深度、多 Agent 编排、文件系统隔离等关键能力上的空白，使其不适合作为"重型 GUI Agent"的基础。

pi-gui 的劣势（Electron 体积、平台限制）可以通过技术优化（如切换到 Tauri、完善 Windows 支持）逐步解决，但它的架构基础和系统集成能力是另外两个方案无法替代的。

---

## 参考资料

- [pi-gui GitHub](https://github.com/minghinmatthewlam/pi-gui)
- [pi (earendil-works) GitHub](https://github.com/earendil-works/pi) — pi 主仓库（46,000+ stars）
- [pi-web-chat npm](https://www.npmjs.com/package/pi-web-chat)
- [pi-acp (Attamusc) GitHub](https://github.com/Attamusc/pi-acp)
- [pi-acp (victor-software-house) GitHub](https://github.com/victor-software-house/pi-acp)
- [computer-use-mcp GitHub](https://github.com/minghinmatthewlam/computer-use-mcp)
- [@earendil-works/pi-coding-agent npm](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
