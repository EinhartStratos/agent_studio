<script setup lang="ts">
import { ref, computed } from 'vue';

const search = ref('');
const activeTab = ref('agents');
const activeCat = ref('all');

const cats = [
  { id: 'all', label: '全部' },
  { id: 'dev', label: '开发工具' },
  { id: 'ui', label: '界面设计' },
  { id: 'content', label: '内容创作' },
  { id: 'efficiency', label: '效率提升' },
  { id: 'data', label: '数据分析' },
];

const agents = [
  { id: 'TestAgent', name: 'TestAgent', emoji: '🧪', cat: 'dev', desc: '生成并执行自动化测试，覆盖单元测试、集成测试与回归测试。', tags: ['测试', 'Jest'], downloads: '2.3k' },
  { id: 'RefactorAgent', name: 'RefactorAgent', emoji: '🔧', cat: 'dev', desc: '分析代码坏味道，自动重构并给出性能优化建议。', tags: ['重构', '优化'], downloads: '1.8k' },
  { id: 'DataAgent', name: 'DataAgent', emoji: '📊', cat: 'data', desc: '从数据库或 Excel 中抽取数据，生成可视化报表。', tags: ['数据', '报表'], downloads: '980' },
  { id: 'DocAgent', name: 'DocAgent', emoji: '📝', cat: 'content', desc: '根据代码与注释自动生成技术文档和 README。', tags: ['文档', 'Markdown'], downloads: '3.1k' },
  { id: 'DeployAgent', name: 'DeployAgent', emoji: '🚀', cat: 'dev', desc: '编写 CI/CD 流水线脚本，自动化构建与部署。', tags: ['DevOps', 'CI/CD'], downloads: '1.2k' },
  { id: 'UIAgent', name: 'UIAgent', emoji: '🎨', cat: 'ui', desc: '基于组件库生成页面代码与样式草案。', tags: ['UI', 'Tailwind'], downloads: '2.0k' },
];

const filtered = computed(() => {
  let list = agents;
  if (activeCat.value !== 'all') list = list.filter(a => a.cat === activeCat.value);
  if (search.value.trim()) list = list.filter(a => a.name.toLowerCase().includes(search.value.toLowerCase()));
  return list;
});
</script>

<template>
  <div class="marketplace active">
    <div class="marketplace-header">
      <div class="mp-header-top">
        <div class="mp-title-wrap">
          <h1>智能体市场</h1>
          <p>发现并安装智能体，扩展 AI 研发能力。</p>
        </div>
        <button class="mp-manage-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          管理
        </button>
      </div>
      <div class="mp-toolbar">
        <div class="mp-tabs">
          <div class="mp-tab" :class="{ active: activeTab === 'agents' }" @click="activeTab = 'agents'">智能体</div>
          <div class="mp-tab" :class="{ active: activeTab === 'skills' }" @click="activeTab = 'skills'">技能</div>
        </div>
        <div class="mp-right">
          <div class="mp-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input v-model="search" type="text" placeholder="搜索智能体" />
          </div>
          <button class="mp-upload-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            上传智能体
          </button>
        </div>
      </div>
    </div>
    <div class="marketplace-body">
      <div class="mp-categories">
        <div
          v-for="c in cats"
          :key="c.id"
          class="mp-chip"
          :class="{ active: activeCat === c.id }"
          @click="activeCat = c.id"
        >
          {{ c.label }}
        </div>
      </div>
      <h3 class="mp-section-title">{{ cats.find(c => c.id === activeCat)?.label }}</h3>
      <div class="mp-grid">
        <div v-for="a in filtered" :key="a.id" class="mp-card">
          <div class="mp-card-icon" :style="{ background: a.color, color: 'var(--text-primary)' }">{{ a.emoji }}</div>
          <div class="mp-card-body">
            <div class="mp-card-title">{{ a.name }}</div>
            <div class="mp-card-desc">{{ a.desc }}</div>
          </div>
          <button class="mp-card-add" :data-id="a.id" title="安装">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      <div v-if="!filtered.length" class="mp-empty">未找到匹配的智能体</div>
    </div>
  </div>
</template>
