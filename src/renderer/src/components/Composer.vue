<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const input = ref('');
const showAgent = ref(false);
const showProj = ref(false);
const showPerm = ref(false);
const showCtx = ref(false);
const CTX_MAX = 18000;

const agents = [
  { id: 'simple', name: '简单对话', desc: '快速问答与代码生成', icon: '💬', color: 'var(--primary-light)' },
  { id: 'TestAgent', name: 'TestAgent', desc: '生成并执行自动化测试', icon: '🧪', color: '#e9f7ef' },
  { id: 'RefactorAgent', name: 'RefactorAgent', desc: '代码重构与优化建议', icon: '🔧', color: '#ede9fe' },
  { id: 'DataAgent', name: 'DataAgent', desc: '生成 Excel 报表与数据分析', icon: '📊', color: '#e0f2fe' },
  { id: 'DeployAgent', name: 'DeployAgent', desc: '部署流水线自动化', icon: '🚀', color: '#fff7e6' },
];

const projects = computed(() => store.projects.map((p) => ({ name: p.name, path: p.path })));

const perms = [
  { id: 'readonly', name: '只读', desc: '可查看文件，不能修改', icon: '👁️' },
  { id: 'readwrite', name: '读写', desc: '可编辑并提交代码', icon: '✏️' },
  { id: 'admin', name: '管理员', desc: '可管理成员与权限', icon: '🔐' },
];

const ctxUsedTokens = computed(() => store.contextUsedTokens);
const ringCircumference = 2 * Math.PI * 10;
const pct = computed(() => Math.min(100, Math.round(ctxUsedTokens.value / CTX_MAX * 100)));
const ringDash = computed(() => (pct.value / 100) * ringCircumference);

function selectAgent(id: string, name: string) {
  store.setAgent({ id, name, desc: '', icon: '', color: '' });
  showAgent.value = false;
  if (id === 'simple') store.showToastMsg('已切换到简单对话');
  else store.showToastMsg('已切换到 ' + name);
}

function selectProject(name: string) {
  store.selectProject(name);
  showProj.value = false;
}

function selectPerm(id: string, name: string) {
  store.setPermission(id);
  showPerm.value = false;
  store.showToastMsg('已设置权限：' + name);
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  store.openRightPanel();
  input.value = '';
  await store.sendMessage(text);
}

function closeAll() {
  showAgent.value = false;
  showProj.value = false;
  showPerm.value = false;
}

const agentName = computed(() => (store.currentAgent ? store.currentAgent.name : '选择智能体'));
const permName = computed(() => {
  const map: Record<string, string> = { readonly: '只读', readwrite: '读写', admin: '管理员' };
  return map[store.currentPermission] || '选择权限';
});
const projName = computed(() => store.currentProject || '选择文件夹');
</script>

<template>
  <div class="input-area">
    <div class="proj-popover" :class="{ active: showProj }">
      <div class="agent-popover-header">选择文件夹（归属文件夹）</div>
      <div class="agent-list">
        <div v-for="p in projects" :key="p.name" class="agent-item" @click="selectProject(p.name)">
          <div class="agent-icon" style="color:#f5b728;background:#fef3c7;">📁</div>
          <div class="agent-info">
            <div class="agent-name">{{ p.name }}</div>
            <div class="agent-desc">{{ p.path }}</div>
          </div>
        </div>
      </div>
      <div class="proj-new" @click="store.newProjectVisible = true; showProj = false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        新建文件夹（关联本地目录）
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
      </div>
    </div>

    <div class="agent-popover" :class="{ active: showPerm }">
      <div class="agent-popover-header">选择权限</div>
      <div class="agent-list">
        <div
          v-for="p in perms"
          :key="p.id"
          class="agent-item"
          :class="{ selected: store.currentPermission === p.id }"
          @click="selectPerm(p.id, p.name)"
        >
          <div class="agent-icon" style="background:var(--bg);">{{ p.icon }}</div>
          <div class="agent-info">
            <div class="agent-name">{{ p.name }}</div>
            <div class="agent-desc">{{ p.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="input-box">
      <textarea v-model="input" rows="1" placeholder="例如：帮我设计订单导出接口，包含入参、出参与错误码"></textarea>
      <div class="input-toolbar">
        <div class="input-left">
          <div class="mode-trigger folder-trigger" :class="{ unset: !store.currentProject }" @click="showProj = !showProj; closeAll(); showProj = !showProj? false : true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
            <span>{{ projName }}</span>
          </div>
          <div class="mode-trigger" @click="showPerm = !showPerm; closeAll(); showPerm = !showPerm? false : true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>{{ permName }}</span>
          </div>
          <div class="mode-trigger" :class="{ agent: !!store.currentAgent && store.currentAgent.id !== 'simple' }" @click="showAgent = !showAgent; closeAll(); showAgent = !showAgent? false : true">
            <span class="dot" :style="{ background: store.currentAgent && store.currentAgent.id !== 'simple' ? 'var(--success)' : 'var(--primary)' }"></span>
            <span>{{ agentName }}</span>
          </div>
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
              <div class="ctx-popover-rate">{{ pct }}%<span> of {{ (CTX_MAX / 1000).toFixed(0) }}k</span></div>
              <button class="ctx-popover-btn">压缩</button>
            </div>
          </div>
          <div class="upload-btn" title="上传图片或文件">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
          <button class="send-btn" title="发送" @click="send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="input-hint">选填 · 文件夹 / 权限 / 智能体，输入需求后可再指定</div>
  </div>
</template>
