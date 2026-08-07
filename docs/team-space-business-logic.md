# 团队空间功能 — 业务逻辑说明书

## 1. 功能概述

团队空间是桌面级应用（Electron）的核心协作模块，为用户提供：

- **团队空间列表管理**：查看、创建、搜索、编辑、删除个人团队空间
- **悬浮菜单操作**：鼠标悬停卡片 `⋮` 图标显示编辑/删除操作，150ms 延迟防闪烁
- **模板快速创建**：基于预设模板一键创建带指令的团队空间
- **智能体绑定**：创建/编辑时可多选 AI 智能体参与协作
- **团队空间详情**：展示动态、计划、任务、资产、智能体五个维度
- **文件资产上传**：支持 ≤100MB 的任意类型文件上传，上传失败可回滚
- **文件资产删除**：删除带确认弹框，磁盘写入失败自动回滚
- **本地持久化**：所有数据自动缓存到本地磁盘，应用重启后恢复

---

## 2. 页面结构

### 2.1 团队空间首页（ProjectHomeView）

| 区域 | 说明 |
|------|------|
| 顶部操作栏 | "新建团队空间"入口 + 页面标题 |
| 搜索框 | 按名称/描述过滤团队空间和模板 |
| 我的团队空间 | 卡片网格，点击进入详情；悬停 `⋮` 显示编辑/删除菜单 |
| 从模版创建 | 卡片网格，点击弹出带预置指令的创建弹窗 |

### 2.2 新建/编辑团队空间弹窗（NewProjectModal）

| 字段 | 类型 | 说明 |
|------|------|------|
| 团队空间名称 | 文本 | 必填，空时默认"未命名团队空间" |
| 指令 | 文本域 + 模板下拉 | 支持手动输入或从模板选择预置指令 |
| 智能体 | 多选下拉 | 从 5 个预置智能体中选择，可搜索/折叠 |

自动识别模式：
- **创建模式**：`activeProject.id` 不在 `myProjects` 中 → 标题"新建团队空间"，按钮"确定/创建中"
- **编辑模式**：`activeProject.id` 已存在 → 标题"修改团队空间"，按钮"保存/保存中"

### 2.3 团队空间详情页（ProjectDetailView）

五个 Tab：

| Tab | 数据来源 | 说明 |
|-----|----------|------|
| 动态 | 模拟接口 | 团队成员活动时间线 |
| 计划 | 模拟接口 | 看板模式（待处理/进行中/已完成） |
| 任务 | 模拟接口 | 带模式标识的任务列表 |
| 资产 | 用户上传 | 文件列表，支持上传（≤100MB）和删除 |
| 智能体 | 绑定数据 | 创建时选择的智能体映射展示 |

---

## 3. 数据模型

### 3.1 Project（团队空间）

```typescript
interface Project {
  id: string;                          // 唯一标识，新建时为 'new-' + Date.now()
  name: string;                        // 团队空间名称
  desc: string;                        // 描述
  icon: string;                        // 图标 emoji
  color: string;                       // 主题色（hex）
  directive?: string;                  // AI 指令
  agents?: string[];                   // 绑定的智能体 value 数组（如 ['pm', 'backend']）
  path?: string;                       // 预留：文件路径
  assets?: AssetItem[];                // 用户上传的资产列表（持久化）
}
```

### 3.2 AssetItem（资产/文件）

```typescript
interface AssetItem {
  icon: string;          // 文件类型图标 emoji
  name: string;          // 文件名
  meta: string;          // 元信息：大小 · 上传者 · 时间
  size?: number;         // 文件大小（bytes）
  uploadedAt?: string;   // 上传时间（HH:mm 格式）
}
```

### 3.3 AgentItem（智能体）

```typescript
interface AgentItem {
  id: string;       // 内部 ID
  name: string;     // 显示名称
  value: string;    // 唯一标识（存储在 Project.agents 中）
  desc: string;     // 描述
  icon: string;     // 图标 emoji
  color: string;    // 主题色
}
```

预置 5 个智能体：产品经理、后端开发、前端开发、测试工程师、架构设计。

### 3.4 ProjectTemplate（模板）

```typescript
interface ProjectTemplate {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  directive: string;  // 指令模板内容
}
```

预置 3 个模板：电商后端、B 端后台、测试工程。

---

