<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAppStore, useProjectStore } from './stores/app';
import TitleBar from './components/TitleBar.vue';
import Sidebar from './components/Sidebar.vue';
import RightPanel from './components/RightPanel.vue';
import Composer from './components/Composer.vue';
import SettingsModal from './components/SettingsModal.vue';
import NewProjectModal from './components/NewProjectModal.vue';

const route = useRoute();
const store = useAppStore();
const projectStore = useProjectStore();

const isChat = computed(() => route.path === '/chat');
const isMaximized = false;
const isMinimized = false;
const isClosed = false;

onMounted(async () => {
  store.initApp();
  await projectStore.loadFromCache();
});

watch(
  () => JSON.stringify(projectStore.myProjects),
  () => {
    projectStore.scheduleSave(300);
  },
  { flush: 'post' }
);
</script>

<template>
  <div class="window" :class="{ maximized: isMaximized, minimized: isMinimized, closed: isClosed }">
    <TitleBar />
    <div class="app-body">
      <Sidebar />
      <main class="main">
        <router-view />
        <Composer v-if="isChat" />
      </main>
      <RightPanel v-if="isChat" />
    </div>

    <button
      v-if="!store.isRightPanelOpen && isChat"
      class="panel-toggle-btn"
      title="展开右侧面板"
      aria-label="展开右侧面板"
      @click="store.openRightPanel()"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="9" y1="4" x2="9" y2="20" />
      </svg>
    </button>

    <SettingsModal v-if="store.settingsVisible" />
    <NewProjectModal v-if="projectStore.newProjectVisible" />

    <div class="toast" :class="{ show: store.showToast }">
      {{ store.toastMessage }}
    </div>
  </div>
</template>
