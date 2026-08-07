<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type UploadProps } from 'element-plus';
import { useAppStore, useProjectStore } from '../stores/app';
import type { FeedItem, PlanColumn, TaskItem, AssetItem, AgentItem } from '../stores/project';
import { DEFAULT_AGENT_CATALOG } from '../stores/project';

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const projectStore = useProjectStore();
const activeTab = ref('feed');
const loading = ref(true);
const uploadLoading = ref(false);
const MAX_FILE_SIZE = 100 * 1024 * 1024;

const tabs = [
  { id: 'feed', label: '动态' },
  { id: 'plan', label: '计划' },
  { id: 'tasks', label: '任务' },
  { id: 'assets', label: '资产' },
  { id: 'agents', label: '智能体' },
];

const project = computed(() => {
  if (projectStore.activeProject) return projectStore.activeProject;
  const id = route.params.id as string;
  return projectStore.myProjects.find((p) => p.id === id) || { name: '未命名团队空间', desc: '', icon: '📁', color: '#e9f7ef', directive: '', agents: [] };
});

const feeds = ref<FeedItem[]>([]);
const plans = ref<PlanColumn[]>([]);
const tasks = ref<TaskItem[]>([]);
const assets = ref<AssetItem[]>([]);
const projectAgents = ref<AgentItem[]>([]);
const pendingDeleteAsset = ref<number | null>(null);

/**
 * 文件上传前校验
 * 限制：文件大小 ≤ 100MB，类型不限
 */
const beforeUpload: UploadProps['beforeUpload'] = (file) => {
  if (file.size > MAX_FILE_SIZE) {
    ElMessage.error(`文件大小不能超过 100MB，当前: ${(file.size / 1024 / 1024).toFixed(1)} MB`);
    return false;
  }
  return true;
};

/**
 * 上传文件并持久化
 * 流程：store.uploadAsset → 取消防抖保存 → 显式等待 saveToCache → 失败时回滚
 * 说明：store.uploadAsset 内部已做 try/catch，只有成功才写入内存
 *       watch 使用 300ms 防抖保存，用户操作前先 cancelScheduledSave 避免双写
 */
async function handleUpload(file: File) {
  uploadLoading.value = true;
  try {
    const id = route.params.id as string;
    const result = await projectStore.uploadAsset(file, id);
    if (!result.success) {
      ElMessage.error(`文件 "${file.name}" 上传失败`);
      return;
    }
    // 取消防抖保存，避免与显式保存冲突
    projectStore.cancelScheduledSave();
    const saveOk = await projectStore.saveToCache();
    if (!saveOk) {
      // 回滚：从 store 中移除刚写入的资产
      const proj = projectStore.myProjects.find((p) => p.id === id);
      if (proj?.assets) {
        const idx = proj.assets.findIndex((a) => a.name === file.name && a.size === file.size);
        if (idx !== -1) proj.assets.splice(idx, 1);
      }
      ElMessage.error(`文件 "${file.name}" 上传成功但磁盘写入失败，已自动回滚`);
      return;
    }
    assets.value.unshift(result.asset);
    ElMessage.success(`文件 "${file.name}" 上传成功`);
  } catch {
    ElMessage.error(`文件 "${file.name}" 上传失败`);
  } finally {
    uploadLoading.value = false;
  }
}

/**
 * 加载团队空间详情
 * 数据优先级：持久化 assets（本地磁盘） > mock 数据
 */
async function loadDetail() {
  loading.value = true;
  try {
    const id = route.params.id as string;
    const data = await projectStore.fetchProjectDetail(id);
    feeds.value = data.feeds;
    plans.value = data.plans;
    tasks.value = data.tasks;

    // 优先使用磁盘持久化的资产数据
    const proj = projectStore.myProjects.find((p) => p.id === id);
    assets.value = proj?.assets?.length ? [...proj.assets] : data.assets;

    // 智能体映射：activeProject.agents（value数组）→ 完整 AgentItem 对象
    const projectAgentsIds = project.value?.agents;
    projectAgents.value = projectAgentsIds?.length
      ? DEFAULT_AGENT_CATALOG.filter((a) => (projectAgentsIds as string[]).includes(a.value))
      : data.agents;
  } finally {
    loading.value = false;
  }
}

onMounted(loadDetail);

/** 打开删除确认弹框 */
function askDeleteAsset(index: number) {
  pendingDeleteAsset.value = index;
}

/** 取消删除 */
function cancelDeleteAsset() {
  pendingDeleteAsset.value = null;
}

/**
 * 确认删除文件
 * 流程：取消防抖保存 → store.deleteAsset → 显式 saveToCache → 失败时完整回滚
 * 回滚逻辑：同时恢复内存中的 store 数据和 UI 列表
 */
async function confirmDeleteAsset() {
  if (pendingDeleteAsset.value === null) return;
  const index = pendingDeleteAsset.value;
  const id = route.params.id as string;
  const removed = assets.value[index];
  // 取消 watch 防抖，与显式保存互斥
  projectStore.cancelScheduledSave();
  const result = projectStore.deleteAsset(id, index);
  if (!result.ok) {
    ElMessage.error('删除失败');
    pendingDeleteAsset.value = null;
    return;
  }
  // 先更新 UI（乐观更新）
  assets.value.splice(index, 1);
  // 显式等待磁盘写入
  const saveOk = await projectStore.saveToCache();
  if (!saveOk) {
    // 回滚：恢复 UI 数据
    assets.value.splice(index, 0, removed);
    // 回滚：恢复 store 数据
    const proj = projectStore.myProjects.find((p) => p.id === id);
    if (proj && result.rolledBack) {
      if (!proj.assets) proj.assets = [];
      proj.assets.splice(index, 0, result.rolledBack);
    }
    ElMessage.error('磁盘写入失败，文件删除已回滚');
    return;
  }
  ElMessage.success('文件已删除');
  pendingDeleteAsset.value = null;
}
</script>

