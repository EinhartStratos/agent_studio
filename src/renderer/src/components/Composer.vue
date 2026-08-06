<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import type { MarketplaceAgent } from '../../../shared/types';
import type { AgentInfo } from '../types';
import { api } from '../api';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const messageInput = ref('');
const skillCommand = ref<string | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const showAgent = ref(false);
const showSkill = ref(false);
const showProj = ref(false);
const showCtx = ref(false);
const showProjectCreate = ref(false);
const projectDesc = ref('');
const projectFolderPath = ref('');
const projectSaving = ref(false);
const marketplaceAgents = ref<MarketplaceAgent[]>([]);
const agentLoading = ref(false);
const showSlashSkill = ref(false);
const slashSkillIndex = ref(0);
const slashSkillQuery = ref('');
const slashMatchStart = ref(0);
const slashMatchEnd = ref(0);
const slashSkillsLoading = ref(false);
const slashSkillJustSelected = ref(false);

const messagePlaceholder = computed(() =>
  skillCommand.value
    ? '输入参数或补充需求...'
    : '例如：帮我设计订单导出接口，包含入参、出参与错误码；或 /skill:技能名 来调用技能'
);

const skillNameFromCommand = computed(() => {
  const cmd = skillCommand.value;
  if (!cmd) return '';
  let body = cmd;
  if (body.startsWith('/skill:')) body = body.slice('/skill:'.length);
  else if (body.startsWith('/skill：')) body = body.slice('/skill：'.length);
  else if (body.startsWith('/')) body = body.slice(1);
  return body.trimStart().split(' ')[0] || cmd;
});

const simpleAgent: AgentInfo = {
  id: 'simple',
  name: '简单对话',
  desc: '快速问答与代码生成',
  icon: '💬',
  color: 'var(--primary-light)',
};

function getAgentColor(cat: string): string {
  const colorMap: Record<string, string> = {
    dev: 'var(--primary-light)',
    ui: 'color-mix(in srgb, var(--success) 12%, var(--surface))',
    content: 'color-mix(in srgb, var(--warning) 16%, var(--surface))',
    efficiency: 'color-mix(in srgb, var(--primary) 10%, var(--surface))',
    data: 'color-mix(in srgb, var(--primary) 14%, var(--surface))',
  };
  return colorMap[cat] || 'var(--bg)';
}

const agents = computed<AgentInfo[]>(() => [
  simpleAgent,
  ...marketplaceAgents.value.map((agent) => ({
    id: agent.id,
    name: agent.name,
    desc: agent.desc,
    icon: agent.emoji || '🤖',
    color: getAgentColor(agent.cat),
  })),
]);

const projects = computed(() => store.workspaceHistory.map((p) => ({ name: p.name, path: p.path })));

function openCreateProjectForm(): void {
  showProjectCreate.value = true;
  projectDesc.value = '';
  projectFolderPath.value = '';
}

const ringCircumference = 2 * Math.PI * 10;

/** 兼容 store 属性可能是 Ref 也可能是自动解包后的值 */
function storeNum(v: unknown): number {
  const raw = v && typeof v === 'object' && 'value' in v ? (v as any).value : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

const pct = computed(() => storeNum(store.pct));
const ctxMax = computed(() => {
  const v = storeNum(store.contextWindowSize);
  return v > 0 ? v : 18000;
});
const ringDash = computed(() => (pct.value / 100) * ringCircumference);

function selectAgent(id: string, name: string) {
  const selected = agents.value.find((agent) => agent.id === id);
  store.setAgent(selected ? { ...selected } : { id, name, desc: '', icon: '🤖', color: 'var(--bg)' });
  showAgent.value = false;
  if (id === 'simple') store.showToastMsg('已切换到简单对话');
  else store.showToastMsg('已切换到 ' + name);
}

async function loadMarketplaceAgents(): Promise<void> {
  agentLoading.value = true;
  try {
    const res = await api.marketplaceListAgents();
    if (res.ok && res.agents) {
      marketplaceAgents.value = res.agents;
    } else {
      marketplaceAgents.value = [];
      store.showToastMsg(res.error || '加载智能体列表失败');
    }
  } catch (e: any) {
    marketplaceAgents.value = [];
    store.showToastMsg('加载智能体列表失败：' + String(e?.message || e));
  } finally {
    agentLoading.value = false;
  }
}

async function selectProject(path: string) {
  await store.selectProject(path);
  showProj.value = false;
  showProjectCreate.value = false;
}

function parseSkillCommand(text: string): { name: string; args: string } | null {
  const m = text.trim().match(/^\/skill[:：]\s*(\S+)(?:\s+(.*))?$/s);
  if (!m) return null;
  return { name: m[1], args: m[2] || '' };
}

async function send() {
  const text = ((skillCommand.value || '') + messageInput.value).trim();
  if (!text) return;

  if (store.isGenerating) {
    store.showToastMsg('模型正在生成中，请先点击停止');
    return;
  }

  if (!store.workspacePath) {
    store.showToastMsg('请先选择或创建一个项目');
    return;
  }

  const skill = parseSkillCommand(text);
  messageInput.value = '';
  skillCommand.value = null;
  showCtx.value = false;

  if (skill) {
    await store.invokeSkill(skill.name, skill.args.trim());
  } else {
    await store.sendMessage(text);
  }
}

async function stop() {
  if (!store.currentSession) return;
  await store.cancelRun();
}

function closeAll() {
  showAgent.value = false;
  showSkill.value = false;
  showProj.value = false;
  showCtx.value = false;
  showSlashSkill.value = false;
}

function toggleSkill() {
  if (!showSkill.value && !store.skills.length && store.currentSession) {
    store.loadSkills();
  }
  showSkill.value = !showSkill.value;
}

function selectSkill(name: string) {
  slashSkillJustSelected.value = true;
  skillCommand.value = `/skill:${name} `;
  messageInput.value = '';
  showSkill.value = false;
  nextTick(() => textareaRef.value?.focus());
}

const skillList = computed(() => store.skills);

const slashSkillSuggestions = computed(() => {
  const q = slashSkillQuery.value.toLowerCase();
  const list = skillList.value;
  if (!q) return list;
  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
  );
});

