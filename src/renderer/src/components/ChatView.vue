<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { marked } from 'marked';
import { useAppStore } from '../stores/app';
import type { TranscriptItem } from '../types';

const store = useAppStore();
const api = (window as any).electronAPI;
const messagesRef = ref<HTMLElement | null>(null);
const bottomAnchorRef = ref<HTMLElement | null>(null);

interface ChatItem {
  id: string;
  role: 'user' | 'ai' | 'tool' | 'think' | 'error';
  time: string;
  content: string;
  isError?: boolean;
  toolTitle?: string;
  toolStatus?: string;
  toolInput?: string;
  toolContent?: string;
  toolDiff?: string;
  toolError?: string;
  toolResult?: string;
  /** 仅用户消息：若携带有智能体 system prompt，记录其名称 */
  agentName?: string;
  skillName?: string;
}

// 记录被手动折叠的工具调用 id
const foldedTools = ref<Set<string>>(new Set());
// 记录已经自动折叠过的工具 id，避免用户展开后又被自动折回去
const seenToolIds = ref<Set<string>>(new Set());

// 新出现的工具调用默认折叠
watch(
  () => store.transcript.map((t) => t.id).join(','),
  () => {
    for (const t of store.transcript) {
      if (t.type === 'tool' && !seenToolIds.value.has(t.id)) {
        foldedTools.value.add(t.id);
        seenToolIds.value.add(t.id);
      }
    }
  },
  { immediate: true }
);

function toggleTool(id: string) {
  if (foldedTools.value.has(id)) {
    foldedTools.value.delete(id);
  } else {
    foldedTools.value.add(id);
  }
}

function statusClass(status?: string): 'done' | 'run' | 'wait' {
  const s = String(status ?? '').toLowerCase();
  if (/^(done|completed|success)$/.test(s)) return 'done';
  if (/^(run|running|in_progress|pending)$/.test(s)) return 'run';
  return 'wait';
}

function formatObj(o: unknown): string {
  if (o === undefined || o === null) return '';
  if (typeof o === 'string') return o;
  try {
    return JSON.stringify(o, null, 2);
  } catch {
    return String(o);
  }
}

function formatToolText(m: ChatItem): string {
  const parts: string[] = [m.toolTitle || '工具调用'];
  if (m.toolStatus) parts.push(`[${m.toolStatus}]`);
  if (m.toolInput) parts.push(`输入参数:\n${m.toolInput}`);
  if (m.toolContent) parts.push(`执行结果:\n${m.toolContent}`);
  if (m.toolDiff) parts.push(`变更对比:\n${m.toolDiff}`);
  if (m.toolResult) parts.push(`返回值:\n${m.toolResult}`);
  if (m.toolError) parts.push(`错误:\n${m.toolError}`);
  return parts.join('\n\n');
}

