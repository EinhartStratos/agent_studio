# GUI 调用 pi 接口清单

本文档详细列出 pi-gui 桌面应用中 GUI 层对 `pi`（`@earendil-works/pi-coding-agent`）底层接口的调用关系，包括调用位置和用途说明。

---

## 一、架构概览

GUI 不直接调用 `pi` 底层 API，而是通过 **两层层间人** 间接调用：

```
GUI (Renderer/Main) → PiSdkDriver → SessionSupervisor / RuntimeSupervisor → pi 核心
```

| 桥接层 | 文件位置 | 角色 |
|---|---|---|
| **PiSdkDriver** | `packages/pi-sdk-driver/src/pi-sdk-driver.ts` | 实现 `SessionDriver` 接口，所有 GUI 调用的统一入口 |
| **SessionSupervisor** | `packages/pi-sdk-driver/src/session-supervisor.ts` | 会话生命周期管理，直接调用 pi 的 `SessionManager`、`AgentSession` |
| **RuntimeSupervisor** | `packages/pi-sdk-driver/src/runtime-supervisor.ts` | 运行时资源管理，调用 pi 的 `AuthStorage`、`ModelRegistry`、`SettingsManager` 等 |
| **runtime-deps** | `packages/pi-sdk-driver/src/runtime-deps.ts` | pi 核心依赖（`AuthStorage`、`ModelRegistry`）的初始化 |
| **npm-package-fallback** | `packages/pi-sdk-driver/src/npm-package-fallback.ts` | pi `SessionManager` 创建与 npm 降级回退 |

---

## 二、pi 核心依赖初始化

### 2.1 依赖初始化入口

