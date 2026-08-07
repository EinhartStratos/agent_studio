<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAppStore, useProjectStore } from '../stores/app';
import { DEFAULT_AGENT_CATALOG } from '../stores/project';

const store = useAppStore();
const projectStore = useProjectStore();
const p = projectStore.activeProject;

const isEditMode = computed(() => {
  if (!p?.id) return false;
  return projectStore.myProjects.some((m) => m.id === p!.id);
});

const modalTitle = computed(() => (isEditMode.value ? '修改团队空间' : '新建团队空间'));

const name = ref(p?.name ?? '');
const instruction = ref(p?.directive ?? '');
const template = ref('');
const selectedAgents = ref<string[]>(p?.agents ?? []);

function close() {
  projectStore.newProjectVisible = false;
}

const submitting = ref(false);

async function confirm() {
  if (submitting.value) return;
  submitting.value = true;
  const n = name.value.trim() || (p?.name ?? '未命名团队空间');
  try {
    if (isEditMode.value) {
      await projectStore.updateProject(p!.id, {
        name: n,
        desc: instruction.value || '',
        directive: instruction.value || '',
        agents: selectedAgents.value,
      });
      store.showToastMsg('已修改团队空间：' + n);
    } else {
      await projectStore.createProject({
        name: n,
        desc: instruction.value || '',
        icon: p?.icon || '📁',
        color: p?.color || '#e9f7ef',
        directive: instruction.value || '',
        agents: selectedAgents.value,
      });
      store.showToastMsg('已创建团队空间：' + n);
    }
    close();
  } finally {
    submitting.value = false;
  }
}

const templates = [
  { id: '', label: '选择模板', directive: '' },
  { id: 'fullstack', label: '产品需求全流程', directive: '你是电商后端团队空间的AI助手。团队负责订单、库存、支付等核心服务的迭代。请关注高并发场景、数据一致性、接口兼容性。输出方案需考虑水平扩展和容灾策略。' },
  { id: 'research', label: '市场调研与竞品分析', directive: '市场调研与竞品分析' },
  { id: 'kb', label: '团队知识库', directive: '团队知识库' },
  { id: 'delivery', label: '团队交付', directive: '团队交付' },
  { id: 'bug', label: 'Bug 跟踪/测试验收', directive: 'Bug 跟踪/测试验收' },
];

if (p?.directive) {
  const t = templates.find((t) => t.directive === p.directive);
  if (t) {
    template.value = t.directive;
  }
}

function getTemplateDirective(event: Event) {
  instruction.value = (event.target as HTMLSelectElement).value;
}
</script>

<template>
  <div class="modal-overlay active" @click.self="close">
    <div class="modal new-project-modal">
      <div class="modal-header">
        <h3>{{ modalTitle }}</h3>
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
            <select v-model="template" class="npm-template-select" @change="getTemplateDirective($event)">
              <option v-for="t in templates" :key="t.id" :value="t.directive">{{ t.label }}</option>
            </select>
          </div>
          <textarea v-model="instruction" class="npm-textarea" rows="5" placeholder="提供当前团队空间的背景信息和规范，让 AI 的回复更精准、更符合要求。比如：团队空间目标、团队习惯、风格偏好、输出约束等"></textarea>
        </div>
        <div class="npm-field">
          <label>
            <span><b>智能体</b><em>（可选）</em></span>
          </label>
          <el-select
            v-model="selectedAgents"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            class="npm-agent-select"
            placeholder="搜索并选择智能体"
          >
            <el-option
              v-for="a in DEFAULT_AGENT_CATALOG"
              :key="a.id"
              :label="a.name"
              :value="a.value"
            />
          </el-select>
        </div>
      </div>
      <div class="modal-footer">
        <span v-if="!isEditMode" class="npm-hint">切换模版会覆盖当前编辑内容</span>
        <div class="modal-actions">
          <button class="btn-ghost" @click="close">取消</button>
          <button class="btn-primary" :disabled="submitting" @click="confirm">
            {{ submitting ? (isEditMode ? '保存中...' : '创建中...') : (isEditMode ? '保存' : '确定') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.npm-agent-select {
  width: 100%;
}
</style>
