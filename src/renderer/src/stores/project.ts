import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Project } from '../types';

export interface ProjectTemplate {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  directive: string;
}

export interface CreateProjectPayload {
  name: string;
  desc: string;
  icon?: string;
  color?: string;
  directive?: string;
  agents?: string[];
}

export interface FeedItem {
  avatar: string;
  color: string;
  color2: string;
  text: string;
  time: string;
}

export interface PlanColumn {
  col: string;
  cards: string[];
}

export interface TaskItem {
  mode: 'simple' | 'agent';
  title: string;
  owner: string;
}

export interface AssetItem {
  icon: string;
  name: string;
  meta: string;
  size?: number;
  uploadedAt?: string;
}

export interface UploadAssetResult {
  success: boolean;
  asset: AssetItem;
}

export interface AgentItem {
  id: string;
  name: string;
  value: string;
  desc: string;
  icon: string;
  color: string;
}

export interface ProjectDetailData {
  feeds: FeedItem[];
  plans: PlanColumn[];
  tasks: TaskItem[];
  assets: AssetItem[];
  agents: AgentItem[];
}

const DEFAULT_TEMPLATES: ProjectTemplate[] = [
  { id: 't1', name: '电商后端模板', desc: '包含订单、库存、支付初始化智能体', icon: '🛍️', color: '#fff7e6', directive: '你是电商后端团队空间的AI助手。团队负责订单、库存、支付等核心服务的迭代。请关注高并发场景、数据一致性、接口兼容性。输出方案需考虑水平扩展和容灾策略。' },
  { id: 't2', name: 'B 端后台模板', desc: 'RBAC、审批流、数据表格常用配置', icon: '🖥️', color: '#f3f4f6', directive: '你是B端后台团队空间的AI助手。团队负责内部管理系统的开发，涉及RBAC权限、审批流程、复杂数据表格。请关注可维护性、数据校验和用户体验。' },
  { id: 't3', name: '测试工程模板', desc: '自动化测试、覆盖率、CI 配置预设', icon: '🧪', color: '#e9f7ef', directive: '你是测试工程团队空间的AI助手。团队负责自动化测试、覆盖率提升和CI/CD流水线建设。请关注测试用例设计、边界条件、性能测试和持续集成。' },
];

export const DEFAULT_AGENT_CATALOG: AgentItem[] = [
  { id: '1', name: '产品经理智能体', value: 'pm', desc: '需求分析与产品规划', icon: '📋', color: '#e0f2fe' },
  { id: '2', name: '后端开发智能体', value: 'backend', desc: '接口设计与代码实现', icon: '⚙️', color: '#ede9fe' },
  { id: '3', name: '前端开发智能体', value: 'frontend', desc: 'UI 实现与交互优化', icon: '🎨', color: '#fef3c7' },
  { id: '4', name: '测试工程师智能体', value: 'qa', desc: '自动化测试与质量保障', icon: '🧪', color: '#e9f7ef' },
  { id: '5', name: '架构设计智能体', value: 'architect', desc: '系统架构与技术选型', icon: '🏛️', color: '#fce7f3' },
];