## 4. 核心业务流程

### 4.1 应用启动流程

```
App.vue onMounted
  │
  ├─ store.initApp()              // 初始化全局设置
  │
  └─ projectStore.loadFromCache() // 从本地磁盘加载缓存
       │
       ├─ 调用 window.electronAPI.projectCacheLoad()
       │   → ipcRenderer.invoke('project:cache-load')
       │   → 主进程 fs.readFileSync(userData/project-data.json)
       │
       ├─ 缓存存在 → myProjects = 缓存数据
       └─ 缓存不存在 → 保留默认 3 个示例团队空间
```

### 4.2 防抖自动保存机制

```
myProjects 变更（任何增/删/改）
  │
  └─ watch(JSON.stringify(myProjects))  // 深度监听
       │
       └─ projectStore.scheduleSave(300)  // 300ms 防抖
            │
            └─ 300ms 后执行 saveToCache()
                 │
                 ├─ JSON.parse(JSON.stringify(myProjects))  // 剥离 Proxy
                 ├─ electronAPI.projectCacheSave(plain)
                 └─ 写入磁盘
```

**防抖说明**：300ms 内多次变更只触发一次保存。避免频繁磁盘 I/O。用户主动操作时会调用 `cancelScheduledSave()` 取消防抖保存，改用显式保存。

### 4.3 创建/编辑团队空间流程

```
用户操作入口
  ├─ 创建：首页"新建团队空间"按钮 → activeProject = null
  ├─ 模板创建：模板卡片 → activeProject = 模板数据
  └─ 编辑：卡片 ⋮ 菜单 → activeProject = 现有项目数据

NewProjectModal 打开
  │
  ├─ isEditMode 判断：id 在 myProjects 中存在 → 编辑模式
  │
  ├─ 编辑模式：
  │   projectStore.updateProject(id, payload) → 更新内存
  │   → 防抖保存自动触发
  │
  └─ 创建模式：
      projectStore.createProject(payload) → 加入列表
      → 防抖保存自动触发
```

### 4.4 进入团队空间详情流程

```
用户点击团队空间卡片
  │
  ├─ projectStore.setActiveProject(p)   // 保存当前项目引用
  └─ router.push('/project/:id')        // 路由跳转

ProjectDetailView onMounted → loadDetail()
  │
  ├─ project computed：
  │   activeProject 存在 → 使用它
  │   activeProject 为 null → 从 myProjects 按 id 查找
  │
  ├─ fetchProjectDetail(id)              // 获取详情数据
  │   预置项目（ecom/internal/data）→ 返回 mock 数据
  │   新建项目 → 返回空骨架数据
  │
  ├─ 资产数据：优先使用持久化的 proj.assets，无则回退 mock
  │
  └─ 智能体映射：
      project.agents（value 数组）→ DEFAULT_AGENT_CATALOG 过滤
      → 得到完整 AgentItem[] 用于展示
```

### 4.5 文件上传流程（含异常回滚）

```
用户在资产 Tab 点击"上传文件"
  │
  ├─ beforeUpload 校验：size ≤ 100MB
  │
  └─ handleUpload(file)
       │
       ├─ projectStore.uploadAsset(file, projectId)
       │   │
       │   ├─ try: await delay(模拟网络延迟)
       │   │   ├─ 生成 AssetItem
       │   │   ├─ proj.assets.push(asset)   // 写入内存
       │   │   └─ return { success: true, asset }
       │   │
       │   └─ catch: return { success: false, asset }  // 不污染内存
       │
       ├─ 上传失败 → ElMessage.error → 终止
       │
       ├─ 上传成功 → 取消防抖保存
       │
       ├─ await saveToCache()  ← 显式等待磁盘写入
       │   │
       │   ├─ 成功 → assets.value.unshift() → ElMessage.success
       │   │
       │   └─ 失败 → 回滚内存（移除刚写入的 asset）
       │            → ElMessage.error（上传成功但磁盘写入失败，已自动回滚）
       │
       └─ finally: uploadLoading = false
```

### 4.6 文件删除流程（含异常回滚）