**代码位置**: [packages/pi-sdk-driver/src/runtime-deps.ts](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-deps.ts#L13-L24)

```
PiSdkDriver 构造时调用 createRuntimeDependencies()
        │
        ├─→ AuthStorage.create()           ← pi 认证存储
        ├─→ ModelRegistry.create()         ← pi 模型注册表
        ├─→ getAgentDir()                  ← pi 代理目录
        └─→ CustomProviderStore()          ← GUI 自定义提供商存储（使用 pi 的 models.json）
```

### 2.2 AgentSessionRuntime 创建

**代码位置**: [packages/pi-sdk-driver/src/npm-package-fallback.ts](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/npm-package-fallback.ts)

- 封装 `SessionManager` 的创建和开启逻辑
- 提供 npm 包依赖失败时的降级处理
- 被 `SessionSupervisor.createSession()` / `createOrReopenRecord()` / `forkSession()` 调用

---

## 三、会话管理接口（SessionSupervisor）

### 3.1 会话创建 — `SessionManager.create()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `SessionManager.create(workspace.path)` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L456](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L456) |
| **GUI 入口** | `PiSdkDriver.createSession(workspace, options)` |
| **IP 调用链** | Renderer → IPC → `app-store.ts` → `PiSdkDriver.createSession()` → `SessionSupervisor.createSession()` |
| **用途** | 创建新的 AI 会话，生成 `.jsonl` 会话文件 |

### 3.2 会话打开 — `SessionManager.open()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `SessionManager.open(sessionFile)` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L1002](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L1002) |
| **用途** | 重新打开已有的会话文件，恢复会话状态 |
| **调用链** | 用户点击历史会话 → `openSession()` → `createOrReopenRecord()` |

### 3.3 会话列表 — `SessionManager.list()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `SessionManager.list(path)` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L220](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L220) |
| **用途** | 扫描工作区中所有 `.jsonl` 会话文件 |
| **调用链** | workspace 同步 → `syncWorkspace()` |

### 3.4 会话分叉 — `SessionManager.forkFrom()` / `SessionManager.createBranchedSession()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `SessionManager.forkFrom(sourceFile, targetPath)` / `SessionManager.createBranchedSession(targetLeafId)` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L539-L553](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L539-L553) |
| **用途** | 从某个消息节点分叉出新会话 |

### 3.5 发送消息 — `AgentSession.prompt()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.prompt(text, { images, source })` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L714](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L714) |
| **用途** | 向 AI 发送用户消息，触发 AI 响应 |

### 3.6 队列消息 — `AgentSession.followUp()` / `AgentSession.steer()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.followUp(text)` / `session.steer(text)` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L1502-L1505](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L1502-L1505) |
| **用途** | 在 AI 流式输出过程中追加或引导消息 |

### 3.7 取消运行 — `AgentSession.abort()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.abort()` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L778](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L778) |
| **用途** | 取消当前 AI 的运行 |

### 3.8 设置模型 — `session.agent.state.model` / `session.modelRegistry.getApiKeyAndHeaders()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.modelRegistry.getApiKeyAndHeaders(model)` / `session.agent.state.model = model` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L805-L816](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L805-L816) |
| **GUI 入口** | 用户在模型选择器切换模型 → `setSessionModel()` |
| **用途** | 动态切换当前会话使用的 AI 模型 |

### 3.9 会话压缩 — `AgentSession.compact()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.compact(customInstructions)` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L856](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L856) |
| **用途** | 压缩会话上下文以节省 Token |

### 3.10 导航会话树 — `AgentSession.navigateTree()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.navigateTree(targetId, options)` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L890](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L890) |
| **用途** | 跳转到会话历史中的某个消息节点 |

### 3.11 会话重载 — `AgentSession.reload()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.reload()` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L870](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L870) |
| **用途** | 重新加载会话状态（技能/扩展变更后） |

### 3.12 扩展绑定 — `AgentSession.bindExtensions()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.bindExtensions({ uiContext, commandContextActions, onError })` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L1204-L1222](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L1204-L1222) |
| **用途** | 绑定扩展到当前会话，提供 UI 上下文和命令上下文 |

### 3.13 事件订阅 — `AgentSession.subscribe()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.subscribe((event) => { ... })` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L1199](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L1199) |
| **用途** | 订阅 pi 代理事件（agent_start、message_update、tool_execution 等） |

### 3.14 思考等级 — `session.agent.state.thinkingLevel` / `session.getAvailableThinkingLevels()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `session.getAvailableThinkingLevels()` / `session.agent.state.thinkingLevel` |
| **调用位置** | [packages/pi-sdk-driver/src/session-supervisor.ts#L1516-L1525](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/session-supervisor.ts#L1516-L1525) |
| **用途** | 设置会话的推理思考等级 |

### 3.15 Tag 写入操作 — `sessionManager.appendSessionInfo()` / `appendModelChange()` / `appendThinkingLevelChange()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `sessionManager.appendSessionInfo(title)` / `appendModelChange(provider, id)` / `appendThinkingLevelChange(level)` |
| **调用位置** | 散布于 `session-supervisor.ts` 多处 |
| **用途** | 向 `.jsonl` 文件追加元数据 tag 行 |

---

## 四、运行时管理接口（RuntimeSupervisor）

### 4.1 运行时快照 — `SettingsManager` + `ResourceLoader` + `PackageManager`

| 属性 | 值 |
|---|---|
| **pi 接口** | `SettingsManager.create(cwd, agentDir)` / `DefaultResourceLoader` / `DefaultPackageManager` |
| **调用位置** | [packages/pi-sdk-driver/src/runtime-supervisor.ts#L355-L397](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-supervisor.ts#L355-L397) |
| **用途** | 为每个工作区创建 pi 的 SettingsManager、ResourceLoader、PackageManager 实例 |

### 4.2 认证管理 — `AuthStorage.login()` / `.logout()` / `.set()` / `.getOAuthProviders()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `authStorage.login(providerId, callbacks)` / `authStorage.logout(providerId)` / `authStorage.set(providerId, { type: "api_key", key })` |
| **调用位置** | [packages/pi-sdk-driver/src/runtime-supervisor.ts#L122-L153](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-supervisor.ts#L122-L153) |
| **GUI 入口** | 设置页面 → 连接/断开 AI 提供商 |
| **用途** | OAuth 登录认证、API Key 管理 |

### 4.3 模型查询 — `ModelRegistry.getAll()` / `.getAvailable()` / `.find()` / `.refresh()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `modelRegistry.getAll()` / `.getAvailable()` / `.find(provider, modelId)` / `.refresh()` |
| **调用位置** | [packages/pi-sdk-driver/src/runtime-supervisor.ts#L497-L523](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-supervisor.ts#L497-L523) |
| **用途** | 获取所有可用模型列表、可用模型、按提供商/模型查找 |

### 4.4 设置管理 — `SettingsManager.setDefaultModelAndProvider()` / `.setEnabledModels()` / `.reload()` / `.flush()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `settingsManager.setDefaultModelAndProvider()` / `setDefaultThinkingLevel()` / `setEnabledModels()` / `setEnableSkillCommands()` / `reload()` / `flush()` |
| **调用位置** | [packages/pi-sdk-driver/src/runtime-supervisor.ts#L190-L191](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-supervisor.ts#L190-L191) 及多处 |
| **用途** | 读写 pi 的全局/项目级设置（`~/.pi/settings.json` / `<project>/.pi/settings.json`） |

### 4.5 技能管理 — `ResourceLoader.getSkills()` + `SettingsManager.setSkillPaths()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `resourceLoader.getSkills()` / `settingsManager.setSkillPaths()` / `setProjectSkillPaths()` |
| **调用位置** | [packages/pi-sdk-driver/src/runtime-supervisor.ts#L570-L598](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-supervisor.ts#L570-L598) |
| **用途** | 加载技能列表、启用/禁用技能 |

### 4.6 扩展管理 — `ResourceLoader.getExtensions()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `resourceLoader.getExtensions()` / `settingsManager.setExtensionPaths()` |
| **调用位置** | [packages/pi-sdk-driver/src/runtime-supervisor.ts#L601-L655](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-supervisor.ts#L601-L655) |
| **用途** | 加载扩展列表、获取扩展命令和工具、启用/禁用扩展 |

### 4.7 前端解析 — `parseFrontmatter()` / `stripFrontmatter()`

| 属性 | 值 |
|---|---|
| **pi 接口** | `parseFrontmatter(raw)` / `stripFrontmatter(raw)` |
| **调用位置** | [packages/pi-sdk-driver/src/runtime-supervisor.ts#L803-L810](file://c:/Users/tangs/Desktop/pi-gui-0.1.0-beta.33/packages/pi-sdk-driver/src/runtime-supervisor.ts#L803-L810) |
| **用途** | 解析技能 Markdown 文件的前置元数据，用于显示技能名称和描述 |

---

## 五、GUI 层间接调用（通过 PiSdkDriver）

### 5.1 主进程调用清单（`main.ts` / `app-store.ts`）

| 功能 | GUI 入口 | PiSdkDriver 方法 | 代码位置（app-store.ts） |
|---|---|---|---|
| 创建工作区 | `addWorkspace()` | `driver.syncWorkspace(path)` | `app-store-workspace.ts#L40` |
| 删除工作区 | `removeWorkspace()` | `driver.removeWorkspace(workspaceId)` | `app-store-workspace.ts#L85` |
| 重命名工作区 | `renameWorkspace()` | `driver.renameWorkspace(workspaceId, name)` | `app-store-workspace.ts#L72` |
| 创建会话 | `createSession()` | `driver.createSession(workspace, options)` | `app-store-workspace.ts#L246` |
| 打开会话 | `selectSession()` | `driver.openSession(sessionRef)` | `app-store.ts#L1440-L1450` |
| 归档会话 | `archiveSession()` | `driver.archiveSession(sessionRef)` | `app-store-workspace.ts#L162` |
| 取消归档 | `unarchiveSession()` | `driver.unarchiveSession(sessionRef)` | `app-store-workspace.ts#L224` |
| 同步工作区 | `syncCurrentWorkspace()` | `driver.syncWorkspace(path)` | `app-store-workspace.ts#L294` |
| 发送消息 | `submitComposer()` | `driver.sendUserMessage(sessionRef, input)` | `app-store-composer.ts`（通过 composer 委托） |
| 取消运行 | `cancelCurrentRun()` | `driver.cancelCurrentRun(sessionRef)` | `app-store-composer.ts`（通过 composer 委托） |
| 设置会话模型 | `setSessionModel()` | `driver.setSessionModel(sessionRef, selection)` | `app-store-composer.ts`（通过 composer 委托） |
| 设置思考等级 | `setSessionThinkingLevel()` | `driver.setSessionThinkingLevel(sessionRef, level)` | `app-store-composer.ts`（通过 composer 委托） |
| 重命名会话 | `renameSession()` | `driver.renameSession(sessionRef, title)` | `app-store-workspace.ts#L141` |
| 获取会话树 | `getSessionTree()` | `driver.getSessionTree(sessionRef)` | `app-store.ts#L618` |
| 导航会话树 | `navigateSessionTree()` | `driver.navigateSessionTree(sessionRef, targetId, options)` | `app-store.ts#L630` |
| 获取转录 | `getTranscript()` | `driver.getTranscript(sessionRef)` | `app-store-timeline.ts` |
| 响应 Host UI 请求 | `respondToHostUiRequest()` | `driver.respondToHostUiRequest(sessionRef, response)` | `app-store.ts#L1776-L1812` |
| 刷新运行时 | `refreshRuntime()` | `driver.runtimeSupervisor.refreshRuntime(ws)` | `app-store.ts#L820` |
| 设置默认模型 | `setDefaultModel()` | `driver.runtimeSupervisor.setDefaultModel(ws, selection)` | `app-store.ts#L837` |
| 设置项目默认模型 | `setDefaultModel()` (per-repo) | `driver.runtimeSupervisor.setProjectDefaultModel(ws, selection)` | `app-store.ts#L846` |
| 设置默认思考等级 | `setDefaultThinkingLevel()` | `driver.runtimeSupervisor.setDefaultThinkingLevel(ws, thinkingLevel)` | `app-store.ts#L860` |
| 设置项目思考等级 | `setDefaultThinkingLevel()` (per-repo) | `driver.runtimeSupervisor.setProjectDefaultThinkingLevel(ws, thinkingLevel)` | `app-store.ts#L869` |
| 登录提供商 | `loginProvider()` | `driver.runtimeSupervisor.login(ws, providerId, callbacks)` | `app-store.ts#L892` |
| 登出提供商 | `logoutProvider()` | `driver.runtimeSupervisor.logout(ws, providerId)` | `app-store.ts#L902` |
| 设置 API Key | `setProviderApiKey()` | `driver.runtimeSupervisor.setProviderApiKey(ws, providerId, apiKey)` | `app-store.ts#L908` |
| 设置技能命令 | `setEnableSkillCommands()` | `driver.runtimeSupervisor.setEnableSkillCommands(ws, enabled)` | `app-store.ts#L950` |
| 设置模型模式 | `setScopedModelPatterns()` | `driver.runtimeSupervisor.setScopedModelPatterns(ws, patterns)` | `app-store.ts#L959` |
| 设置技能启用 | `setSkillEnabled()` | `driver.runtimeSupervisor.setSkillEnabled(ws, filePath, enabled)` | `app-store.ts#L1261`（IPC）→ `withRuntimeUpdate()` |
| 设置扩展启用 | `setExtensionEnabled()` | `driver.runtimeSupervisor.setExtensionEnabled(ws, filePath, enabled)` | `app-store.ts#L1264`（IPC）→ `withRuntimeUpdate()` |
| 自定义提供商 | `setCustomProvider()` / `deleteCustomProvider()` | `driver.runtimeSupervisor.setCustomProvider()` / `deleteCustomProvider()` | `app-store.ts#L928` / `#L943` |
| 列出提供商 | `listCustomProviders()` | `driver.runtimeSupervisor.listCustomProviders()` | `app-store.ts#L914` |
| 生成线程标题 | `generateThreadTitle()` | `driver.generateThreadTitle(workspace, options)` | `app-store.ts`（通过 `generateThreadTitleOverride`） |

### 5.2 其他 Electron 主进程文件调用

| 文件 | 调用的 pi-sdk-driver 导出 | 用途 |
|---|---|---|
| `main.ts` | `isValidHttpBaseUrl`, `GenerateThreadTitleOptions`（类型） | 验证自定义提供商 URL |
| `notification-manager.ts` | `sessionKey` | 通知管理使用会话标识 |
| `session-state-map.ts` | `createEmptyExtensionUiState`, `ExtensionUiState`（类型） | 管理扩展 UI 状态 |
| `app-store-composer.ts` | `sessionKey` | 会话键标识 |
| `app-store-orchestration.ts` | `sessionKey` | 子会话编排键标识 |
| `app-store-timeline.ts` | `sessionKey`, `SessionTranscriptItem`（类型） | 时间线/转录标识 |
| `app-store-utils.ts` | `sessionKey` | 工具函数中会话标识 |
| `app-store-workspace.ts` | `sessionKey` | 工作区操作中会话标识 |
| `app-store-worktree.ts` | `sessionKey` | Git worktree 操作中会话标识 |

### 5.3 渲染进程中的类型引用

| 文件 | 引用 | 用途 |
|---|---|---|
| `desktop-state.ts` | `SessionSchemaInfo` 类型 | Schema 版本信息显示 |
| `timeline-item.tsx` | `SessionTranscriptMessage` 类型 | 时间线消息渲染 |
| `timeline-types.ts` | `SessionTranscriptMessage`, `SessionTranscriptRole` 类型 | 时间线类型定义 |

---

## 六、pi 底层包导入清单

以下是从 `@earendil-works/pi-coding-agent` 直接导入的具体类/函数及其使用位置：

### 6.1 `packages/pi-sdk-driver/src/session-supervisor.ts`

```typescript
import {
  ModelRegistry,          // 模型注册表（类型 + 运行时）
  SessionManager,         // 会话文件管理（CRUD、分叉、导航树、持久化）
  type AgentSessionRuntime,  // 会话运行时（类型）
  type AgentSession,      // 活跃会话（类型）
  type AgentSessionEvent, // 代理事件（类型）
  type CreateAgentSessionOptions, // 创建选项（类型）
  type ExtensionFactory,  // 扩展工厂（类型）
  type ExtensionCommandContextActions, // 扩展命令上下文（类型）
  type ExtensionUIContext, // UI 上下文（类型）
  type SessionInfo,       // 会话信息（类型）
} from "@earendil-works/pi-coding-agent";
```

### 6.2 `packages/pi-sdk-driver/src/runtime-supervisor.ts`

```typescript
import {
  DefaultPackageManager,  // 运行时包管理器
  DefaultResourceLoader,  // 资源加载器（技能、扩展）
  type PackageSource,
  SettingsManager,        // 设置管理器（全局+项目级）
  parseFrontmatter,       // 解析 Markdown 前置元数据
  stripFrontmatter,       // 剥离前置元数据
  type ExtensionFactory,
  type PathMetadata,
  type ResolvedPaths,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
```

### 6.3 `packages/pi-sdk-driver/src/runtime-deps.ts`

```typescript
import {
  AuthStorage,            // 认证存储（OAuth、API Key）
  ModelRegistry,          // 模型注册表
  getAgentDir,            // 获取代理配置目录
} from "@earendil-works/pi-coding-agent";
```

### 6.4 `packages/pi-sdk-driver/src/npm-package-fallback.ts`

```typescript
import {
  // 封装 pi SessionManager 的创建逻辑
  // 提供 npm 包依赖降级处理
  DefaultResourceLoader,
  DefaultPackageManager,
  SettingsManager,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
```

### 6.5 `packages/pi-sdk-driver/src/pi-sdk-driver.ts`

```typescript
import type {
  AuthStorage,            // 认证存储（类型）
  ModelRegistry,          // 模型注册表（类型）
} from "@earendil-works/pi-coding-agent";
```

### 6.6 桌面主进程（`apps/desktop/electron/main.ts`）

```typescript
import type {
  AgentToolResult,        // 工具调用结果（类型）
  ExtensionContext,       // 扩展上下文（类型）
} from "@earendil-works/pi-coding-agent";
```

---

## 七、调用关系图

```
┌──────────────────────────────────────────────────────────────────┐
│                         pi 核心包                                │
│              @earendil-works/pi-coding-agent@^0.80.6             │
│                                                                  │
│  AuthStorage  ModelRegistry  SessionManager  SettingsManager     │
│  AgentSession  AgentSessionRuntime  DefaultResourceLoader        │
│  DefaultPackageManager  parseFrontmatter  stripFrontmatter      │
└──────────────────────────┬───────────────────────────────────────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
     ▼                     ▼                     ▼
┌───────────────┐  ┌──────────────┐  ┌───────────────────┐
│ runtime-deps  │  │ runtime-     │  │ session-          │
│ (初始化)       │  │ supervisor   │  │ supervisor        │
│               │  │ (运行时管理)   │  │ (会话生命周期)     │
│ • AuthStorage │  │ • 认证       │  │ • 创建/打开/归档   │
│ • ModelReg    │  │ • 模型/设置   │  │ • 消息/取消       │
│ • agentDir    │  │ • 技能/扩展   │  │ • 分叉/导航树     │
└───────────────┘  └──────────────┘  └───────────────────┘
     │                     │                     │
     └─────────────────────┼─────────────────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │   PiSdkDriver    │
                  │  (统一接口)       │
                  └────────┬─────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │Main Proc │ │Composer  │ │Workspace │
        │app-store │ │Store     │ │Store     │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             └────────────┼────────────┘
                          │ IPC
                          ▼
                   ┌──────────────┐
                   │   Renderer   │
                   │  (React UI)  │
                   └──────────────┘
```
