# pi-acp 与 pi-gui：面向 Electron Agent 服务的能力分析

> 调研日期：2026-07-28  
> 调研对象：`pi-acp 0.0.31`、`pi-gui main`、ACP v1、Pi RPC  
> 目标范围：只分析 Agent 服务相关能力，不把 Electron UI、工作区界面、Diff 面板等产品功能混入服务职责。

## 0. 结论摘要

`pi-acp` 和 `pi-gui` 不是同一层级的替代品：

```text
pi-acp
= ACP 标准协议适配器
= ACP JSON-RPC 2.0 ↔ Pi JSONL RPC
= 面向任意 ACP Client 的跨进程接口

pi-gui
= 完整 Electron 桌面产品
= 内部使用 SessionDriver 隔离 Renderer 与 Pi SDK
= SessionDriver 是 TypeScript 内部接口，不是独立服务协议
```

因此，不能得出“pi-gui 功能更多，所以应当用 pi-gui 替代 pi-acp”的结论。

从 Agent 服务角度看，`pi-acp` 已经解决了：

- ACP 初始化和能力协商；
- 会话创建、加载、列举、删除；
- Prompt、取消、模型和 Thinking 设置；
- Assistant 流式消息；
- Tool Call/Tool Update 映射；
- Edit Diff 和文件位置映射；
- Pi Session 与 ACP Session ID 的关联；
- Skills、Prompt Commands 和部分内置命令暴露；
- Terminal Auth。

但是，它没有解决桌面 Agent Host 所需的四个核心问题：

1. 面向桌面应用的 Session Supervisor 和稳定快照；
2. 可编辑、可恢复、语义明确的消息队列；
3. Host 控制的工具执行、权限和 MCP 边界；
4. 面向产品恢复的稳定事件模型，而不只是 ACP/Pi 事件翻译。

对于当前目标，合理结构不是在 `pi-acp` 与 `pi-gui` 之间二选一，而是：

```text
Electron Renderer
        │
        │ typed IPC
        ▼
Desktop Host
        │
        │ 稳定 Agent Service Contract
        ▼
Agent Backend Driver
        │
        ├── 当前：Pi SDK Driver
        └── 将来：其他 Agent Driver
```

ACP 可以作为服务契约的重要参考，但不应把当前 `pi-acp` 的全部行为直接当作最终 Agent Service Contract。

## 文档目录

