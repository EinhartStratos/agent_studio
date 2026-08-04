<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useAppStore } from '../stores/app';
import type { TranscriptItem } from '../types';

const store = useAppStore();
const api = (window as any).electronAPI;
const messagesRef = ref<HTMLElement | null>(null);
const bottomAnchorRef = ref<HTMLElement | null>(null);

interface ChatItem {
  id: string;
  role: 'user' | 'ai' | 'tool' | 'think';
  time: string;
  content: string;
  toolTitle?: string;
  toolStatus?: string;
}

function statusClass(status?: string): 'done' | 'run' | 'wait' {
  const s = String(status ?? '').toLowerCase();
  if (/^(done|completed|success)$/.test(s)) return 'done';
  if (/^(run|running|in_progress|pending)$/.test(s)) return 'run';
  return 'wait';
}

const messages = computed<ChatItem[]>(() => {
  return store.transcript.map((t: TranscriptItem): ChatItem | null => {
    const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (t.type === 'user') {
      return { id: t.id, role: 'user', time, content: t.content ?? '' };
    }
    if (t.type === 'assistant') {
      return { id: t.id, role: 'ai', time, content: t.content ?? '' };
    }
    if (t.type === 'thinking') {
      return { id: t.id, role: 'think', time, content: t.content ?? '' };
    }
    if (t.type === 'tool') {
      const tool = t.tool;
      let body = '';
      if (tool?.title || tool?.name) body += `<b>${tool.title || tool.name}</b>`;
      if (tool?.status) body += ` <span class="tool-status">[${tool.status}]</span>`;
      if (tool?.contentText) body += `<pre class="tool-content">${escapeHtml(tool.contentText)}</pre>`;
      if (tool?.error) body += `<pre class="tool-error">${escapeHtml(tool.error)}</pre>`;
      if (tool?.input && Object.keys(tool.input).length) {
        body += `<pre class="tool-input">${escapeHtml(JSON.stringify(tool.input, null, 2))}</pre>`;
      }
      return {
        id: t.id,
        role: 'tool',
        time,
        content: body || '工具调用',
        toolTitle: tool?.title || tool?.name,
        toolStatus: tool?.status,
      };
    }
    if (t.type === 'plan') {
      return null; // plan 用右侧/底部步骤单独展示
    }
    if (t.content) {
      return { id: t.id, role: 'ai', time, content: t.content };
    }
    return null;
  }).filter(Boolean) as ChatItem[];
});

const steps = computed(() =>
  store.todos.map((todo, idx) => ({
    step: idx + 1,
    title: todo.title,
    meta: todo.meta,
    status: statusClass(todo.meta),
  }))
);

async function scrollMessagesToBottom(): Promise<void> {
  await nextTick();
  if (bottomAnchorRef.value) {
    bottomAnchorRef.value.scrollIntoView({ block: 'end' });
    return;
  }
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}

watch(
  () => [
    store.hasMessages,
    store.isGenerating,
    messages.value.map((m) => `${m.id}:${m.content}`).join('|'),
    steps.value.map((s) => `${s.step}:${s.status}:${s.title}:${s.meta}`).join('|'),
  ],
  () => {
    void scrollMessagesToBottom();
  },
  { flush: 'post' }
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
</script>

<template>
  <div class="chat-area" :class="{ 'compose-empty': !store.hasMessages }">
    <div v-if="!store.hasMessages" class="empty-state">
      <h2>把研发问题告诉我</h2>
    </div>

    <div v-else ref="messagesRef" class="messages active">
      <div v-for="m in messages" :key="m.id" class="message" :class="m.role">
        <div class="avatar" :class="m.role">
          {{ m.role === 'user' ? '我' : m.role === 'ai' ? 'AI' : m.role === 'think' ? '思' : '🔧' }}
        </div>
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
            <button class="msg-act" title="复制" @click="api?.nativeClipboardCopy?.(m.content)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div v-if="steps.length" class="task-preview active">
        <div class="task-preview-header">
          <div class="title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            任务执行预览
          </div>
          <span class="status-badge running" v-if="store.isGenerating">执行中</span>
          <span class="status-badge done" v-else>已完成</span>
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

      <div v-if="store.isGenerating && !steps.length" class="loading-hint">AI 正在思考…</div>
      <div ref="bottomAnchorRef" aria-hidden="true"></div>
    </div>
  </div>
</template>