<template>
  <div class="project-detail active">
    <div class="pd-header">
      <button class="pd-back" @click="router.push('/projects')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        返回
      </button>
      <div class="pd-title-wrap">
        <div class="pd-icon" :style="{ background: project.color }">{{ project.icon }}</div>
        <div class="pd-title-info">
          <h2>{{ project.name }}</h2>
          <p>{{ project.desc }}</p>
        </div>
      </div>
      <button class="pd-invite-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        邀请
      </button>
    </div>
    <div class="pd-tabs">
      <div
        v-for="t in tabs"
        :key="t.id"
        class="pd-tab"
        :class="{ active: activeTab === t.id }"
        @click="activeTab = t.id"
      >
        {{ t.label }}
      </div>
    </div>
    <div class="pd-body">
      <div v-if="activeTab === 'feed'" class="pd-pane active">
        <div class="feed-list">
          <div v-for="(f, i) in feeds" :key="i" class="feed-item">
            <div class="feed-avatar" :style="{ background: f.color, color: f.color2 }">{{ f.avatar }}</div>
            <div class="feed-content">
              <div class="feed-text" v-html="f.text"></div>
              <div class="feed-time">{{ f.time }}</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'plan'" class="pd-pane active">
        <div class="plan-board">
          <div v-for="col in plans" :key="col.col" class="plan-col">
            <div class="plan-col-title">{{ col.col }}</div>
            <div v-for="card in col.cards" :key="card" class="plan-card" :class="{ done: col.col === '已完成' }">{{ card }}</div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'tasks'" class="pd-pane active">
        <div class="pd-task-list">
          <div v-for="(t, i) in tasks" :key="i" class="pd-task-item">
            <span class="mode-dot" :class="t.mode"></span>
            <span class="pd-task-title">{{ t.title }}</span>
            <span class="pd-task-owner">{{ t.owner }}</span>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'assets'" class="pd-pane active">
        <div class="asset-toolbar">
          <span class="asset-usage">存储空间已用 3.6 MB / 5.00 GB</span>
          <el-upload
            :auto-upload="true"
            :show-file-list="false"
            :before-upload="beforeUpload"
            :http-request="(opts: { file: File }) => handleUpload(opts.file)"
          >
            <button class="asset-upload-btn" :disabled="uploadLoading">
              <span v-if="!uploadLoading">上传文件</span>
              <span v-else>上传中...</span>
            </button>
          </el-upload>
        </div>
        <div class="asset-list">
          <div v-for="(a, i) in assets" :key="i" class="asset-item">
            <span class="asset-icon">{{ a.icon }}</span>
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ a.name }}</span>
            <span class="asset-meta">{{ a.meta }}</span>
            <button
              class="flex items-center justify-center w-[26px] h-[26px] border-none rounded-md bg-transparent text-[var(--text-tertiary)] cursor-pointer transition-all flex-shrink-0 hover:bg-red-500/10 hover:text-red-500"
              @click="askDeleteAsset(i)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'agents'" class="pd-pane active">
        <div v-if="projectAgents.length > 0" class="pd-config-grid">
          <div v-for="a in projectAgents" :key="a.id" class="pd-config-card">
            <div class="pd-config-icon" :style="{ background: a.color }">{{ a.icon }}</div>
            <div>
              <div class="pd-config-title">{{ a.name }}</div>
              <div class="pd-config-desc">{{ a.desc }}</div>
            </div>
          </div>
        </div>
        <div v-else class="pd-config-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6m11-11h-6m-6 0H1m15.5-7.5l-4.24 4.24m-6.52 6.52l-4.24 4.24m0-15l4.24 4.24m6.52 6.52l4.24 4.24"/></svg>
          <div class="pd-config-empty-text">暂无已配置智能体</div>
          <div class="pd-config-empty-hint">创建团队空间时可选择智能体</div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹框 -->
    <div v-if="pendingDeleteAsset !== null" class="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" @click.self="cancelDeleteAsset">
      <div class="bg-[var(--surface)] rounded-xl p-5 px-6 min-w-[280px] shadow-[0_8px_32px_rgba(0,0,0,0.2)]">
        <div class="text-base font-semibold mb-2 text-[var(--text-primary)]">确认删除</div>
        <div class="text-sm text-[var(--text-secondary)] mb-5">删除后不可恢复，确定要删除该文件吗？</div>
        <div class="flex gap-2.5 justify-end">
          <button class="px-4 py-1.5 border border-[var(--border)] rounded-md bg-transparent text-[var(--text-primary)] text-[13px] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors" @click="cancelDeleteAsset">取消</button>
          <button class="px-4 py-1.5 border-none rounded-md bg-red-500 hover:bg-red-600 text-white text-[13px] cursor-pointer transition-colors" @click="confirmDeleteAsset">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