1. [相比 pi-gui，pi-acp 在 Agent 服务相关能力上缺什么](#1-相比-pi-guipi-acp-在-agent-服务相关能力上缺什么)
2. [pi-acp 现有功能及具体接口代码](#2-pi-acp-现有功能及具体接口代码)
3. [完整对比](#3-完整对比)
4. [对当前方案的建议](#4-对当前方案的建议)
5. [最终判断](#5-最终判断)
6. [参考资料](#6-参考资料)

---

# 1. 相比 pi-gui，pi-acp 在 Agent 服务相关能力上缺什么

## 1.1 缺少桌面级 Session Supervisor

pi-gui 的 `pi-sdk-driver` 并不只是调用 `prompt()`。它内部包含：

- `SessionSupervisor`
- `RuntimeSupervisor`
- Session lease
- Session schema
- Transcript 解析
- Runtime 依赖创建
- Session 创建、重新打开、重载和关闭

pi-gui 的 `SessionDriver` 提供：

```ts
interface SessionDriver {
  createSession(
    workspace: WorkspaceRef,
    options?: CreateSessionOptions,
  ): Promise<SessionSnapshot>;

  openSession(sessionRef: SessionRef): Promise<SessionSnapshot>;

  sendUserMessage(
    sessionRef: SessionRef,
    input: SessionMessageInput,
  ): Promise<void>;

  cancelCurrentRun(sessionRef: SessionRef): Promise<void>;
  reloadSession(sessionRef: SessionRef): Promise<void>;
  closeSession(sessionRef: SessionRef): Promise<void>;

  subscribe(
    sessionRef: SessionRef,
    listener: SessionEventListener,
  ): Unsubscribe;
}
```

pi-acp 主要负责：

```text
ACP Request
    ↓
协议转换
    ↓
Pi RPC Request
```

它有基本的 Pi 子进程和 Session 管理，但没有形成面向 Electron 产品的 Host 状态模型，缺少：

- Renderer 重载后的稳定重绑定；
- 可供 UI 随时读取的完整 Session Snapshot；
- Session 与 Workspace 的产品级关联；
- 多个打开会话的产品状态管理；
- 明确的 Session lease；
- 主进程重启后的运行状态恢复；
- Agent 异常退出后的统一状态迁移。

### 判断

`pi-acp` 可以启动和控制 Pi Session，但不能代替 Electron Main 中的 Session Host。

---

## 1.2 缺少稳定、完整的 Session Snapshot

pi-gui 定义的 Session 快照包括：

```ts
interface SessionSnapshot {
  ref: SessionRef;
  workspace: WorkspaceRef;
  title: string;
  status: "idle" | "running" | "failed";
  updatedAt: string;
  archivedAt?: string;
  preview?: string;
  config?: SessionConfig;
  runningRunId?: string;
  queuedMessages?: readonly SessionQueuedMessage[];
}
```

这允许 Electron Renderer 在以下场景中直接恢复状态：

- 页面刷新；
- BrowserWindow 重建；
- IPC 暂时断开；
- Session 从后台重新打开；
- 从运行页切走后再返回。

pi-acp 的 ACP Session 返回：

- `sessionId`
- 模型和模式配置；
- 少量 `_meta.piAcp`；
- 通过 `session/update` 发送的增量事件。

它没有提供一个等价于 `SessionSnapshot` 的产品状态接口。

### 实际风险

如果 Electron 完全依靠 `session/update`：

- 客户端必须自己累计事件；
- 丢失事件后难以修复；
- Renderer 重载后需要重新播放历史；
- 队列状态主要依赖 `_meta`；
- 当前 Run、错误和关闭状态缺少统一快照。

### 判断

Agent 服务至少需要补充：

```ts
getSessionSnapshot(sessionId: string): Promise<AgentSessionSnapshot>;
```

这不是产品控制面，而是服务状态恢复能力。

---

## 1.3 缺少可编辑、可恢复的消息队列

pi-gui 为每条排队消息建立稳定数据结构：

```ts
type SessionMessageDeliveryMode = "steer" | "followUp";

interface SessionQueuedMessage {
  id: string;
  mode: SessionMessageDeliveryMode;
  text: string;
  attachments?: readonly SessionAttachment[];
  createdAt: string;
  updatedAt: string;
}
```

并提供：

```ts
replaceQueuedMessages(
  sessionRef: SessionRef,
  messages: readonly SessionQueuedMessage[],
): Promise<void>;
```

这使客户端可以：

- 显示完整待发送队列；
- 区分 `steer` 和 `followUp`；
- 修改或删除排队消息；
- 调整消息顺序；
- 保留附件；
- 在 Renderer 重载后恢复队列。

pi-acp 内部确实有：

```ts
type QueuedTurn = {
  message: string;
  images: unknown[];
  resolve: (reason: StopReason) => void;
  reject: (err: unknown) => void;
};

private readonly turnQueue: QueuedTurn[] = [];
```

但是对外只通过以下形式暴露队列状态：

```ts
{
  sessionUpdate: "session_info_update",
  _meta: {
    piAcp: {
      queueDepth: number,
      running: boolean
    }
  }
}
```

当前限制：

- 没有稳定的队列项 ID；
- 没有查询完整队列的接口；
- 没有修改单条队列消息的接口；
- 没有替换和重排队列的接口；
- 没有对每条消息明确表达 `steer | followUp`；
- `_meta.piAcp` 不是 ACP 核心标准，客户端可能忽略。

### 判断

如果产品只要求“一次输入、等待完成”，可以不补。

如果目标是 Codex Desktop 式的运行中继续输入和编辑待发送消息，则必须在 Agent Service Contract 中补充队列接口，不能只依赖 pi-acp。

---

## 1.4 缺少完整的 Extension UI Host

pi-gui 的 Host UI 请求覆盖：

```ts
type HostUiRequest =
  | { kind: "confirm"; requestId: string; title: string; message: string }
  | { kind: "input"; requestId: string; title: string; placeholder?: string }
  | { kind: "select"; requestId: string; title: string; options: string[] }
  | { kind: "editor"; requestId: string; title: string; initialValue?: string }
  | { kind: "notify"; requestId: string; message: string }
  | { kind: "status"; requestId: string; key: string; text?: string }
  | { kind: "widget"; requestId: string; key: string; lines?: string[] }
  | { kind: "title"; requestId: string; title: string }
  | { kind: "editorText"; requestId: string; text: string }
  | { kind: "reset"; requestId: string };
```

响应接口：

```ts
respondToHostUiRequest(
  sessionRef: SessionRef,
  response: HostUiResponse,
): Promise<void>;
```

pi-gui 还维护：

- Status 文本；
- Widget 内容和位置；
- 动态标题；
- Composer 文本；
- Dialog 状态。

pi-acp 对 Pi RPC Extension UI 的处理更有限。ACP 能较自然表达：

- `confirm`
- `select`
- Permission 请求

但以下能力容易退化或没有稳定映射：

- `input`
- `editor`
- `setStatus`
- `setWidget`
- `setTitle`
- `set_editor_text`
- Pi Extension 注册的 Slash Commands
- Pi TUI 自定义组件

### 判断

这不是所有 Agent 服务都必须具备的能力。

如果当前目标不支持 Pi Extension UI，可以明确声明：

```ts
capabilities: {
  extensionUi: false
}
```

不要为了完整复制 Pi TUI 而扩大范围。

---

## 1.5 缺少完整的 Pi Session Tree 能力

pi-gui 提供：

```ts
getSessionTree(
  sessionRef: SessionRef,
): Promise<SessionTreeSnapshot>;

navigateSessionTree(
  sessionRef: SessionRef,
  targetId: string,
  options?: {
    summarize?: boolean;
    customInstructions?: string;
  },
): Promise<NavigateSessionTreeResult>;
```

树节点可以表示：

- Message
- Model change
- Thinking level change
- Compaction
- Branch summary
- Custom message
- Label
- Session info

pi-acp 当前支持：

- `session/list`
- `session/load`
- `session/delete`
- 历史消息重放

但没有把 Pi 的完整 append-only Session Tree 映射成 ACP 接口，缺少：

- `getTree`
- `navigateTree`
- Leaf 选择；
- 节点跳转；
- 从历史节点重新生成；
- Branch summary；
- 完整父子节点关系。

### 判断

鉴于当前目标不要求跨 Agent 共享历史，这项不是必需能力。

只有产品明确要求“Pi 会话内回溯、分支、从节点继续”时才需要加入。

---

## 1.6 缺少运行时资源和认证管理接口

pi-gui 另有 `RuntimeResourceDriver`：

```ts
interface RuntimeResourceDriver {
  getRuntimeSnapshot(workspace: WorkspaceRef): Promise<RuntimeSnapshot>;
  refreshRuntime(workspace: WorkspaceRef): Promise<RuntimeSnapshot>;

  login(
    workspace: WorkspaceRef,
    providerId: string,
    callbacks: RuntimeLoginCallbacks,
  ): Promise<void>;

  logout(workspace: WorkspaceRef, providerId: string): Promise<void>;

  setProviderApiKey(
    workspace: WorkspaceRef,
    providerId: string,
    apiKey: string,
  ): Promise<void>;

  setDefaultModel(
    workspace: WorkspaceRef,
    selection: { provider: string; modelId: string },
  ): Promise<void>;

  setDefaultThinkingLevel(
    workspace: WorkspaceRef,
    thinkingLevel: string,
  ): Promise<void>;

  setScopedModelPatterns(
    workspace: WorkspaceRef,
    patterns: readonly string[],
  ): Promise<void>;

  setSkillEnabled(
    workspace: WorkspaceRef,
    filePath: string,
    enabled: boolean,
  ): Promise<void>;

  setExtensionEnabled(
    workspace: WorkspaceRef,
    filePath: string,
    enabled: boolean,
  ): Promise<void>;
}
```

其运行时快照包含：

- Provider；
- Model；
- Auth 类型和来源；
- Skills；
- Extensions；
- Extension commands/tools；
- Extension diagnostics；
- Runtime settings。

pi-acp 的认证和资源管理主要依赖：

- `pi-acp --terminal-login`
- 已存在的 Pi auth/settings；
- Pi 本地资源发现；
- ACP 中的模型和 Thinking 配置。

它没有提供完整接口来管理：

- Provider OAuth 流程；
- API Key 生命周期；
- Credential source；
- Skill 启停；
- Extension 启停；
- Extension diagnostics；
- Scoped models；
- Runtime resource refresh。

### 判断

这部分应拆为独立的 Runtime Management API，而不是全部塞进基础 Session 接口。

UI 页面不属于 Agent 服务，但 Provider、模型和凭证的实际查询及修改必须由可信 Host 完成，不能由 Renderer 直接读写文件。

---

## 1.7 缺少稳定的桌面事件模型

pi-acp 主要把 Pi 事件翻译成 ACP：

```text
agent_message_chunk
user_message_chunk
tool_call
tool_call_update
available_commands_update
session_info_update
current_mode_update
config_option_update
```

Pi 原始的部分生命周期信息会被压缩或丢失，例如：

- `agent_start`
- `agent_settled`
- `turn_start`
- `turn_end`
- `queue_update`
- `compaction_start`
- `compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- summarization retry

pi-gui 的 `SessionDriver` 同样不是完整 SDK 事件暴露，它也进行了产品化收敛：

```ts
type SessionDriverEvent =
  | SessionOpenedEvent
  | SessionUpdatedEvent
  | AssistantDeltaEvent
  | QueuedMessageStartedEvent
  | ToolStartedEvent
  | ToolUpdatedEvent
  | ToolFinishedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | HostUiRequestEvent
  | ExtensionCompatibilityIssueEvent
  | SessionClosedEvent;
```

关键区别不是“pi-gui 无损、pi-acp 有损”，而是：

- pi-acp 优先兼容 ACP Client；
- pi-gui 优先满足自己的 Electron 产品状态；
- 两者都没有直接提供面向未来其他 Agent 的通用事件模型。

### 判断

自己的 Agent 服务应定义稳定事件：

```ts
type AgentEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "message.delta"; sessionId: string; runId: string; text: string }
  | { type: "tool.started"; sessionId: string; runId: string; toolCallId: string }
  | { type: "tool.updated"; sessionId: string; runId: string; toolCallId: string }
  | { type: "tool.completed"; sessionId: string; runId: string; toolCallId: string }
  | { type: "permission.requested"; sessionId: string; requestId: string }
  | { type: "run.completed"; sessionId: string; runId: string }
  | { type: "run.failed"; sessionId: string; runId: string; error: AgentError }
  | { type: "session.closed"; sessionId: string };
```

每个事件至少需要：

- `schemaVersion`
- `sessionId`
- `runId`
- `sequence`
- `timestamp`
- 可选的 `backendPayload`

---

## 1.8 缺少 Host 控制的工具、终端和 MCP 边界

这是最重要的架构缺口。

pi-acp 当前明确不支持：

- ACP `fs/*` 委托；
- ACP `terminal/*` 委托；
- 将 `session/new` 中传入的 MCP Servers 接入 Pi。

实际行为是：

```text
Pi Tool Call
    ↓
Pi 子进程直接在本机读取、写入和执行
    ↓
pi-acp 将结果翻译给 ACP Client
```

这意味着 ACP Client 不是工具执行的安全边界。

虽然 pi-gui 直接使用 Pi SDK，理论上可以：

- 自定义工具；
- 替换文件 Operations；
- 替换 Bash Operations；
- 禁用内置工具；
- 接入 Host 权限决策。

但不能因此直接声称 pi-gui 已经实现了通用企业工具网关。它的公开 `SessionDriver` 也没有工具 allowlist、审批策略或动态 MCP 注册接口。

### 判断

自己的服务必须明确二选一：

#### 模式 A：Backend 自己执行工具

优点：

- 实现简单；
- 最接近 Pi CLI；
- 容易兼容 Pi Extension。

风险：

- Host 无法统一限制文件路径；
- 难以统一审批；
- 难以切换到安全沙箱；
- 不适合高信任要求。

#### 模式 B：Backend 请求，Host 执行

Host 负责：

- Workspace 路径校验；
- 文件读写；
- Terminal 生命周期；
- Permission 决策；
- MCP 调用；
- 审计；
- 超时和取消。

这更接近 Codex Desktop 的安全模型，也是当前项目更应该采用的方向。

---

# 2. pi-acp 现有功能及具体接口代码

## 2.1 进程和协议结构

```text
ACP Client
    ↕ ACP / JSON-RPC 2.0 / stdio
pi-acp
    ↕ Pi JSONL RPC / stdin/stdout
pi --mode rpc
```

`pi-acp` 实现 `@agentclientprotocol/sdk` 的 Agent 接口，并为每个活动会话管理一个 `PiRpcProcess`。

当前策略是：单个 ACP Connection 中只保留一个活动 Pi 子进程，新建或加载其他 Session 时关闭旧 Session；不同 Client Window 启动独立的 pi-acp 进程。

---

## 2.2 初始化与能力协商

实现方法：

```ts
async initialize(params: InitializeRequest): Promise<InitializeResponse>
```

核心返回结构：

```ts
{
  protocolVersion: 1,

  agentInfo: {
    name: "pi-acp",
    title: "pi ACP adapter",
    version: "0.0.31"
  },

  authMethods: [...],

  agentCapabilities: {
    loadSession: true,

    mcpCapabilities: {
      http: false,
      sse: false
    },

    promptCapabilities: {
      image: true,
      audio: false,
      embeddedContext:
        process.env.PI_ACP_ENABLE_EMBEDDED_CONTEXT === "true"
    },

    sessionCapabilities: {
      list: {},
      delete: {}
    }
  }
}
```

注意：

- `mcpCapabilities.http/sse = false`；
- Embedded Context 默认关闭；
- `session/list` 和 `session/delete` 属于当前实现使用的非稳定/演进中 ACP 能力；
- 能力声明不代表所有 ACP Client 都会使用这些能力。

---

## 2.3 认证接口

对外方法：

```ts
async authenticate(params: AuthenticateRequest): Promise<void>
```

实际认证方式：

```bash
pi-acp --terminal-login
```

`authenticate()` 本身通常为空操作，因为登录通过重新启动 Terminal Auth 流程在进程外完成。

现有能力：

- 在 `initialize` 中返回 `authMethods`；
- 未配置模型或凭证时返回 ACP `AUTH_REQUIRED`；
- 支持客户端展示 Authenticate 入口；
- 通过终端运行 Pi 登录。

未提供：

- 在 ACP 内直接写入 API Key；
- 完整 OAuth Callback API；
- Credential Store 注入；
- Provider 注册和注销管理。

---

## 2.4 创建会话

对外方法：

```ts
async newSession(params: NewSessionRequest)
```

典型请求：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/new",
  "params": {
    "cwd": "/absolute/path/to/project",
    "mcpServers": []
  }
}
```

核心逻辑：

```ts
const session = await sessions.create({
  cwd: params.cwd,
  mcpServers: params.mcpServers,
  conn,
  fileCommands,
  piCommand: process.env.PI_ACP_PI_COMMAND,
});

const state = await session.proc.getState();
const availableModels = await session.proc.getAvailableModels();

return {
  sessionId: session.sessionId,
  configOptions,
  models,
  modes,
  _meta: {
    piAcp: {
      startupInfo: preludeText || null
    }
  }
};
```

现有行为：

- 要求 `cwd` 为绝对路径；
- 启动 `pi --mode rpc`；
- 获取 Pi Session ID 和 Session File；
- 获取可用模型；
- 获取当前 Thinking Level；
- 未认证时返回 `AUTH_REQUIRED`；
- 加载文件 Prompt 和 Skills Commands；
- 发送 `available_commands_update`；
- 接收并保存 `mcpServers`，但不接入 Pi。

---

## 2.5 Prompt

对外方法：

```ts
async prompt(params: PromptRequest): Promise<PromptResponse>
```

典型请求：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/prompt",
  "params": {
    "sessionId": "pi-session-id",
    "prompt": [
      {
        "type": "text",
        "text": "分析当前项目结构"
      }
    ]
  }
}
```

核心逻辑：

```ts
const session = await restoreSession(params.sessionId);
const { message, images } = promptToPiMessage(params.prompt);
const result = await session.prompt(message, images);

return {
  stopReason:
    result === "error"
      ? session.wasCancelRequested()
        ? "cancelled"
        : "end_turn"
      : result
};
```

支持：

- 文本；
- 图片；
- Embedded Context 降级为文本；
- 文件 Prompt 展开；
- Skills Commands；
- pi-acp 内置 Slash Commands；
- Prompt 运行中时进入内部队列。

限制：

- Pi 错误当前可能映射为 `end_turn`；
- 没有独立的稳定 Run ID；
- 没有完整结构化错误生命周期；
- 没有公开队列内容。

---

## 2.6 取消

对外方法：

```ts
async cancel(params: CancelNotification): Promise<void>
```

内部行为：

```ts
async cancel(): Promise<void> {
  this.cancelRequested = true;

  // 清理尚未执行的排队 Prompt。
  for (const turn of this.turnQueue.splice(0)) {
    turn.resolve("cancelled");
  }

  // 中断当前 Pi Agent 操作。
  await this.proc.abort();
}
```

取消会：

- 标记当前 Turn 已请求取消；
- 清空内部队列；
- 发送队列已清理消息；
- 调用 Pi RPC `abort`。

---

## 2.7 会话列举

对外方法：

```ts
async listSessions(
  params: ListSessionsRequest,
): Promise<ListSessionsResponse>
```

典型返回：

```ts
{
  sessions: [
    {
      sessionId: "...",
      cwd: "/project/path",
      title: "...",
      updatedAt: "..."
    }
  ],
  nextCursor: "50" | null,
  _meta: {}
}
```

行为：

- 扫描 Pi Session；
- 可按 `cwd` 过滤；
- 默认使用最近 Session 的 cwd；
- 每页 50 条；
- 使用数字 offset 作为不透明 cursor。

---

## 2.8 加载和回放会话

对外方法：

```ts
async loadSession(
  params: LoadSessionRequest,
): Promise<LoadSessionResponse>
```

典型请求：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/load",
  "params": {
    "sessionId": "existing-pi-session-id",
    "cwd": "/absolute/project/path",
    "mcpServers": []
  }
}
```

加载过程：

```text
查询 ACP Session ID → Pi Session File 映射
             ↓
启动 pi --mode rpc --session <session-file>
             ↓
Pi RPC get_messages
             ↓
重放 user_message_chunk
重放 agent_message_chunk
重建历史 tool_call/tool_call_update
             ↓
返回 models/modes/configOptions
```

历史 Tool Call 是根据 Pi 消息重新构造的 ACP Tool Call，不是原始 ACP Event 的持久化重放。

---

## 2.9 删除会话

对外方法：

```ts
async deleteSession(
  params: DeleteSessionRequest,
): Promise<DeleteSessionResponse>
```

行为：

```ts
const sessionFile =
  stored?.sessionFile ?? piSession?.sessionFile;

if (sessionFile && existsSync(sessionFile)) {
  unlinkSync(sessionFile);
}

store.delete(params.sessionId);
return {};
```

语义：

- 删除 Pi JSONL Session File；
- 删除 pi-acp 映射；
- 不存在时幂等成功；
- 当前属于高风险、不可恢复操作，正式产品应在 Desktop Host 增加明确确认和回收策略。

---

## 2.10 模型和 Thinking 配置

现有方法：

```ts
async unstable_setSessionModel(params: {
  sessionId: string;
  modelId: string;
}): Promise<void>;

async setSessionMode(
  params: SetSessionModeRequest,
): Promise<SetSessionModeResponse>;

async setSessionConfigOption(
  params: SetSessionConfigOptionRequest,
): Promise<SetSessionConfigOptionResponse>;
```

Config IDs：

```ts
const MODEL_CONFIG_ID = "model";
const THOUGHT_LEVEL_CONFIG_ID = "thought_level";
```

Thinking Levels：

```ts
type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
```

设置成功后发送：

```text
current_mode_update
config_option_update
```

---

## 2.11 `session/update` 事件

### Assistant 文本

```ts
{
  sessionUpdate: "agent_message_chunk",
  content: {
    type: "text",
    text: "..."
  }
}
```

当前没有单独的：

```text
agent_thought_chunk
```

Pi Thinking 不会作为独立稳定 Thought Stream 输出。

### 历史用户消息

```ts
{
  sessionUpdate: "user_message_chunk",
  content: {
    type: "text",
    text: "..."
  }
}
```

主要用于 `session/load` 回放。

### Tool Call

```ts
{
  sessionUpdate: "tool_call",
  toolCallId: "call-id",
  title: "read file",
  kind: "read" | "edit" | "execute" | "other",
  status: "pending" | "in_progress" | "completed",
  locations: [
    {
      path: "/absolute/file/path",
      line: 10
    }
  ],
  rawInput: {}
}
```

### Tool Update

```ts
{
  sessionUpdate: "tool_call_update",
  toolCallId: "call-id",
  status: "in_progress" | "completed" | "failed",
  content: [],
  rawOutput: {}
}
```

### Edit Diff

pi-acp 在 Edit/Write 前读取文件快照，完成后尝试发送：

```ts
{
  type: "diff",
  path: "/absolute/file/path",
  oldText: "...",
  newText: "..."
}
```

限制：

- Diff 来自适配器侧的前后快照；
- 唯一 `oldText` 匹配时才可能推断行号；
- 不是 Host 委托式文件执行；
- Pi 已经执行修改后，pi-acp 才进行结果展示。

### 命令更新

```ts
{
  sessionUpdate: "available_commands_update",
  availableCommands: [...]
}
```

### Session 信息

```ts
{
  sessionUpdate: "session_info_update",
  title?: "...",
  updatedAt?: "...",
  _meta?: {
    piAcp?: {
      queueDepth?: number,
      running?: boolean
    }
  }
}
```

### 模式和配置更新

```text
current_mode_update
config_option_update
```

---

## 2.12 内置 Slash Commands

当前 pi-acp 暴露：

```text
/compact [instructions]
/autocompact on|off|toggle
/export
/session
/name <name>
/steering all|one-at-a-time
/follow-up all|one-at-a-time
/changelog
/model
/thinking
```

并暴露：

- Pi 文件 Prompt；
- 启用后的 Skills Commands。

不暴露：

- Pi Extensions 动态注册的 Slash Commands。

注意：Slash Command 是人机交互入口，不应被当作稳定的 Agent Service API。

---

## 2.13 MCP

ACP 请求允许传入：

```ts
interface NewSessionRequest {
  cwd: string;
  mcpServers: McpServer[];
}
```

pi-acp 当前行为：

```ts
const session = new PiAcpSession({
  mcpServers: params.mcpServers
});
```

但这些配置只保存在 Session 对象中，没有连接到 Pi。

```text
ACP Client 提供 MCP Servers
             ↓
pi-acp 接收并保存
             ↓
没有注册到 Pi Agent
```

这是“接口接收了参数”和“功能真正实现”之间最明确的差异。

---

## 2.14 文件和终端

ACP 规范定义 Client 可提供：

```text
fs/read_text_file
fs/write_text_file

terminal/create
terminal/output
terminal/wait_for_exit
terminal/kill
terminal/release
```

pi-acp 当前不调用这些 ACP Client 能力。

Pi 的：

- `read`
- `write`
- `edit`
- `bash`

仍然在 Pi 子进程本地执行。pi-acp 只把执行过程翻译为 ACP Tool Call 和模拟 Terminal 元数据。

---

# 3. 完整对比

## 3.1 定位与接口形式

| 维度 | pi-acp | pi-gui SessionDriver | 对当前 Agent 服务的意义 |
|---|---|---|---|
| 定位 | ACP ↔ Pi RPC 协议适配器 | pi-gui 内部 Agent Host 接口 | 两者不能直接互相替代 |
| 运行形式 | 独立进程、stdio | Electron Main 内部 TypeScript 模块 | 正式服务需明确进程边界 |
| 对外协议 | ACP JSON-RPC 2.0 | 无外部协议 | ACP 更适合跨进程兼容 |
| Backend | 固定 Pi RPC | 固定 Pi SDK Driver，但接口可替换 | 都未证明通用多 Agent 能力 |
| 协议版本 | ACP protocolVersion | 无 | Agent Service 需要版本协商 |
| 能力协商 | ACP capabilities | 无统一 descriptor | 应保留 ACP 的优点 |

## 3.2 Session 和运行控制

| 能力 | pi-acp | pi-gui SessionDriver | 是否属于 Agent 服务 |
|---|---:|---:|---:|
| 创建 Session | 有 | 有 | 必须 |
| 打开/加载 Session | 有 | 有 | 推荐 |
| 列举 Session | 有 | Driver 扩展有 | 可由 Desktop Host 管理 |
| 删除 Session | 有 | 未作为核心 Driver 方法 | 产品层高风险操作 |
| 关闭 Session | 进程/连接策略 | 明确 `closeSession` | 必须 |
| Reload | 通过重新 load | 明确 `reloadSession` | 推荐 |
| Prompt | 有 | 有 | 必须 |
| 图片输入 | 有 | 有 | 能力可选 |
| Cancel | 有 | 有 | 必须 |
| 稳定 Run ID | 无完整抽象 | 有 `runningRunId` | 必须补 |
| Session Snapshot | 有限 | 丰富 | 必须补 |
| Session Supervisor | 基础 Pi 进程管理 | 较完整 | 必须补 |
| 运行失败事件 | StopReason/请求错误 | `runFailed` | 必须统一 |

## 3.3 消息与队列

| 能力 | pi-acp | pi-gui SessionDriver | 建议 |
|---|---:|---:|---|
| Assistant Streaming | `agent_message_chunk` | `assistantDelta` | 必须 |
| 独立 Thought Streaming | 无 | Driver 事件也无独立 Thought Delta | 声明为可选能力 |
| Tool Streaming | 有 | 有 | 必须 |
| 内部 Prompt Queue | 有 | 有 | 运行中输入需要 |
| Queue Depth | `_meta.piAcp` | Snapshot 中可读取 | pi-acp 不足 |
| 查询完整队列 | 无 | 有状态模型 | 需要时补 |
| 编辑/重排队列 | 无 | `replaceQueuedMessages` | Codex 式体验需要 |
| 每条消息交付模式 | 无稳定对外字段 | `steer \| followUp` | 建议明确 |
| 附件随队列保存 | 不完整 | 有 | 产品需要时实现 |

## 3.4 模型、Thinking 和资源

| 能力 | pi-acp | pi-gui | 建议 |
|---|---:|---:|---|
| 列出模型 | 有 | 有 | 推荐 |
| 设置模型 | 有 | 有 | 推荐 |
| 设置 Thinking | 有 | 有 | 推荐 |
| 模型能力信息 | 基础映射 | 包含 reasoning/images | 需要 capability |
| Provider Auth 状态 | 有限 | 有 Runtime Snapshot | 管理 API |
| API Key 设置 | 无 | 有 | 可信 Host 管理 |
| OAuth 流程 | Terminal Auth | 有 Callback Driver | 视产品需求 |
| Skills 列表 | Commands/启动信息 | 有结构化记录 | 可选 |
| Skills 启停 | 无 | 有 | 可选 |
| Extensions 列表 | 启动信息为主 | 有结构化记录 | 可选 |
| Extensions 启停 | 无 | 有 | 可选 |
| Extension Diagnostics | 无统一 API | 有 | 可选 |
| Runtime Refresh | 无正式接口 | 有 | 推荐 |

## 3.5 Session 历史与树

| 能力 | pi-acp | pi-gui | 当前优先级 |
|---|---:|---:|---:|
| Pi Session 持久化 | 有 | 有 | 中 |
| 历史消息回放 | 有 | 有 | 中 |
| Session Title | 有 | 有 | 低 |
| Archive | 无产品目录 | 有 | 产品层 |
| Session Tree | 未完整映射 | 有 | 低 |
| Tree Navigation | 无 | 有 | 低 |
| Branch Summary | 无接口 | 有 | 低 |
| 跨 Backend 历史共享 | 无 | 无 | 当前不需要 |
| 跨 Backend 历史迁移 | 无 | 无 | 当前不需要 |

## 3.6 Extension UI

| 能力 | pi-acp | pi-gui | 建议 |
|---|---:|---:|---|
| Confirm | 部分映射 | 有 | 权限场景需要 |
| Select | 部分映射 | 有 | 可选 |
| Input | 不完整/易退化 | 有 | 可选 |
| Editor | 不完整/易退化 | 有 | 可选 |
| Notify | 有限 | 有 | 产品层 |
| Status | 无稳定表现 | 有 | 产品层 |
| Widget | 无通用表现 | 有 | 不建议作为通用接口 |
| Title | 无稳定表现 | 有 | 产品层 |
| Set Editor Text | 无一致体验 | 有 | 产品层 |
| Extension Commands | 不暴露 | 有 | 可选 |
| TUI Components | 不可能原样表达 | 也需重写为 React UI | 不做 |

## 3.7 工具、安全与 MCP

| 能力 | pi-acp | pi-gui | 当前 Agent 服务要求 |
|---|---:|---:|---:|
| Tool Call 展示 | 有 | 有 | 必须 |
| Tool Location | 有 | 可由 SDK 获得 | 推荐 |
| Structured Diff | 有适配器快照 | 有产品 Diff | 推荐 |
| Host 文件委托 | 无 | SDK 架构上可做，不等于现成实现 | 必须明确 |
| Host Terminal 委托 | 无 | 集成 PTY 不等于 Agent 工具委托 | 必须明确 |
| Permission Enforcement | 不形成完整安全边界 | 需要额外实现 | 必须 |
| Tool Allowlist | 无 ACP 管理接口 | Driver 未作为公共接口暴露 | 推荐 |
| 自定义工具注入 | 无 | SDK 内部可实现 | 推荐 |
| 动态 MCP 透传 | 未实现 | 无通用 Driver API | 需要时必须补 |
| 路径范围校验 | Pi 本地执行 | 取决于 Driver 实现 | 必须 |
| 审计和超时 | 不完整 | 取决于 Host | 必须 |

## 3.8 产品功能边界

以下 pi-gui 能力不应被当作 pi-acp 的 Agent 服务缺口：

| pi-gui 产品能力 | 是否属于 Agent 服务 |
|---|---:|
| React Timeline | 否 |
| Session Sidebar | 否 |
| Inline Diff Panel | 否 |
| Integrated PTY Panel | 否 |
| Git Worktree 创建 | 否，除非服务负责执行环境 |
| Workspace Catalog UI | 否 |
| Session Archive UI | 否 |
| OS Notification | 否 |
| Theme | 否 |
| 文件 `@mention` 选择器 | 否 |
| 图片拖拽体验 | 否 |
| Thread Title 生成 | 通常属于 Desktop Host |
| Multi-agent 编排界面 | 否 |

---

# 4. 对当前方案的建议

## 4.1 不要直接复制 pi-gui 的全部 SessionDriver

pi-gui 的 Driver 混合了：

- Agent Runtime；
- Session 产品状态；
- Workspace Catalog；
- Archive；
- Provider 设置；
- Extension 管理。

直接复制会把 Agent 服务和桌面产品重新耦合。

## 4.2 不要直接把 pi-acp 当作最终服务契约

直接依赖 pi-acp 会带来：

- 队列只能依赖 `_meta.piAcp`；
- Pi Slash Commands 泄露到产品逻辑；
- 工具由 Pi 自己执行；
- MCP 参数接收但不生效；
- 缺少稳定 Session Snapshot；
- 事件语义仍受 pi-acp 翻译策略影响；
- pi-acp 升级可能影响客户端行为。

## 4.3 最小 Agent Service Contract

```ts
interface AgentService {
  describe(): Promise<AgentServiceDescriptor>;

  createSession(
    input: CreateAgentSessionInput,
  ): Promise<AgentSessionSnapshot>;

  getSessionSnapshot(
    sessionId: string,
  ): Promise<AgentSessionSnapshot>;

  prompt(
    sessionId: string,
    input: AgentPromptInput,
  ): Promise<{ runId: string; accepted: true }>;

  cancel(
    sessionId: string,
    runId?: string,
  ): Promise<void>;

  closeSession(
    sessionId: string,
  ): Promise<void>;

  subscribe(
    sessionId: string,
    listener: (event: AgentEvent) => void,
  ): () => void;
}
```

能力描述：

```ts
interface AgentServiceDescriptor {
  contractVersion: string;

  implementation: {
    name: string;
    version: string;
  };

  capabilities: {
    images: boolean;
    thoughts: boolean;
    toolCalls: boolean;
    structuredDiff: boolean;
    permissions: boolean;
    fsDelegation: boolean;
    terminalDelegation: boolean;
    mcp: boolean;
    queueEditing: boolean;
    sessionTree: boolean;
    sessionResume: boolean;
    extensionUi: boolean;
  };
}
```

## 4.4 当前不需要实现的能力

根据当前约束：

- Adapter 不需要让用户实时选择；
- Backend 只在未来版本切换；
- 不要求不同 Backend 共享历史。

因此暂时不需要：

```text
listAdapters
selectAdapter
switchAdapter
migrateSession
importOtherAgentHistory
统一跨 Agent Session Tree
统一跨 Agent 消息存储格式
```

Backend 切换时：

```text
旧版本 Session → 旧 Backend 历史或只读归档
新创建 Session → 新 Backend
```

Agent Service Contract 保持不变即可。

---

# 5. 最终判断

`pi-acp` 可以证明：

> Electron 或其他 ACP Client 能通过标准协议创建 Pi Session、发送 Prompt、接收文本和 Tool Call。

它不能单独证明：

> 已经具备一个可支撑 Codex Desktop 产品的 Agent 服务。

距离后者最关键的缺口是：

1. Session Supervisor；
2. 可恢复的 Session Snapshot；
3. 稳定 Run ID 和结构化事件；
4. 可查询、可编辑的队列语义；
5. Host 控制的文件、终端、权限和 MCP；
6. 与 Pi 专有命令解耦的稳定服务接口。

pi-gui 的价值主要在于展示“桌面 Host 应该补哪些能力”；ACP/pi-acp 的价值主要在于展示“跨进程协议应该如何协商和传输”。

最终方案应吸收二者的长处：

```text
ACP/pi-acp：
协议版本、能力协商、Session/Prompt/Cancel、Tool Update

pi-gui：
Session Supervisor、Snapshot、Queue、Host UI、Runtime Management

自己的服务：
稳定契约、工具安全边界、Driver 替换能力、契约测试
```

---

# 6. 参考资料

- [pi-acp README](https://github.com/nangualin/pi-acp)
- [pi-acp Agent 实现](https://raw.githubusercontent.com/nangualin/pi-acp/main/src/acp/agent.ts)
- [pi-acp Session 与事件翻译](https://raw.githubusercontent.com/nangualin/pi-acp/main/src/acp/session.ts)
- [pi-acp package.json](https://raw.githubusercontent.com/nangualin/pi-acp/main/package.json)
- [ACP v1 Overview](https://agentclientprotocol.com/protocol/v1/overview)
- [Pi RPC 官方文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi SDK 官方文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [pi-gui README](https://github.com/minghinmatthewlam/pi-gui)
- [pi-gui SessionDriver 类型](https://raw.githubusercontent.com/minghinmatthewlam/pi-gui/main/packages/session-driver/src/types.ts)
- [pi-gui RuntimeResourceDriver 类型](https://raw.githubusercontent.com/minghinmatthewlam/pi-gui/main/packages/session-driver/src/runtime-types.ts)
- [pi-gui PiSdkDriver](https://raw.githubusercontent.com/minghinmatthewlam/pi-gui/main/packages/pi-sdk-driver/src/pi-sdk-driver.ts)
- [pi-gui Extension UI State](https://raw.githubusercontent.com/minghinmatthewlam/pi-gui/main/packages/pi-sdk-driver/src/extension-ui-state.ts)

> 注意：pi-acp 和 ACP 均在快速迭代。正式方案应锁定具体 npm 版本或 Git commit，并建立契约测试，不要直接依赖 `main` 分支的隐含行为。
