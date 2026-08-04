<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import type { MarketplaceAgent } from '../../../shared/types';
import type { AgentInfo } from '../types';
import { useAppStore } from '../stores/app';

const router = useRouter();
const store = useAppStore();

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

const agents = ref<MarketplaceAgent[]>([]);

const showUploadModal = ref(false);
const uploadLoading = ref(false);
const uploadError = ref('');

const formName = ref('');
const formDesc = ref('');
const formCat = ref('');
const formFile = ref<File | null>(null);
const formFileName = ref('');

const fileInputRef = ref<HTMLInputElement | null>(null);
const creatingAgentSessionId = ref('');

async function loadAgents(): Promise<void> {
  try {
    const res = await api.marketplaceListAgents();
    if (res.ok && res.agents) {
      agents.value = res.agents;
    }
  } catch (e) {
    console.error('Failed to load agents:', e);
  }
}

onMounted(async () => {
  await loadAgents();
});

const filtered = computed(() => {
  let list = agents.value;
  if (activeCat.value !== 'all') list = list.filter(a => a.cat === activeCat.value);
  if (search.value.trim()) list = list.filter(a => a.name.toLowerCase().includes(search.value.toLowerCase()));
  return list;
});

const selectableCats = computed(() => cats.filter(c => c.id !== 'all'));

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

function toAgentInfo(agent: MarketplaceAgent): AgentInfo {
  return {
    id: agent.id,
    name: agent.name,
    desc: agent.desc,
    icon: agent.emoji || '🤖',
    color: getAgentColor(agent.cat),
  };
}

function openUploadModal(): void {
  formName.value = '';
  formDesc.value = '';
  formCat.value = selectableCats.value[0]?.id || '';
  formFile.value = null;
  formFileName.value = '';
  uploadError.value = '';
  uploadLoading.value = false;
  showUploadModal.value = true;
}

function closeUploadModal(): void {
  if (uploadLoading.value) return;
  showUploadModal.value = false;
}

function onChooseFileClick(): void {
  fileInputRef.value?.click();
}

function clearSelectedFile(): void {
  formFile.value = null;
  formFileName.value = '';
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    formFile.value = input.files[0];
    formFileName.value = input.files[0].name;
  }
}

function validateForm(): string {
  if (!formName.value.trim()) return '请输入智能体名称';
  if (!formDesc.value.trim()) return '请输入智能体描述';
  if (!formCat.value) return '请选择智能体分类';
  if (!formFile.value) return '请上传智能体文件';
  return '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function submitUpload(): Promise<void> {
  const err = validateForm();
  if (err) {
    uploadError.value = err;
    return;
  }
  if (!formFile.value) return;

  uploadLoading.value = true;
  uploadError.value = '';

  try {
    const base64 = await fileToBase64(formFile.value);
    const res = await api.marketplaceUploadAgent({
      name: formName.value,
      description: formDesc.value,
      category: formCat.value,
      fileName: formFile.value.name,
      fileData: base64,
    });

    if (res.ok && res.agent) {
      await loadAgents();
      activeCat.value = 'all';
      showUploadModal.value = false;
      api.nativeShowToast('智能体上传成功', 'success');
    } else {
      uploadError.value = res.error || '上传失败';
    }
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    uploadLoading.value = false;
  }
}

function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    closeUploadModal();
  }
}