const DETAIL_DATA_MAP: Record<string, ProjectDetailData> = {
  ecom: {
    feeds: [
      { avatar: '林', color: 'var(--primary-light)', color2: 'var(--primary)', text: '<b>林晓</b> 将任务 <b>接口设计讨论</b> 公开到团队空间', time: '20 分钟前' },
      { avatar: 'AI', color: '#e9f7ef', color2: 'var(--success)', text: '自动化巡检：昨日 <b>8 / 8</b> 个单元测试通过，覆盖率 <b>92%</b>', time: '1 小时前' },
      { avatar: '王', color: '#fef3c7', color2: '#f59e0b', text: '<b>王铭</b> 更新了团队空间资料库 <b>API 设计规范 v3.pdf</b>', time: '3 小时前' },
    ],
    plans: [
      { col: '待处理', cards: ['Q3 支付链路重构', '库存扣减幂等性优化'] },
      { col: '进行中', cards: ['订单服务单元测试补全'] },
      { col: '已完成', cards: ['用户模块接口文档生成'] },
    ],
    tasks: [
      { mode: 'simple', title: '接口设计讨论', owner: '林晓' },
      { mode: 'agent', title: '自动化测试生成', owner: 'AI' },
      { mode: 'simple', title: '数据库优化方案', owner: '林晓' },
    ],
    assets: [
      { icon: '📄', name: 'API 设计规范 v3.pdf', meta: '2.1 MB · 王铭 更新于 3 小时前' },
      { icon: '📊', name: 'Q3 销售数据.xlsx', meta: '1.2 MB · 林晓 上传于 昨天' },
      { icon: '📝', name: '订单服务测试报告.md', meta: '0.3 MB · AI 生成于 1 小时前' },
    ],
    agents: DEFAULT_AGENT_CATALOG.filter((a) => ['backend', 'qa'].includes(a.value)),
  },
  internal: {
    feeds: [
      { avatar: '李', color: 'var(--primary-light)', color2: 'var(--primary)', text: '<b>李明</b> 更新了 <b>审批流程 v2</b>', time: '10 分钟前' },
      { avatar: 'AI', color: '#ede9fe', color2: 'var(--success)', text: 'AI 助手：检测到 <b>3 个</b> 接口未做权限校验', time: '45 分钟前' },
    ],
    plans: [
      { col: '待处理', cards: ['RBAC 权限模型重构'] },
      { col: '进行中', cards: ['财务审批流上线'] },
      { col: '已完成', cards: ['人事模块 API 文档', '登录模块优化'] },
    ],
    tasks: [
      { mode: 'agent', title: 'RBAC 代码审查', owner: 'AI' },
      { mode: 'simple', title: '审批节点讨论', owner: '李明' },
    ],
    assets: [
      { icon: '📄', name: 'RBAC 设计文档.pdf', meta: '1.5 MB · 李明 更新于 1 小时前' },
      { icon: '📝', name: '审批流程配置.md', meta: '0.8 MB · 李明 更新于 2 天前' },
    ],
    agents: DEFAULT_AGENT_CATALOG.filter((a) => ['pm', 'frontend'].includes(a.value)),
  },
  data: {
    feeds: [
      { avatar: '张', color: 'var(--primary-light)', color2: 'var(--primary)', text: '<b>张伟</b> 发布了数据看板 <b>实时销售大屏</b>', time: '30 分钟前' },
      { avatar: 'AI', color: '#e0f2fe', color2: 'var(--success)', text: '数据质量报告：<b>12 项</b> 指标全部达标', time: '2 小时前' },
    ],
    plans: [
      { col: '待处理', cards: ['实时数仓搭建'] },
      { col: '进行中', cards: ['报表平台前端重构', '数据治理规范'] },
      { col: '已完成', cards: ['数据中台一期上线'] },
    ],
    tasks: [
      { mode: 'simple', title: '指标口径对齐', owner: '张伟' },
      { mode: 'agent', title: '数据血缘分析', owner: 'AI' },
      { mode: 'agent', title: '异常数据检测', owner: 'AI' },
    ],
    assets: [
      { icon: '📊', name: '实时销售大屏.xlsx', meta: '3.2 MB · 张伟 更新于 30 分钟前' },
      { icon: '📄', name: '数据治理规范.pdf', meta: '1.8 MB · 张伟 更新于 1 天前' },
    ],
    agents: DEFAULT_AGENT_CATALOG.filter((a) => ['architect', 'backend'].includes(a.value)),
  },
};

function delay<T>(data: T, ms = 300): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), ms));
}

