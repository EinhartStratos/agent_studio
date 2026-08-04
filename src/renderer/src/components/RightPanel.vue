<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();

const fileFolded = ref(true);
const FOLD_THRESHOLD = 12;

const isFileLong = computed(() => {
  const content = store.previewFile.content || '';
  if (!content) return false;
  return content.split(/\r?\n/).length > FOLD_THRESHOLD;
});

watch(
  () => store.previewFile.content,
  () => {
    fileFolded.value = true;
  }
);

function openPreview(f: { name: string; meta?: string; icon?: string; path?: string }) {
  if (f.path) {
    store.getFilePreview(f.path);
  } else {
    store.setPreviewFile({ name: f.name, meta: f.meta || '', icon: f.icon || '📄', content: '' });
  }
}

function openContextFile(f: { name: string; meta: string; icon: string; path?: string }) {
  if (f.path) store.getFilePreview(f.path);
}

function fileIcon(f: { isDir: boolean }): string {
  return f.isDir ? '📁' : '📄';
}
</script>

<template>
  <aside
    class="right-panel"
    :class="{ collapsed: !store.isRightPanelOpen, fullscreen: store.isRightPanelFullscreen }"
  >
    <div class="rp-tabs">
      <div class="rp-tab-list">
        <div
          class="rp-tab"
          :class="{ active: store.activeRtab === 'task' }"
          @click="store.setActiveRtab('task')"
        >
          <svg class="rps-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          </svg>
          <span class="rp-tab-label">任务摘要</span>
        </div>
        <div
          class="rp-tab"
          :class="{ active: store.activeRtab === 'files' }"
          @click="store.setActiveRtab('files')"
        >
          <svg class="rps-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span class="rp-tab-label">文件树</span>
        </div>
        <div
          v-if="store.activeRtab === 'preview'"
          class="rp-tab rp-file-tab active"
        >
          <span class="rps-emoji">{{ store.previewFile.icon }}</span>
          <span class="rp-tab-label">{{ store.previewFile.name }}</span>
          <span class="rp-tab-close" title="关闭" @click="store.setActiveRtab('files')">×</span>
        </div>
      </div>
      <div class="rp-actions">
        <button
          class="rp-icon-btn"
          :title="store.isRightPanelFullscreen ? '退出全屏' : '展开全屏'"
          @click="store.toggleRightPanelFullscreen()"
        >
          <svg
            v-if="!store.isRightPanelFullscreen"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          <svg
            v-else
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <button class="rp-collapse-btn" title="收起右侧面板" @click="store.closeRightPanel()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="15" y1="4" x2="15" y2="20" />
          </svg>
        </button>
      </div>
    </div>

    <div class="rp-pane" :class="{ active: store.activeRtab === 'task' }">
      <div class="rp-group">
        <div class="rp-group-title">
          待办
          <span class="rps-badge" :class="{ running: store.isGenerating, done: !store.isGenerating && store.todos.length && store.todos.every((t) => t.done) }">
            {{ store.todos.length }} 项
          </span>
          <span v-if="store.isGenerating" class="rps-status running">执行中</span>
          <span v-else-if="store.todos.length" class="rps-status done">已完成</span>
        </div>
        <div v-for="(todo, i) in store.todos" :key="i" class="todo-item" :class="{ done: todo.done }">
          <span class="todo-check">{{ todo.done ? '✓' : '' }}</span>
          <div class="todo-text">
            <div class="todo-title">{{ todo.title }}</div>
            <div class="todo-meta">{{ todo.meta }}</div>
          </div>
        </div>
        <div v-if="!store.todos.length" class="ctx-note">暂无执行中任务，发送消息开始对话。</div>
      </div>
      <div class="rp-group">
        <div class="rp-group-title">上下文</div>
        <div
          v-for="(ctx, i) in store.contextFiles"
          :key="i"
          class="ctx-item"
          :title="ctx.name"
          @click="openContextFile(ctx)"
        >
          <span class="ctx-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
          <div class="ctx-info">
            <div class="ctx-name">{{ ctx.name }}</div>
            <div class="ctx-meta">{{ ctx.meta }}</div>
          </div>
        </div>
        <div class="ctx-note">上下文由智能体根据对话内容自动收集，点文件可新开预览标签。</div>
      </div>
    </div>

    <div class="rp-pane" :class="{ active: store.activeRtab === 'files' }">
      <div
        v-for="(f, i) in store.rightPanelFiles"
        :key="i"
        class="file-tree-item"
        @click="!f.isDir && openPreview({ name: f.name, meta: f.meta || '', icon: fileIcon(f), path: f.path })"
      >
        <span v-for="n in f.indent" :key="n" class="indent"></span>
        <span class="ft-ico">{{ fileIcon(f) }}</span>
        {{ f.name }}
      </div>
    </div>

    <div class="rp-pane" :class="{ active: store.activeRtab === 'preview' }">
      <div class="file-preview-pane" style="height:100%; display:flex; flex-direction:column;">
        <div class="fp-head">
          <span class="fp-icon">{{ store.previewFile.icon }}</span>
          <span class="fp-name">{{ store.previewFile.name || '预览' }}</span>
          <span class="fp-meta">{{ store.previewFile.meta }}</span>
        </div>
        <div class="fp-body" :class="{ folded: fileFolded && isFileLong }" style="flex:1; overflow:auto;">
          <pre class="fp-code">{{ store.previewFile.content || '点击文件树中的文件以查看内容' }}</pre>
        </div>
        <div v-if="isFileLong" class="fp-fold">
          <button class="fp-fold-btn" @click="fileFolded = !fileFolded">
            {{ fileFolded ? '展开全部' : '收起' }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