const messages = computed<ChatItem[]>(() => {
  // 找到第一条用户消息，屏蔽它之前的 pi 系统/元信息
  const firstUserIdx = store.transcript.findIndex((t) => t.type === 'user');
  const startIdx = firstUserIdx >= 0 ? firstUserIdx : 0;
  const visible = store.transcript.slice(startIdx);

  return visible.map((t: TranscriptItem): ChatItem | null => {
    const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (t.type === 'user') {
      const parsed = parseUserContent(t.content ?? '');
      return { id: t.id, role: 'user', time, content: parsed.realInput, agentName: parsed.agentName, skillName: parsed.skillName };
    }
    if (t.type === 'assistant') {
      // 工具调用之间出现的空模型输出不展示
      if (!(t.content ?? '').trim()) return null;
      return { id: t.id, role: 'ai', time, content: t.content ?? '' };
    }
    if (t.type === 'thinking') {
      // 工具调用之间出现的空思考/元信息输出不展示
      if (!(t.content ?? '').trim()) return null;
      return { id: t.id, role: 'think', time, content: t.content ?? '' };
    }
    if (t.type === 'error') {
      return { id: t.id, role: 'error', time, content: t.content ?? '', isError: true };
    }
    if (t.type === 'tool') {
      const tool = t.tool;
      const toolTitle = tool?.title || tool?.name || '工具调用';
      const toolStatus = tool?.status;
      const toolInput = tool?.input && Object.keys(tool.input).length ? JSON.stringify(tool.input, null, 2) : undefined;
      const toolContent = tool?.contentText;
      const toolDiff = tool?.diffText;
      const toolError = tool?.error;
      let toolResult: string | undefined;
      if (!toolContent && !toolDiff && tool?.result !== undefined) {
        toolResult = typeof tool.result === 'string' ? tool.result : formatObj(tool.result);
      }
      return {
        id: t.id,
        role: 'tool',
        time,
        content: '',
        toolTitle,
        toolStatus,
        toolInput,
        toolContent,
        toolDiff,
        toolError,
        toolResult,
      };
    }
    // plan 等其它类型由右侧/底部任务预览统一展示，不再在聊天记录中兜底显示
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

/** 把 AI 输出的 Markdown 渲染成 HTML */
function renderMarkdown(s: string): string {
  if (!s) return '';
  const raw = String(marked.parse(s, { gfm: true, breaks: true, headerIds: false }) ?? '');
  // 基础过滤：移除 script 标签与危险事件处理器，避免任意脚本执行
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\s(on\w+|data-|aria-)\s*=\s*["'][^"']*["']/gi, ' ');
}

/** 解析用户消息中的 skill 前缀，例如 /skill:<name> 或 /skill：<name> */
function parseSkillPrefix(text: string): { name: string; args: string } | null {
  const s = text ?? '';
  if (s.startsWith('/skill:')) {
    const rest = s.slice('/skill:'.length);
    const idx = rest.search(/\s/);
    if (idx < 0) return { name: rest.trim(), args: '' };
    return { name: rest.slice(0, idx).trim(), args: rest.slice(idx + 1).trim() };
  }
  if (s.startsWith('/skill：')) {
    const rest = s.slice('/skill：'.length);
    const idx = rest.search(/\s/);
    if (idx < 0) return { name: rest.trim(), args: '' };
    return { name: rest.slice(0, idx).trim(), args: rest.slice(idx + 1).trim() };
  }
  return null;
}

/** 剥离用户消息里的 <<<SYSTEM>>> 智能体提示块，提取真实输入、智能体名与技能名 */
function parseUserContent(content: string): { realInput: string; agentName?: string; skillName?: string } {
  const s = content ?? '';
  let body = s;
  let agentName: string | undefined;

  if (s.startsWith('<<<SYSTEM>>>')) {
    const endIdx = s.indexOf('<<</SYSTEM>>>');
    if (endIdx >= 0) {
      const block = s.slice('<<<SYSTEM>>>'.length, endIdx).trim();
      const match = block.match(/^你当前选择的智能体是「([^」]+)」/m);
      agentName = match ? match[1] : undefined;
      body = s.slice(endIdx + '<<</SYSTEM>>>'.length).trim();
    }
  }

  const skill = parseSkillPrefix(body);
  if (skill) {
    return { realInput: skill.args, skillName: skill.name, agentName };
  }

  return { realInput: body, agentName };
}

/** 按消息角色选择渲染方式 */
function renderContent(m: ChatItem): string {
  if (m.role === 'ai' || m.role === 'think') return renderMarkdown(m.content);
  return escapeHtml(m.content);
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
          {{ m.role === 'user' ? '我' : m.role === 'ai' ? 'AI' : m.role === 'think' ? '思' : m.role === 'error' ? '!' : '🔧' }}
        </div>
        <div class="msg-col">
          <div class="msg-time">{{ m.time }}</div>

          <div v-if="m.role === 'tool'" class="bubble tool-card" :class="{ folded: foldedTools.has(m.id) }">
            <div class="tool-header" @click="toggleTool(m.id)">
              <div class="tool-info">
                <span class="tool-name">{{ m.toolTitle }}</span>
                <span v-if="m.toolStatus" class="tool-status-badge" :class="statusClass(m.toolStatus)">{{ m.toolStatus }}</span>
              </div>
              <span class="tool-toggle">{{ foldedTools.has(m.id) ? '▶' : '▼' }}</span>
            </div>
            <div v-if="!foldedTools.has(m.id)" class="tool-body">
              <div v-if="m.toolInput" class="tool-section">
                <div class="tool-section-title">输入参数</div>
                <pre class="tool-pre">{{ m.toolInput }}</pre>
              </div>
              <div v-if="m.toolContent" class="tool-section">
                <div class="tool-section-title">执行结果</div>
                <pre class="tool-pre">{{ m.toolContent }}</pre>
              </div>
              <div v-if="m.toolDiff" class="tool-section">
                <div class="tool-section-title">变更对比</div>
                <pre class="tool-pre">{{ m.toolDiff }}</pre>
              </div>
              <div v-if="m.toolResult" class="tool-section">
                <div class="tool-section-title">返回值</div>
                <pre class="tool-pre">{{ m.toolResult }}</pre>
              </div>
              <div v-if="m.toolError" class="tool-section">
                <div class="tool-section-title">错误</div>
                <pre class="tool-pre tool-error-text">{{ m.toolError }}</pre>
              </div>
            </div>
          </div>

          <div v-else class="bubble" :class="{ error: m.role === 'error' }">
            <div v-if="m.agentName" class="msg-agent-note">调用 {{ m.agentName }} 智能体</div>
            <div v-if="m.skillName" class="msg-skill-note">调用 {{ m.skillName }} 技能</div>
            <div v-html="renderContent(m)"></div>
          </div>

          <div class="msg-actions">
            <button v-if="m.role === 'ai'" class="msg-act like" title="点赞">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button v-if="m.role === 'ai'" class="msg-act dislike" title="点踩">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V3H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
            </button>
            <button class="msg-act" title="复制" @click="api?.nativeClipboardCopy?.(m.role === 'tool' ? formatToolText(m) : m.content)">
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