```
用户点击资产行删除按钮
  │
  ├─ askDeleteAsset(index) → 弹出确认对话框
  │
  └─ confirmDeleteAsset()
       │
       ├─ 取消防抖保存
       │
       ├─ projectStore.deleteAsset(projectId, index)
       │   │
       │   ├─ 从 proj.assets.splice(index, 1)
       │   └─ return { ok: true, rolledBack: removedAsset }
       │
       ├─ 乐观更新：assets.value.splice(index, 1)
       │
       ├─ await saveToCache()  ← 显式等待磁盘写入
       │   │
       │   ├─ 成功 → ElMessage.success('文件已删除')
       │   │
       │   └─ 失败 → 完整回滚：
       │            1. assets.value.splice(index, 0, removed)  // 恢复 UI
       │            2. proj.assets.splice(index, 0, rolledBack)  // 恢复 store
       │            → ElMessage.error('磁盘写入失败，文件删除已回滚')
       │
       └─ pendingDeleteAsset = null
```

### 4.7 团队空间删除流程（含异常回滚）

```
用户点击卡片 ⋮ 菜单 → 删除 → 确认弹框
  │
  └─ confirmDelete()
       │
       ├─ 取消防抖保存
       ├─ 备份 removed = myProjects[idx]
       ├─ projectStore.deleteProject(id)
       ├─ await saveToCache()
       │   │
       │   ├─ 成功 → ElMessage.success('团队空间已删除')
       │   │
       │   └─ 失败 → 回滚 myProjects.splice(idx, 0, removed)
       │            → ElMessage.error('磁盘写入失败，删除已回滚')
       │
       └─ pendingDeleteId = null
```

---

## 5. 双层保存架构

### 5.1 防抖自动保存（后台安全网）

| 属性 | 说明 |
|------|------|
| 触发条件 | `myProjects` 任何变更 |
| 延迟 | 300ms 防抖 |
| 位置 | App.vue watch |
| 失败处理 | `saveToCache()` 内部 try/catch → `console.error`（静默） |
| 适用场景 | 常规变更（创建/编辑等不需要立即确认的操作） |

### 5.2 显式保存（用户操作保障）

| 属性 | 说明 |
|------|------|
| 触发条件 | 用户主动操作（上传/删除） |
| 流程 | `cancelScheduledSave()` → 操作 → `saveToCache()` → 失败回滚 |
| 位置 | ProjectDetailView / ProjectHomeView |
| 失败处理 | 回滚内存 + `ElMessage.error` 用户提示 |
| 适用场景 | 需要原子性保障的关键操作 |

### 5.3 互斥机制

```
用户操作时：
  1. cancelScheduledSave()  → 取消防抖保存（若已触发）
  2. 执行业务操作
  3. saveToCache()          → 显式保存
  4. 成功 → 更新 UI
  5. 失败 → 回滚内存 + 提示用户

非用户操作时（如首次加载后的数据）：
  1. 仅依赖防抖保存
  2. 300ms 后自动写入磁盘
```

---

## 6. 本地缓存机制

### 6.1 缓存位置

使用 Electron `app.getPath('userData')` 获取跨平台用户数据目录：

| 系统 | 路径 |
|------|------|
| Windows | `%APPDATA%/<app-name>/project-data.json` |
| macOS | `~/Library/Application Support/<app-name>/project-data.json` |
| Linux | `~/.config/<app-name>/project-data.json` |

### 6.2 缓存文件格式

```json
{
  "version": 1,
  "savedAt": "2026-08-06T10:30:00.000Z",
  "myProjects": [
    {
      "id": "new-1741392000000",
      "name": "电商后端系统",
      "desc": "订单、库存、支付核心服务迭代",
      "icon": "🛒",
      "color": "#e9f7ef",
      "directive": "...",
      "agents": ["pm", "backend"],
      "assets": [
        {
          "icon": "📄",
          "name": "API设计规范v3.pdf",
          "meta": "2.1 MB · 我 上传于 14:30",
          "size": 2202000,
          "uploadedAt": "14:30"
        }
      ]
    }
  ]
}
```

### 6.3 IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `project:cache-load` | 渲染进程 → 主进程 | 读取缓存文件 |
| `project:cache-save` | 渲染进程 → 主进程 | 写入缓存文件 |

### 6.4 安全保障

