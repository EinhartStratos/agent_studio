import { createRuntimeDependencies, getAgentDir } from './runtime-deps';
import type { RuntimeDependencies } from './types';

/** 运行时资源管理器：认证、模型、设置 */
export class RuntimeSupervisor {
  private deps?: RuntimeDependencies;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** 初始化运行时 */
  async initialize(): Promise<RuntimeDependencies> {
    this.deps = await createRuntimeDependencies(this.cwd);
    return this.deps;
  }

  /** 获取运行时依赖 */
  getDependencies(): RuntimeDependencies {
    if (!this.deps) throw new Error('RuntimeSupervisor not initialized');
    return this.deps;
  }

  /** 获取 Agent 目录 */
  getAgentDir(): string {
    return getAgentDir();
  }

  /** 获取模型运行时 */
  getModelRuntime() {
    if (!this.deps) throw new Error('RuntimeSupervisor not initialized');
    return this.deps.modelRuntime;
  }

  /** 获取设置管理器 */
  getSettingsManager() {
    if (!this.deps) throw new Error('RuntimeSupervisor not initialized');
    return this.deps.settingsManager;
  }
}
