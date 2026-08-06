<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';

const router = useRouter();
const store = useAppStore();
const name = ref('');
const instruction = ref('');
const template = ref('');

function close() {
  store.newProjectVisible = false;
}

function confirm() {
  const p = store.activeProject;
  const n = name.value.trim() || (p?.name ?? '未命名团队空间');
  store.showToastMsg('已创建团队空间：' + n);
  store.activeProject = { id: 'new-' + Date.now(), name: n, desc: instruction.value || p?.desc || '', icon: p?.icon || '📁', color: p?.color || '#e9f7ef' };
  close();
  router.push(`/project/${store.activeProject.id}`);
}

const templates = [
  { id: '', label: '选择模板' },
  { id: 'fullstack', label: '产品需求全流程' },
  { id: 'research', label: '市场调研与竞品分析' },
  { id: 'kb', label: '团队知识库' },
  { id: 'delivery', label: '团队交付' },
  { id: 'bug', label: 'Bug 跟踪/测试验收' },
];
</script>

<template>
  <div class="modal-overlay active" @click.self="close">
    <div class="modal new-project-modal">
      <div class="modal-header">
        <h3>新建团队空间</h3>
        <button class="modal-close" @click="close">×</button>
      </div>
      <div class="modal-body">
        <div class="npm-field">
          <label>团队空间名称</label>
          <input v-model="name" type="text" class="text-input" placeholder="请输入团队空间名称" />
        </div>
        <div class="npm-field">
          <div class="npm-label-row">
            <label>指令</label>
            <select v-model="template" class="npm-template-select">
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.label }}</option>
            </select>
          </div>
          <textarea v-model="instruction" class="npm-textarea" rows="5" placeholder="提供当前团队空间的背景信息和规范，让 AI 的回复更精准、更符合要求。比如：团队空间目标、团队习惯、风格偏好、输出约束等"></textarea>
        </div>
        <div class="npm-add-list">
          <div class="npm-add-row">
            <div>
              <span><b>智能体</b><em>（可选）</em></span>
              <div class="npm-chips"></div>
            </div>
            <button class="npm-add-btn" @click="store.showToastMsg('智能体选择待接入')">+ 添加</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <span class="npm-hint">切换模版会覆盖当前编辑内容</span>
        <div class="modal-actions">
          <button class="btn-ghost" @click="close">取消</button>
          <button class="btn-primary" @click="confirm">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>
