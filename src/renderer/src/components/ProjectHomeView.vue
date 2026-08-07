<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../stores/app';
import type { ProjectTemplate } from '../stores/project';
import type { Project } from '../types';
import { ElMessage } from 'element-plus';

const router = useRouter();
const projectStore = useProjectStore();
const search = ref('');
const templates = ref<ProjectTemplate[]>([]);
const hoveredCardId = ref<string | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function showMenu(id: string) {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  hoveredCardId.value = id;
}

function hideMenu() {
  hideTimer = setTimeout(() => {
    hoveredCardId.value = null;
    hideTimer = null;
  }, 150);
}
const pendingDeleteId = ref<string | null>(null);

const filteredProjects = computed(() =>
  projectStore.myProjects.filter(p => p.name.includes(search.value) || p.desc.includes(search.value))
);

const filteredTemplates = computed(() =>
  templates.value.filter(p => p.name.includes(search.value) || p.desc.includes(search.value))
);

async function loadTemplates() {
  templates.value = await projectStore.fetchTemplates();
}

function openProject(p: Project) {
  projectStore.setActiveProject(p);
  router.push(`/project/${p.id}`);
}

function openTemplate(t: ProjectTemplate) {
  projectStore.setActiveProject({ id: t.id, name: t.name, desc: t.desc, icon: t.icon, color: t.color, directive: t.directive } as Project);
  projectStore.newProjectVisible = true;
}

function editProject(p: Project) {
  projectStore.setActiveProject(p);
  projectStore.newProjectVisible = true;
  hoveredCardId.value = null;
}

function askDelete(p: Project) {
  pendingDeleteId.value = p.id;
  hoveredCardId.value = null;
}

async function confirmDelete() {
  if (!pendingDeleteId.value) return;
  const id = pendingDeleteId.value;
  const idx = projectStore.myProjects.findIndex((p) => p.id === id);
  if (idx === -1) {
    pendingDeleteId.value = null;
    return;
  }
  const removed = projectStore.myProjects[idx];
  // 取消防抖保存，与显式保存互斥
  projectStore.cancelScheduledSave();
  projectStore.deleteProject(id);
  const saveOk = await projectStore.saveToCache();
  if (!saveOk) {
    // 回滚
    projectStore.myProjects.splice(idx, 0, removed);
    ElMessage.error('磁盘写入失败，删除已回滚');
    return;
  }
  ElMessage.success('团队空间已删除');
  pendingDeleteId.value = null;
}

function cancelDelete() {
  pendingDeleteId.value = null;
}

onMounted(loadTemplates);
</script>

<template>
  <div class="project-home active">
    <div class="project-home-header">
      <div class="ph-header-text">
        <h1>团队空间</h1>
        <p>多人协同，打造超级团队</p>
      </div>
      <button class="ph-new-btn" @click="projectStore.setActiveProject(null); projectStore.newProjectVisible = true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        新建团队空间
      </button>
    </div>
    <div class="project-home-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input v-model="search" type="text" placeholder="搜索团队空间" />
    </div>
    <div class="project-section">
      <div class="project-section-title">我的团队空间</div>
      <div class="project-grid">
        <div
          v-for="p in filteredProjects"
          :key="p.id"
          class="project-card relative"
          @click="openProject(p)"
        >
          <div class="project-card-icon" :style="{ background: p.color }">{{ p.icon }}</div>
          <div class="project-card-body">
            <div class="project-card-title">{{ p.name }}</div>
            <div class="project-card-desc">{{ p.desc }}</div>
          </div>
          <div
            class="relative flex items-center justify-center"
            @mouseenter="showMenu(p.id)"
            @mouseleave="hideMenu"
          >
            <div class="flex items-center justify-center" @click.stop>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </div>
            <transition name="fade">
              <div v-if="hoveredCardId === p.id" class="absolute top-full right-0 mt-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.12)] p-1 min-w-[80px] z-10" @click.stop>
                <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] text-[var(--text-primary)] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors" @click="editProject(p)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  编辑
                </div>
                <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] cursor-pointer hover:bg-red-500/10 transition-colors text-[var(--error)]" @click="askDelete(p)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  删除
                </div>
              </div>
            </transition>
          </div>
        </div>
      </div>
    </div>
    <div class="project-section">
      <div class="project-section-title">从模版创建</div>
      <div class="project-grid">
        <div
          v-for="t in filteredTemplates"
          :key="t.id"
          class="project-card"
          @click="openTemplate(t)"
        >
          <div class="project-card-icon" :style="{ background: t.color }">{{ t.icon }}</div>
          <div class="project-card-body">
            <div class="project-card-title">{{ t.name }}</div>
            <div class="project-card-desc">{{ t.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹框 -->
    <div v-if="pendingDeleteId" class="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" @click.self="cancelDelete">
      <div class="bg-[var(--surface)] rounded-xl p-5 px-6 min-w-[280px] shadow-[0_8px_32px_rgba(0,0,0,0.2)]">
        <div class="text-base font-semibold mb-2 text-[var(--text-primary)]">确认删除</div>
        <div class="text-sm text-[var(--text-secondary)] mb-5">删除后不可恢复，确定要删除该团队空间吗？</div>
        <div class="flex gap-2.5 justify-end">
          <button class="px-4 py-1.5 border border-[var(--border)] rounded-md bg-transparent text-[var(--text-primary)] text-[13px] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors" @click="cancelDelete">取消</button>
          <button class="px-4 py-1.5 border-none rounded-md bg-red-500 hover:bg-red-600 text-white text-[13px] cursor-pointer transition-colors" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}
</style>
