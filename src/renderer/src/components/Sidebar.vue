<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAppStore } from '../stores/app';
import { api } from '../api';
import type { SessionRef } from '../types';

const router = useRouter();
const route = useRoute();
const store = useAppStore();

const userOpen = ref(false);
const taskMenuOpen = ref(false);
const taskMenuTarget = ref<HTMLElement | null>(null);
const taskMenuSession = ref<SessionRef | null>(null);
const taskMenuStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' });
const devToolsEnabled = ref(false);

async function startNewTask() {
  store.startDraftSession();
  router.push('/chat');
  store.openRightPanel();
}

function switchRoute(path: string) {
  router.push(path);
}

async function selectTask(session: SessionRef) {
  await store.openSession(session);
  router.push('/chat');
  store.openRightPanel();
}

function closeTaskMenu() {
  taskMenuOpen.value = false;
  taskMenuTarget.value = null;
  taskMenuSession.value = null;
}

function openTaskMenu(e: MouseEvent, session: SessionRef) {
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const menuWidth = 152;
  const gap = 6;
  taskMenuStyle.value = {
    left: `${Math.max(12, rect.right - menuWidth)}px`,
    top: `${rect.bottom + gap}px`,
  };
  taskMenuSession.value = session;
  taskMenuTarget.value = target;
  taskMenuOpen.value = true;
}

async function handleDeleteSession() {
  if (!taskMenuSession.value) return;
  const deleting = taskMenuSession.value;
  closeTaskMenu();
  const ok = await store.deleteSession(deleting.sessionId);
  if (ok && store.currentSession == null && route.path === '/chat') {
    store.closeRightPanel();
  }
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null;
  const menuEl = document.getElementById('taskMenu');
  if (menuEl?.contains(target)) return;
  if (taskMenuTarget.value?.contains(target)) return;
  closeTaskMenu();
}

function sessionTitle(s: SessionRef): string {
  return s.name || `会话 ${s.sessionId.slice(0, 8)}`;
}

function sessionSub(s: SessionRef): string {
  return s.cwd || s.sessionId.slice(0, 8);
}

function applyTheme(t: 'light' | 'dark') {
  store.setTheme(t);
  document.body.classList.toggle('theme-dark', t === 'dark');
  store.showToastMsg(t === 'dark' ? '已切换到暗色主题' : '已切换到亮色主题');
}

function openSettings() {
  store.settingsVisible = true;
  userOpen.value = false;
}

async function openDevTools() {
  try {
    const res = await api.openDevTools();
    if (!res.ok) {
      store.showToastMsg('打开开发者工具失败：' + String(res.error || ''));
    }
  } catch (e: any) {
    store.showToastMsg('打开开发者工具失败：' + String(e?.message || e));
  }
  userOpen.value = false;
}

async function loadAppConfig() {
  try {
    const cfg = await api.getAppConfig();
    devToolsEnabled.value = !!cfg.devTools;
  } catch (e: any) {
    console.error('Failed to load app config:', e);
  }
}

const marketActive = computed(() => route.path === '/marketplace');

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  void loadAppConfig();
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
});
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-section">
      <button class="new-task-btn" @click="startNewTask">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新建任务
      </button>

      <div class="nav-item" :class="{ active: marketActive }" @click="switchRoute('/marketplace')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        智能体市场
      </div>
    </div>

    <div class="sidebar-section spacer">
      <div class="section-title"><span>会话历史</span></div>
      <div class="task-list">
        <div
          v-for="session in store.sessions"
          :key="session.sessionId"
          class="task-item"
          :class="{ active: store.currentSession?.sessionId === session.sessionId }"
          @click="selectTask(session)"
        >
          <span class="mode-dot" :class="session.sessionFile ? 'agent' : 'simple'"></span>
          <div class="task-main">
            <span class="task-title">{{ sessionTitle(session) }}</span>
            <span class="task-sub">{{ sessionSub(session) }}</span>
          </div>
          <button class="task-more" title="更多操作" @click.stop="openTaskMenu($event, session)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        </div>
      </div>

      <div class="task-menu" :class="{ open: taskMenuOpen }" :style="taskMenuStyle" id="taskMenu" @click.stop>
        <div class="task-menu-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          重命名
        </div>
        <div class="task-menu-item danger" @click="handleDeleteSession">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          删除
        </div>
        <div class="task-menu-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          打开文件夹
        </div>
      </div>
    </div>

    <div class="user-bar" @click="userOpen = !userOpen">
      <div class="user-popover" :class="{ open: userOpen }" @click.stop>
        <div class="up-head">
          <div class="up-avatar">林</div>
          <div class="up-meta">
            <div class="up-name">林晓</div>
            <div class="up-dept">技术平台部</div>
          </div>
        </div>
        <div class="up-theme">
          <div class="up-theme-label">主题</div>
          <div class="theme-switch">
            <button class="theme-opt" :class="{ active: store.theme === 'light' }" @click="applyTheme('light')" title="亮色">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
              亮
            </button>
            <button class="theme-opt" :class="{ active: store.theme === 'dark' }" @click="applyTheme('dark')" title="暗色">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
              暗
            </button>
          </div>
        </div>
        <div class="up-menu">
          <div v-if="devToolsEnabled" class="up-menu-item" @click="openDevTools">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M9 11l3 3-3 3"/><path d="M15 9l-3 3 3 3"/></svg>
            开发者工具
          </div>
          <div class="up-menu-item" @click="openSettings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            设置
          </div>
          <div class="up-divider"></div>
          <div class="up-menu-item danger" @click="store.showToastMsg('已退出登录')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            退出登录
          </div>
        </div>
      </div>
      <div class="u-avatar">林</div>
      <div class="u-info">
        <div class="u-name">林晓</div>
        <div class="u-dept">技术平台部</div>
      </div>
      <svg class="u-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
  </aside>
</template>
