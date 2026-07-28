/** 首页加载类型 */
export type HomepageType = 'default' | 'url' | 'file';

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

/** Pi Agent 配置 */
export interface PiConfig {
  /** Pi 更新清单地址 */
  updateManifestUrl?: string;
  /** Pi 启动命令行参数 */
  args?: string[];
  /** 允许自定义扩展字段 */
  [key: string]: unknown;
}

/** 应用配置 */
export interface AppConfig {
  homepage: HomepageConfig;
  pi: PiConfig;
  /** 应用图标/Logo 路径，支持相对路径或绝对路径 */
  logo?: string;
  /** 允许自定义扩展字段 */
  [key: string]: unknown;
}