- **Proxy 剥离**：使用 `JSON.parse(JSON.stringify(...))` 剥离 Pinia/Vue 的响应式 Proxy，确保 IPC Structured Clone 兼容
- **异常隔离**：缓存读写均 try/catch，失败不影响应用运行
- **启动恢复**：首次加载失败时保留内存中的默认数据，用户仍可正常使用
- **原子写入**：用户操作使用显式保存，确保磁盘写入与内存状态一致

---

## 7. 状态管理架构

```
Pinia Store (project.ts)
  │
  ├─ 状态
  │   ├─ myProjects: Project[]      // 团队空间列表（持久化）
  │   ├─ activeProject: Project|null // 当前选中项目（内存态）
  │   └─ newProjectVisible: boolean  // 弹窗开关
  │
  ├─ CRUD 方法
  │   ├─ setActiveProject()         // 设置当前项目
  │   ├─ addProject()               // 添加项目（内部使用）
  │   ├─ createProject()            // 创建新项目并加入列表
  │   ├─ updateProject()            // 更新项目（name/desc/directive/agents）
  │   ├─ deleteProject()            // 删除项目
  │   ├─ uploadAsset()              // 上传资产（含内存写入）
  │   └─ deleteAsset()              // 删除资产（返回被删除数据用于回滚）
  │
  ├─ 持久化方法
  │   ├─ loadFromCache()            // 磁盘 → 内存
  │   ├─ saveToCache()              // 内存 → 磁盘
  │   ├─ scheduleSave(delay)        // 防抖调度保存
  │   └─ cancelScheduledSave()      // 取消防抖保存
  │
  └─ 模拟接口
      ├─ fetchMyProjects()          // 获取列表
      ├─ fetchTemplates()           // 获取模板
      └─ fetchProjectDetail()       // 获取详情
```

### 数据流原则

1. **单一数据源**：团队空间数据只存储在 `projectStore.myProjects` 中
2. **双重持久化**：防抖自动保存（后台）+ 显式保存（用户操作）
3. **启动即恢复**：应用启动时 `onMounted` 优先从磁盘加载
4. **失败可回滚**：显式保存失败时，内存数据可完整回滚
5. **模板/智能体**：只读常量，不参与持久化

---

## 8. 预置数据

### 8.1 默认团队空间（首次启动）

| ID | 名称 | 描述 | 智能体 |
|----|------|------|--------|
| ecom | 电商后端系统 | 订单、库存、支付核心服务迭代 | backend, qa |
| internal | 内部管理系统 | 人事、财务、审批流程数字化 | pm, frontend |
| data | 数据中台 | 统一数据服务与报表平台 | architect, backend |

### 8.2 预置模板

| ID | 名称 | 说明 |
|----|------|------|
| t1 | 电商后端模板 | 包含订单、库存、支付初始化智能体 |
| t2 | B 端后台模板 | RBAC、审批流、数据表格常用配置 |
| t3 | 测试工程模板 | 自动化测试、覆盖率、CI 配置预设 |

### 8.3 预置智能体

| Value | 名称 | 说明 |
|-------|------|------|
| pm | 产品经理智能体 | 需求分析与产品规划 |
| backend | 后端开发智能体 | 接口设计与代码实现 |
| frontend | 前端开发智能体 | UI 实现与交互优化 |
| qa | 测试工程师智能体 | 自动化测试与质量保障 |
| architect | 架构设计智能体 | 系统架构与技术选型 |

---

## 9. 文件清单

| 文件 | 职责 |
|------|------|
| `src/renderer/src/stores/project.ts` | Pinia store：状态、CRUD、模拟接口、缓存读写、防抖保存 |
| `src/renderer/src/types.ts` | 全局类型定义：`Project`（含 `assets` 字段） |
| `src/renderer/src/components/ProjectHomeView.vue` | 团队空间首页：列表、搜索、悬浮菜单、编辑/删除 |
| `src/renderer/src/components/NewProjectModal.vue` | 新建/编辑弹窗：表单、模板、智能体选择 |
| `src/renderer/src/components/ProjectDetailView.vue` | 详情页：五个 Tab、文件上传/删除 + 异常回滚 |
| `src/renderer/src/App.vue` | 根组件：启动加载 + 防抖自动保存 |
| `src/main/project-cache.ts` | 主进程：IPC 缓存读写处理 |
| `src/preload/index.ts` | 预加载：暴露缓存 API 到渲染进程 |
| `src/shared/ipc-channels.ts` | IPC 通道常量定义 |