function removeSkillCommand() {
  skillCommand.value = null;
  nextTick(() => textareaRef.value?.focus());
}

async function ensureSlashSkills() {
  if (!store.currentSession || store.skills.length || slashSkillsLoading.value) return;
  slashSkillsLoading.value = true;
  try {
    await store.loadSkills();
  } finally {
    slashSkillsLoading.value = false;
  }
}

function getSkillPrefix(line: string): string {
  if (line.startsWith('/skill：')) return '/skill：';
  if (line.startsWith('/skill:')) return '/skill:';
  if (line.startsWith('/')) return '/';
  return '';
}

function handleSlashInput() {
  if (slashSkillJustSelected.value) {
    slashSkillJustSelected.value = false;
    return;
  }
  const el = textareaRef.value;
  if (!el) return;
  const text = messageInput.value;
  const start = el.selectionStart ?? 0;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (lineStart !== 0) {
    showSlashSkill.value = false;
    return;
  }
  const linePrefix = text.slice(0, start);
  const prefix = getSkillPrefix(linePrefix);
  if (prefix) {
    slashSkillQuery.value = linePrefix.slice(prefix.length).toLowerCase().trim();
    slashMatchStart.value = 0;
    slashMatchEnd.value = start;
    const wasOpen = showSlashSkill.value;
    showSlashSkill.value = true;
    if (!wasOpen) {
      slashSkillIndex.value = 0;
      ensureSlashSkills();
    }
  } else {
    showSlashSkill.value = false;
  }
}

function moveSlashSkillIndex(delta: number) {
  const len = slashSkillSuggestions.value.length;
  if (!len) return;
  slashSkillIndex.value = (slashSkillIndex.value + delta + len) % len;
}

function applySlashSkill() {
  const skill = slashSkillSuggestions.value[slashSkillIndex.value];
  if (!skill) return;
  slashSkillJustSelected.value = true;
  messageInput.value = messageInput.value.slice(slashMatchEnd.value).trimStart();
  skillCommand.value = `/skill:${skill.name} `;
  showSlashSkill.value = false;
  slashSkillIndex.value = 0;
  nextTick(() => textareaRef.value?.focus());
}

watch(slashSkillQuery, () => {
  slashSkillIndex.value = 0;
});

watch(messageInput, handleSlashInput, { flush: 'post' });

async function chooseLocalFolder(): Promise<void> {
  try {
    const res = await api.nativeSelectDirectory();
    if (res.ok && !res.canceled && res.path) {
      projectFolderPath.value = res.path;
    }
  } catch (e: any) {
    store.showToastMsg('选择本地文件夹失败：' + String(e?.message || e));
  }
}

async function confirmCreateProject(): Promise<void> {
  if (!projectDesc.value.trim()) {
    store.showToastMsg('请输入工作区描述');
    return;
  }
  if (!projectFolderPath.value.trim()) {
    store.showToastMsg('请选择本地文件夹');
    return;
  }
  projectSaving.value = true;
  try {
    await store.createWorkspaceHistory(projectDesc.value, projectFolderPath.value);
    showProj.value = false;
    showProjectCreate.value = false;
    projectDesc.value = '';
    projectFolderPath.value = '';
  } catch (e: any) {
    store.showToastMsg(String(e?.message || e));
  } finally {
    projectSaving.value = false;
  }
}

