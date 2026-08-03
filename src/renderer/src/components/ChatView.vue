<script setup lang="ts">
import { ref } from 'vue';

const hasMessages = ref(true);

const messages = [
  {
    role: 'user',
    time: '今天 10:24',
    content:
      '帮我给 <b>src/order.service.ts</b> 生成单元测试，重点覆盖创建订单、查询订单、取消订单这几个核心方法，并跑一遍测试输出报告。',
  },
  {
    role: 'ai',
    time: '今天 10:25',
    content: `已切换到 <b>TestAgent</b>，开始为你生成并运行单元测试。

<b>任务计划</b>
<ul>
<li>读取目标文件 <code>src/order.service.ts</code></li>
<li>分析公共方法与边界条件</li>
<li>生成测试用例并写入 <code>tests/order.service.spec.ts</code></li>
<li>运行测试并输出报告</li>
</ul>

已读取 <code>src/order.service.ts</code>（4.2 KB），识别到 4 个公共方法：<code>createOrder</code> / <code>getOrder</code> / <code>cancelOrder</code> / <code>listOrders</code>，正在分析边界条件：库存不足、订单不存在、重复取消、并发下单等。`,
  },
];

const steps = [
  { step: 1, title: '读取目标文件 src/order.service.ts', meta: '已读取 4.2 KB · 耗时 120ms', status: 'done' },
  { step: 2, title: '分析公共方法与边界条件', meta: '识别 4 个公共方法 · 3 个边界条件', status: 'run' },
  { step: 3, title: '生成测试用例并写入文件', meta: '待执行', status: 'wait' },
  { step: 4, title: '运行测试并输出报告', meta: '待执行', status: 'wait' },
];
</script>

<template>
  <div class="chat-area" :class="{ 'compose-empty': !hasMessages }">
    <div v-if="!hasMessages" class="empty-state">
      <h2>把研发问题告诉我</h2>
    </div>

    <div v-else class="messages active">
      <div v-for="(m, i) in messages" :key="i" class="message" :class="m.role">
        <div class="avatar" :class="m.role">{{ m.role === 'user' ? '我' : 'AI' }}</div>
        <div class="msg-col">
          <div class="msg-time">{{ m.time }}</div>
          <div class="bubble" v-html="m.content"></div>
          <div class="msg-actions">
            <button v-if="m.role === 'ai'" class="msg-act like" title="点赞">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button v-if="m.role === 'ai'" class="msg-act dislike" title="点踩">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V3H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
            </button>
            <button class="msg-act" title="复制">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="msg-act" title="删除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="task-preview active">
        <div class="task-preview-header">
          <div class="title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            任务执行预览：生成单元测试
          </div>
          <span class="status-badge running">执行中</span>
        </div>
        <div class="task-steps">
          <div v-for="s in steps" :key="s.step" class="step">
            <div class="step-icon" :class="s.status">{{ s.status === 'done' ? '✓' : s.status === 'run' ? '●' : s.step }}</div>
            <div class="step-body">
              <div class="step-title">{{ s.title }}</div>
              <div class="step-meta">{{ s.meta }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