export const useProjectStore = defineStore('project', () => {
  const newProjectVisible = ref(false);
  const activeProject = ref<Project | null>(null);
  const myProjects = ref<Project[]>([
    { id: 'ecom', name: '电商后端系统', desc: '订单、库存、支付核心服务迭代', icon: '🛒', color: '#e9f7ef', directive: '负责电商后端核心服务，关注订单、库存、支付系统的高并发处理与数据一致性。' },
    { id: 'internal', name: '内部管理系统', desc: '人事、财务、审批流程数字化', icon: '🏢', color: '#ede9fe', directive: '负责内部管理系统开发，涉及人事、财务模块与审批流程，关注可维护性和流程可扩展性。' },
    { id: 'data', name: '数据中台', desc: '统一数据服务与报表平台', icon: '📊', color: '#e0f2fe', directive: '负责数据中台建设，提供统一数据服务与报表能力，关注数据治理、实时计算与可视化。' },
  ]);

  function setActiveProject(p: Project | null) {
    activeProject.value = p;
  }
  function addProject(p: Project) {
    myProjects.value.push(p);
  }
  function updateProject(id: string, payload: Partial<CreateProjectPayload>) {
    const idx = myProjects.value.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const current = myProjects.value[idx];
    myProjects.value[idx] = {
      ...current,
      name: payload.name ?? current.name,
      desc: payload.desc ?? current.desc,
      icon: payload.icon ?? current.icon,
      color: payload.color ?? current.color,
      directive: payload.directive ?? current.directive,
      agents: payload.agents ?? current.agents,
    };
  }
  function deleteProject(id: string) {
    const idx = myProjects.value.findIndex((p) => p.id === id);
    if (idx !== -1) myProjects.value.splice(idx, 1);
  }

  // ---- 模拟接口 ----
  async function fetchMyProjects(): Promise<Project[]> {
    return delay([...myProjects.value]);
  }

  async function fetchTemplates(): Promise<ProjectTemplate[]> {
    return delay(DEFAULT_TEMPLATES);
  }

  async function createProject(payload: CreateProjectPayload): Promise<Project> {
    const project: Project = {
      id: 'new-' + Date.now(),
      name: payload.name,
      desc: payload.desc,
      icon: payload.icon || '📁',
      color: payload.color || '#e9f7ef',
      directive: payload.directive || '',
      agents: payload.agents,
    };
    return delay(project).then((p) => {
      myProjects.value.push(p);
      return p;
    });
  }

  async function fetchProjectDetail(projectId: string): Promise<ProjectDetailData> {
    const data = DETAIL_DATA_MAP[projectId];
    if (data) {
      return delay(JSON.parse(JSON.stringify(data)));
    }
    return delay({
      feeds: [
        { avatar: 'A', color: 'var(--primary-light)', color2: 'var(--primary)', text: '<b>AI</b> 已初始化团队空间', time: '刚刚' },
      ],
      plans: [
        { col: '待处理', cards: ['创建第一个任务'] },
        { col: '进行中', cards: [] },
        { col: '已完成', cards: [] },
      ],
      tasks: [],
      assets: [],
      agents: [],
    });
  }

  async function uploadAsset(file: File, projectId: string): Promise<UploadAssetResult> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const sizeMB = file.size / 1024 / 1024;
    const iconMap: Record<string, string> = {
      pdf: '📄',
      doc: '📝', docx: '📝',
      xls: '📊', xlsx: '📊', csv: '📊',
      ppt: '📑', pptx: '📑',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
      zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
      mp4: '🎬', mov: '🎬', avi: '🎬',
      mp3: '🎵', wav: '🎵', flac: '🎵',
      txt: '📝', md: '📝', json: '📝', js: '📝', ts: '📝',
      py: '🐍', java: '☕', go: '🐹', rs: '🦀', cpp: '📝', c: '📝',
    };
    const icon = iconMap[ext] || '📎';
    const sizeStr = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const asset: AssetItem = {
      icon,
      name: file.name,
      meta: `${sizeStr} · 我 上传于 刚刚`,
      size: file.size,
      uploadedAt: timeStr,
    };
    try {
      await delay(null, 600 + Math.random() * 400);
      const proj = myProjects.value.find((p) => p.id === projectId);
      if (proj) {
        if (!proj.assets) proj.assets = [];
        proj.assets.push(asset);
      }
      return { success: true, asset };
    } catch (e) {
      console.error('[project-store] uploadAsset failed:', e);
      return { success: false, asset };
    }
  }

  function deleteAsset(projectId: string, index: number): { ok: boolean; rolledBack?: AssetItem } {
    const proj = myProjects.value.find((p) => p.id === projectId);
    if (!proj?.assets || index < 0 || index >= proj.assets.length) return { ok: false };
    const [removed] = proj.assets.splice(index, 1);
    return { ok: true, rolledBack: removed };
  }

  async function loadFromCache(): Promise<boolean> {
    try {
      const api = window.electronAPI;
      if (!api?.projectCacheLoad) return false;
      const result = await api.projectCacheLoad();
      if (result.ok && result.data?.myProjects) {
        myProjects.value = result.data.myProjects as Project[];
        return true;
      }
      return false;
    } catch (e) {
      console.error('[project-store] loadFromCache failed:', e);
      return false;
    }
  }

  async function saveToCache(): Promise<boolean> {
    try {
      const api = window.electronAPI;
      if (!api?.projectCacheSave) return false;
      const plain = JSON.parse(JSON.stringify(myProjects.value));
      const result = await api.projectCacheSave(plain);
      return result.ok;
    } catch (e) {
      console.error('[project-store] saveToCache failed:', e);
      return false;
    }
  }

  let _saveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSave(delay = 300) {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      await saveToCache();
      _saveTimer = null;
    }, delay);
  }

  function cancelScheduledSave() {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
  }

  return {
    newProjectVisible,
    activeProject,
    myProjects,
    setActiveProject,
    addProject,
    updateProject,
    deleteProject,
    fetchMyProjects,
    fetchTemplates,
    createProject,
    fetchProjectDetail,
    uploadAsset,
    deleteAsset,
    loadFromCache,
    saveToCache,
    scheduleSave,
    cancelScheduledSave,
  };
});