async function createChatWithAgent(agent: MarketplaceAgent): Promise<void> {
  creatingAgentSessionId.value = agent.id;
  try {
    store.setAgent(toAgentInfo(agent));
    store.startDraftSession();
    router.push('/chat');
    store.openRightPanel();
    api.nativeShowToast(`已使用 ${agent.name} 创建新对话`, 'success');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    api.nativeShowToast(`创建对话失败：${message}`, 'error');
  } finally {
    creatingAgentSessionId.value = '';
  }
}
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
          <button class="mp-upload-btn" @click="openUploadModal">
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
        <div v-for="a in filtered" :key="a.id" class="mp-card" :class="{ 'mp-card-custom': a.custom }">
          <div class="mp-card-icon" :style="{ color: 'var(--text-primary)' }">{{ a.emoji || '📦' }}</div>
          <div class="mp-card-body">
            <div class="mp-card-title">
              {{ a.name }}
              <span v-if="a.custom" class="mp-card-tag-custom">自定义</span>
            </div>
            <div class="mp-card-desc">{{ a.desc }}</div>
          </div>
          <button
            class="mp-card-add"
            :data-id="a.id"
            title="新建对话并选择该智能体"
            :disabled="creatingAgentSessionId === a.id"
            @click="createChatWithAgent(a)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      <div v-if="!filtered.length" class="mp-empty">未找到匹配的智能体</div>
    </div>

    <div v-if="showUploadModal" class="mp-modal-overlay" @click="onOverlayClick">
      <div class="mp-modal" role="dialog" aria-modal="true">
        <div class="mp-modal-header">
          <h2>上传智能体</h2>
          <button class="mp-modal-close" @click="closeUploadModal" :disabled="uploadLoading" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="mp-modal-body">
          <div class="mp-form-field">
            <label class="mp-form-label">
              智能体名称 <span class="mp-form-required">*</span>
            </label>
            <input
              v-model="formName"
              type="text"
              class="mp-form-input"
              placeholder="请输入智能体名称"
              maxlength="50"
              :disabled="uploadLoading"
            />
          </div>

          <div class="mp-form-field">
            <label class="mp-form-label">
              智能体描述 <span class="mp-form-required">*</span>
            </label>
            <textarea
              v-model="formDesc"
              class="mp-form-textarea"
              placeholder="请输入智能体的功能描述"
              rows="3"
              maxlength="300"
              :disabled="uploadLoading"
            ></textarea>
          </div>

          <div class="mp-form-field">
            <label class="mp-form-label">
              智能体分类 <span class="mp-form-required">*</span>
            </label>
            <select v-model="formCat" class="mp-form-select" :disabled="uploadLoading">
              <option v-for="c in selectableCats" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
          </div>

          <div class="mp-form-field">
            <label class="mp-form-label">
              上传文件 <span class="mp-form-required">*</span>
            </label>
            <input
              ref="fileInputRef"
              type="file"
              class="mp-form-file-hidden"
              @change="onFileChange"
              :disabled="uploadLoading"
            />
            <div class="mp-file-uploader" @click="onChooseFileClick" :class="{ 'has-file': !!formFileName }">
              <svg v-if="!formFileName" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <div v-if="!formFileName" class="mp-file-uploader-text">
                <div class="mp-file-uploader-title">点击选择文件</div>
                <div class="mp-file-uploader-hint">支持 .zip, .json, .js, .py 等格式</div>
              </div>
              <div v-else class="mp-file-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span class="mp-file-name">{{ formFileName }}</span>
                  <button type="button" class="mp-file-remove" @click.stop="clearSelectedFile" :disabled="uploadLoading">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div v-if="uploadError" class="mp-form-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {{ uploadError }}
          </div>
        </div>

        <div class="mp-modal-footer">
          <button class="mp-btn mp-btn-secondary" @click="closeUploadModal" :disabled="uploadLoading">
            取消
          </button>
          <button class="mp-btn mp-btn-primary" @click="submitUpload" :disabled="uploadLoading">
            <svg v-if="uploadLoading" class="mp-spinner" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="31.4 31.4" stroke-dashoffset="10"/>
            </svg>
            {{ uploadLoading ? '上传中...' : '确认上传' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-card-custom {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary) inset;
}

.mp-card-tag-custom {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  margin-left: 8px;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  color: var(--primary);
  background: var(--primary-light);
  border-radius: 4px;
  vertical-align: middle;
}

.mp-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(29, 35, 56, 0.4);
  backdrop-filter: blur(2px);
  animation: mpFadeIn 0.18s ease-out;
}

@keyframes mpFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.mp-modal {
  width: 480px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  animation: mpModalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

@keyframes mpModalIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.mp-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-light);
}

.mp-modal-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.mp-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.mp-modal-close:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.mp-modal-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mp-modal-close svg {
  width: 16px;
  height: 16px;
}

.mp-modal-body {
  padding: 18px 20px;
  overflow-y: auto;
  flex: 1;
}

.mp-form-field {
  margin-bottom: 16px;
}

.mp-form-field:last-of-type {
  margin-bottom: 0;
}

.mp-form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.mp-form-required {
  color: var(--error);
}

.mp-form-input,
.mp-form-textarea,
.mp-form-select {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: var(--font);
}

.mp-form-input:focus,
.mp-form-textarea:focus,
.mp-form-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 108, 255, 0.08);
}

.mp-form-input:disabled,
.mp-form-textarea:disabled,
.mp-form-select:disabled {
  background: var(--bg);
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.mp-form-textarea {
  resize: vertical;
  min-height: 72px;
  line-height: 1.5;
}

.mp-form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b95ad' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 16px;
  padding-right: 34px;
  cursor: pointer;
}

.mp-form-select:disabled {
  cursor: not-allowed;
}

.mp-form-file-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.mp-file-uploader {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  min-height: 100px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.mp-file-uploader:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light);
}

.mp-file-uploader svg {
  width: 28px;
  height: 28px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.mp-file-uploader-text {
  text-align: center;
}

.mp-file-uploader-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 3px;
}

.mp-file-uploader-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

.mp-file-uploader.has-file {
  flex-direction: row;
  gap: 10px;
  padding: 12px 14px;
  min-height: unset;
  border-style: solid;
  border-color: var(--border-light);
}

.mp-file-uploader.has-file:hover {
  border-color: var(--primary);
}

.mp-file-uploader.has-file svg {
  width: 20px;
  height: 20px;
  margin-bottom: 0;
  color: var(--primary);
}

.mp-file-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.mp-file-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-file-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.mp-file-remove:hover:not(:disabled) {
  color: var(--error);
  background: color-mix(in srgb, var(--error) 12%, transparent);
}

.mp-file-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mp-file-remove svg {
  width: 14px;
  height: 14px;
}

.mp-form-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--error);
  background: color-mix(in srgb, var(--error) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
  border-radius: var(--radius-sm);
}

.mp-form-error svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.mp-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border-light);
  background: var(--bg);
}

.mp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  white-space: nowrap;
  font-family: var(--font);
}

.mp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mp-btn-secondary {
  color: var(--text-secondary);
  background: var(--surface);
  border-color: var(--border);
}

.mp-btn-secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.mp-btn-primary {
  color: #fff;
  background: var(--primary);
}

.mp-btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.mp-spinner {
  width: 16px;
  height: 16px;
  animation: mpSpin 0.8s linear infinite;
}

@keyframes mpSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
