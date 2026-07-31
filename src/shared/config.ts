/** 首页加载类型。新增 `native` 表示纯原生 UI 模式，原有三种模式保持不变 */
export type HomepageType = 'default' | 'url' | 'file' | 'native';

/** 首页配置 */
export interface HomepageConfig {
  /** 首页加载类型 */
  type: HomepageType;
  /** 当 type 为 url 时使用 */
  url?: string;
  /** 当 type 为 file 时使用，支持绝对路径或相对 config 目录的相对路径 */
  file?: string;
  /** 窗口标题 */
  title?: string;
  /** 允许自定义扩展字段 */
  [key: string]: unknown;
}

/** 单个模型配置 */
export interface ModelConfig {
  /** 模型提供商，例如 openai / anthropic */
  provider: string;
  /** 模型 ID，例如 gpt-4o */
  modelId: string;
  /** API Key 明文（优先使用） */
  apiKey?: string;
  /** 存放 API Key 的环境变量名 */
  apiKeyEnv?: string;
  /** 自定义 API 基础地址 */
  baseUrl?: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 允许自定义扩展字段 */
  [key: string]: unknown;
}

/** 模型配置组：key 为模型别名 */
export interface ModelsConfig {
  [key: string]: ModelConfig;
}

/** Pi Agent 配置 */
export interface PiConfig {
  /** Pi 更新清单地址 */
  updateManifestUrl?: string;
  /** Pi 启动命令行参数 */
  args?: string[];
  /** 允许自定义扩展字段 */
  [key: string]: unknown;
}

/** 原生模式配置 */
export interface NativeConfig {
  /** 默认工作区路径 */
  defaultWorkspace?: string;
  /** SQLite 数据库路径，留空时使用 userData/native.sqlite */
  sqliteDb?: string;
  /** 允许自定义扩展字段 */
  [key: string]: unknown;
}

/** 应用配置 */
export interface AppConfig {
  homepage: HomepageConfig;
  pi: PiConfig;
  /** 模型配置组 */
  models?: ModelsConfig;
  /** 当前选中的模型别名 */
  selectedModel?: string;
  /** 原生模式配置 */
  native?: NativeConfig;
  /** 应用图标/Logo 路径，支持相对路径或绝对路径 */
  logo?: string;
  /** 是否允许使用 F12 打开网页开发者工具 */
  devTools?: boolean;
  /** 主题模式：dark 或 light */
  theme?: 'dark' | 'light';
  /** 全局字体缩放倍率 */
  fontScale?: number;
  /** 允许自定义扩展字段 */
  [key: string]: unknown;
}
