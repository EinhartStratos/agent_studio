<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';

const router = useRouter();
const store = useAppStore();
const activeTab = ref('feed');
const tabs = [
  { id: 'feed', label: '动态' },
  { id: 'plan', label: '计划' },
  { id: 'tasks', label: '任务' },
  { id: 'assets', label: '资产' },
  { id: 'agents', label: '智能体' },
];

const project = computed(() => store.activeProject || { name: '电商后端系统', desc: '订单、库存、支付核心服务迭代', icon: '🛒', color: '#e9f7ef' });

const feeds = [
  { avatar: '林', color: 'var(--primary-light)', color2: 'var(--primary)', text: '<b>林晓</b> 将任务 <b>接口设计讨论</b> 公开到团队空间', time: '20 分钟前' },
  { avatar: 'AI', color: '#e9f7ef', color2: 'var(--success)', text: '自动化巡检：昨日 <b>8 / 8</b> 个单元测试通过，覆盖率 <b>92%</b>', time: '1 小时前' },
  { avatar: '王', color: '#fef3c7', color2: '#f59e0b', text: '<b>王铭</b> 更新了团队空间资料库 <b>API 设计规范 v3.pdf</b>', time: '3 小时前' },
];

const plans = [
  { col: '待处理', cards: ['Q3 支付链路重构', '库存扣减幂等性优化'] },
  { col: '进行中', cards: ['订单服务单元测试补全'] },
  { col: '已完成', cards: ['用户模块接口文档生成'] },
];

const tasks = [
  { mode: 'simple', title: '接口设计讨论', owner: '林晓' },
  { mode: 'agent', title: '自动化测试生成', owner: 'AI' },
  { mode: 'simple', title: '数据库优化方案', owner: '林晓' },
];

const assets = [
  { icon: '📄', name: 'API 设计规范 v3.pdf', meta: '2.1 MB · 王铭 更新于 3 小时前' },
  { icon: '📊', name: 'Q3 销售数据.xlsx', meta: '1.2 MB · 林晓 上传于 昨天' },
  { icon: '📝', name: '订单服务测试报告.md', meta: '0.3 MB · AI 生成于 1 小时前' },
];
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
          <button class="asset-upload-btn">上传文件</button>
        </div>
        <div class="asset-list">
          <div v-for="(a, i) in assets" :key="i" class="asset-item">
            <span class="asset-icon">{{ a.icon }}</span>
            <span>{{ a.name }}</span>
            <span class="asset-meta">{{ a.meta }}</span>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'agents'" class="pd-pane active">
        <div class="pd-config-grid" style="color:var(--text-tertiary);padding:60px 20px;text-align:center;">
          暂无已配置智能体
        </div>
      </div>
    </div>
  </div>
</template>