function toggleProjectPicker(): void {
  const next = !showProj.value;
  closeAll();
  if (!next) return;
  showProj.value = true;
  showProjectCreate.value = false;
}

async function toggleAgentPicker() {
  const next = !showAgent.value;
  closeAll();
  if (!next) return;
  showAgent.value = true;
  await loadMarketplaceAgents();
}

function onInputKeydown(event: KeyboardEvent) {
  if (showSlashSkill.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveSlashSkillIndex(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveSlashSkillIndex(-1);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      applySlashSkill();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      showSlashSkill.value = false;
      return;
    }
  }
  if (event.key === 'Backspace' && messageInput.value === '' && skillCommand.value) {
    event.preventDefault();
    event.stopPropagation();
    removeSkillCommand();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeAll();
  }
}

const agentName = computed(() => (store.currentAgent ? store.currentAgent.name : '选择智能体'));
const projName = computed(() => store.currentProject || '选择文件夹');

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
  <div class="input-area">
    <div class="proj-popover" :class="{ active: showProj }">
      <div class="agent-popover-header">选择文件夹（归属文件夹）</div>
      <div class="agent-list proj-history-list" :class="{ scrollable: projects.length > 10 }">
        <div v-for="p in projects" :key="p.path" class="agent-item" @click="selectProject(p.path)">
          <div class="agent-icon" style="color:var(--primary);background:var(--primary-light);">📁</div>
          <div class="agent-info">
            <div class="agent-name">{{ p.name }}</div>
            <div class="agent-desc">{{ p.path }}</div>
          </div>
        </div>
        <div v-if="!projects.length" class="agent-list-state">暂无历史工作区</div>
      </div>
      <div class="proj-new" @click="openCreateProjectForm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        新建文件夹（关联本地目录）
      </div>
      <div v-if="showProjectCreate" class="proj-create">
        <input
          v-model="projectDesc"
          type="text"
          class="proj-create-input"
          placeholder="请输入工作区中文描述"
          maxlength="50"
        />
        <button class="proj-folder-btn" @click="chooseLocalFolder" :disabled="projectSaving">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          选择本地文件夹
        </button>
        <div v-if="projectFolderPath" class="proj-folder-path">{{ projectFolderPath }}</div>
        <button class="proj-confirm-btn" @click="confirmCreateProject" :disabled="projectSaving">
          {{ projectSaving ? '创建中...' : '创建并选择' }}
        </button>
      </div>
    </div>

    <div class="agent-popover" :class="{ active: showSkill }">
      <div class="agent-popover-header">选择技能</div>
      <div class="agent-list">
        <div
          v-for="s in skillList"
          :key="s.name"
          class="agent-item"
          @click="selectSkill(s.name)"
        >
          <div class="agent-icon" style="color:var(--warning);background:color-mix(in srgb, var(--warning) 12%, var(--surface));">⚡</div>
          <div class="agent-info">
            <div class="agent-name">{{ s.name }}</div>
            <div class="agent-desc">{{ s.description || '无描述' }}</div>
          </div>
        </div>
        <div v-if="!store.currentSession" class="agent-list-state">请先发送消息以加载技能列表</div>
        <div v-else-if="!skillList.length" class="agent-list-state">当前工作区没有可用技能</div>
      </div>
    </div>

    <div class="agent-popover" :class="{ active: showAgent }">
      <div class="agent-popover-header">选择智能体（按 Esc 关闭）</div>
      <div class="agent-list">
        <div
          v-for="a in agents"
          :key="a.id"
          class="agent-item"
          :class="{ selected: store.currentAgent?.id === a.id }"
          @click="selectAgent(a.id, a.name)"
        >
          <div class="agent-icon" :style="{ color: a.id === 'simple' ? 'var(--primary)' : 'currentColor', background: a.color }">{{ a.icon }}</div>
          <div class="agent-info">
            <div class="agent-name">{{ a.name }}</div>
            <div class="agent-desc">{{ a.desc }}</div>
          </div>
        </div>
        <div v-if="agentLoading" class="agent-list-state">正在加载智能体...</div>
        <div v-else-if="marketplaceAgents.length === 0" class="agent-list-state">暂无已上传智能体</div>
      </div>
    </div>

    <div class="input-box">
      <div v-if="showSlashSkill" class="slash-skill-popover">
        <div class="agent-popover-header">选择技能</div>
        <div class="agent-list">
          <div
            v-for="(s, i) in slashSkillSuggestions"
            :key="s.name"
            class="agent-item"
            :class="{ selected: i === slashSkillIndex }"
            @mouseenter="slashSkillIndex = i"
            @click="slashSkillIndex = i; applySlashSkill()"
          >
            <div class="agent-icon" style="color:var(--warning);background:color-mix(in srgb, var(--warning) 12%, var(--surface));">⚡</div>
            <div class="agent-info">
              <div class="agent-name">{{ s.name }}</div>
              <div class="agent-desc">{{ s.description || '无描述' }}</div>
            </div>
          </div>
          <div v-if="!slashSkillSuggestions.length" class="agent-list-state">
            {{ !store.currentSession ? '请先发送消息以加载技能列表' : slashSkillsLoading ? '正在加载技能...' : '没有匹配的技能' }}
          </div>
        </div>
      </div>

      <div class="input-main">
        <div v-if="skillCommand" class="skill-chip" @click="removeSkillCommand">
          <span>{{ skillNameFromCommand }}</span>
          <span class="chip-close">×</span>
        </div>
        <textarea
          ref="textareaRef"
          v-model="messageInput"
          rows="1"
          :placeholder="messagePlaceholder"
          @keydown="onInputKeydown"
        ></textarea>
      </div>
      <div class="input-toolbar">
        <div class="input-left">
          <div class="mode-trigger folder-trigger" :class="{ unset: !store.currentProject }" @click="toggleProjectPicker">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
            <span>{{ projName }}</span>
          </div>
          <div class="mode-trigger" :class="{ agent: !!store.currentAgent && store.currentAgent.id !== 'simple', unset: !store.currentAgent }" @click="toggleAgentPicker">
            <span class="dot" :style="{ background: store.currentAgent && store.currentAgent.id !== 'simple' ? 'var(--success)' : 'var(--primary)' }"></span>
            <span>{{ agentName }}</span>
          </div>
          <!-- <div class="mode-trigger skill-trigger" :class="{ active: showSkill, unset: !store.skills.length }" @click="toggleSkill">
            <span class="dot" :style="{ background: store.skills.length ? 'var(--warning)' : 'var(--text-tertiary)' }"></span>
            <span>技能</span>
          </div> -->
        </div>
        <div class="input-right">
          <div class="ctx-ring-wrap" @mouseenter="showCtx = true" @mouseleave="showCtx = false">
            <button class="ctx-ring-btn" title="上下文压缩">
              <svg class="ctx-ring" viewBox="0 0 24 24">
                <circle class="ctx-ring-track" cx="12" cy="12" r="10" />
                <circle
                  class="ctx-ring-fill"
                  :class="{ warn: pct >= 60 && pct < 85, danger: pct >= 85 }"
                  cx="12" cy="12" r="10"
                  :style="{ strokeDasharray: `${ringDash} ${ringCircumference}` }"
                />
              </svg>
              <span class="ctx-ring-text">{{ pct }}%</span>
            </button>
            <div class="ctx-popover" :class="{ active: showCtx }">
              <div class="ctx-popover-header"><span>上下文使用率</span></div>
              <div class="ctx-popover-rate">{{ pct }}%<span> of {{ (ctxMax / 1000).toFixed(0) }}k</span></div>
              <button class="ctx-popover-btn">压缩</button>
            </div>
          </div>
          <button v-if="store.isGenerating" class="send-btn stop-btn" title="停止生成" @click="stop">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
          <button v-else class="send-btn" title="发送" @click="send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="input-hint">选填 · 文件夹 / 智能体 / 技能，输入需求后可再指定</div>
  </div>
</template>

<style scoped>
.agent-list-state {
  padding: 16px 20px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.proj-history-list.scrollable {
  max-height: 520px;
  overflow-y: auto;
}

.proj-create {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.proj-create-input {
  width: 100%;
  height: 44px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text-primary);
  padding: 0 14px;
  font-size: 14px;
  outline: none;
}

.proj-create-input:focus {
  border-color: var(--primary);
}

.proj-folder-btn {
  height: 44px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  font-size: 14px;
  cursor: pointer;
}

.proj-folder-btn:hover {
  background: var(--surface-hover);
}

.proj-folder-path {
  min-height: 40px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--success) 12%, var(--surface));
  color: var(--success);
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}

.proj-confirm-btn {
  height: 44px;
  border: none;
  border-radius: 12px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.proj-confirm-btn:hover {
  background: var(--primary-hover);
}

.proj-confirm-btn:disabled,
.proj-folder-btn:disabled {
  opacity: .6;
  cursor: not-allowed;
}
</style>
