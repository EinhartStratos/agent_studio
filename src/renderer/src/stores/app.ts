import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AgentInfo, Project, Task } from '../types';

export const useAppStore = defineStore('app', () => {
  const theme = ref<'light' | 'dark'>('light');
  const isRightPanelOpen = ref(false);
  const isRightPanelFullscreen = ref(false);
  const activeRtab = ref<'task' | 'files' | 'preview'>('task');
  const previewFile = ref({ name: 'src/order.service.ts', meta: '4.2 KB · TypeScript', icon: '📄' });
  const settingsVisible = ref(false);
  const newProjectVisible = ref(false);
  const activeProject = ref<Project | null>(null);
  const currentAgent = ref<AgentInfo | null>(null);
  const currentPermission = ref<string>('readonly');
  const currentProject = ref<string>('');
  const contextUsed = ref(68);
  const showToast = ref(false);
  const toastMessage = ref('');

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light';
  }
  function setTheme(t: 'light' | 'dark') {
    theme.value = t;
  }
  function openRightPanel() {
    isRightPanelOpen.value = true;
  }
  function closeRightPanel() {
    isRightPanelOpen.value = false;
    isRightPanelFullscreen.value = false;
  }
  function toggleRightPanel() {
    isRightPanelOpen.value = !isRightPanelOpen.value;
  }
  function toggleRightPanelFullscreen() {
    isRightPanelFullscreen.value = !isRightPanelFullscreen.value;
  }
  function setActiveRtab(tab: 'task' | 'files' | 'preview') {
    activeRtab.value = tab;
  }
  function setPreviewFile(file: { name: string; meta: string; icon: string }) {
    previewFile.value = file;
    activeRtab.value = 'preview';
  }
  function showToastMsg(msg: string) {
    toastMessage.value = msg;
    showToast.value = true;
    setTimeout(() => {
      showToast.value = false;
    }, 2200);
  }

  const tasks = ref<Task[]>([
    { id: 'api-design', title: '接口设计讨论', sub: '今天 10:24 · 进行中', mode: 'simple' },
    { id: 'auto-test', title: '自动化测试生成', sub: '昨天 16:40 · 已完成', mode: 'agent' },
    { id: 'db-opt', title: '数据库优化方案', sub: '2 天前 · 进行中', mode: 'simple' },
    { id: 'refactor', title: '代码重构', sub: '5 天前 · 进行中', mode: 'agent' },
    { id: 'review', title: '需求评审记录', sub: '3 天前 · 已归档', mode: 'simple' },
  ]);

  const activeTask = ref<string>('api-design');
  function setActiveTask(id: string) {
    activeTask.value = id;
  }

  return {
    theme,
    isRightPanelOpen,
    isRightPanelFullscreen,
    activeRtab,
    previewFile,
    settingsVisible,
    newProjectVisible,
    activeProject,
    currentAgent,
    currentPermission,
    currentProject,
    contextUsed,
    showToast,
    toastMessage,
    tasks,
    activeTask,
    toggleTheme,
    setTheme,
    openRightPanel,
    closeRightPanel,
    toggleRightPanel,
    toggleRightPanelFullscreen,
    setActiveRtab,
    setPreviewFile,
    showToastMsg,
    setActiveTask,
  };
});
