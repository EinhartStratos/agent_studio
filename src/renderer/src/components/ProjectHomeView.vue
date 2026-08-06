<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';

const router = useRouter();
const store = useAppStore();
const search = ref('');

const myProjects = [
  { id: 'ecom', name: '电商后端系统', desc: '订单、库存、支付核心服务迭代', icon: '🛒', color: '#e9f7ef' },
  { id: 'internal', name: '内部管理系统', desc: '人事、财务、审批流程数字化', icon: '🏢', color: '#ede9fe' },
  { id: 'data', name: '数据中台', desc: '统一数据服务与报表平台', icon: '📊', color: '#e0f2fe' },
];

const templates = [
  { id: 't1', name: '电商后端模板', desc: '包含订单、库存、支付初始化智能体', icon: '🛍️', color: '#fff7e6' },
  { id: 't2', name: 'B 端后台模板', desc: 'RBAC、审批流、数据表格常用配置', icon: '🖥️', color: '#f3f4f6' },
  { id: 't3', name: '测试工程模板', desc: '自动化测试、覆盖率、CI 配置预设', icon: '🧪', color: '#e9f7ef' },
];

const filteredProjects = computed(() =>
  myProjects.filter(p => p.name.includes(search.value) || p.desc.includes(search.value))
);

const filteredTemplates = computed(() =>
  templates.filter(p => p.name.includes(search.value) || p.desc.includes(search.value))
);

function openProject(p: typeof myProjects[0]) {
  store.activeProject = { id: p.id, name: p.name, desc: p.desc, icon: p.icon, color: p.color };
  router.push(`/project/${p.id}`);
}

function openTemplate(t: typeof templates[0]) {
  store.activeProject = { id: t.id, name: t.name, desc: t.desc, icon: t.icon, color: t.color };
  store.newProjectVisible = true;
}
</script>

<template>
  <div class="project-home active">
    <div class="project-home-header">
      <div class="ph-header-text">
        <h1>团队空间</h1>
        <p>多人协同，打造超级团队</p>
      </div>
      <button class="ph-new-btn" @click="store.newProjectVisible = true">
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
          class="project-card"
          @click="openProject(p)"
        >
          <div class="project-card-icon" :style="{ background: p.color }">{{ p.icon }}</div>
          <div class="project-card-body">
            <div class="project-card-title">{{ p.name }}</div>
            <div class="project-card-desc">{{ p.desc }}</div>
          </div>
          <div class="project-card-more" @click.stop>⋮</div>
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
  </div>
</template>
