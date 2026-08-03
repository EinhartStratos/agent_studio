<script setup lang="ts">
import { useAppStore } from '../stores/app';

const store = useAppStore();

function openPreview(f: { name: string; meta: string; icon: string }) {
  store.setPreviewFile(f);
}

const todos = [
  { title: '读取目标文件 src/order.service.ts', meta: '已完成 · 4.2 KB', done: true },
  { title: '分析公共方法与边界条件', meta: '待执行', done: false },
  { title: '生成测试用例并写入文件', meta: '待执行', done: false },
  { title: '运行测试并输出报告', meta: '待执行', done: false },
];
const ctxs = [
  { name: 'src/order.service.ts', meta: '4.2 KB · 订单服务' },
  { name: 'tests/order.service.spec.ts', meta: '2.1 KB · 测试文件' },
];
const files = [
  { name: 'e-commerce-backend', indent: 0, isDir: true, meta: '' },
  { name: 'src', indent: 1, isDir: true, meta: '' },
  { name: 'order.service.ts', indent: 2, isDir: false, meta: '4.2 KB · TypeScript', icon: '📄' },
  { name: 'payment.controller.ts', indent: 2, isDir: false, meta: '2.8 KB · TypeScript', icon: '📄' },
  { name: 'user.module.ts', indent: 2, isDir: false, meta: '1.5 KB · TypeScript', icon: '📄' },
  { name: 'tests', indent: 1, isDir: true, meta: '' },
  { name: 'order.service.spec.ts', indent: 2, isDir: false, meta: '2.1 KB · TypeScript', icon: '📝' },
  { name: 'package.json', indent: 1, isDir: false, meta: '1.0 KB · JSON', icon: '📦' },
  { name: 'tsconfig.json', indent: 1, isDir: false, meta: '0.8 KB · JSON', icon: '⚙️' },
];
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
        <div class="rp-group-title">待办 <span class="rps-badge">4 项</span></div>
        <div v-for="(todo, i) in todos" :key="i" class="todo-item" :class="{ done: todo.done }">
          <span class="todo-check">{{ todo.done ? '✓' : '' }}</span>
          <div class="todo-text">
            <div class="todo-title">{{ todo.title }}</div>
            <div class="todo-meta">{{ todo.meta }}</div>
          </div>
        </div>
      </div>
      <div class="rp-group">
        <div class="rp-group-title">上下文</div>
        <div v-for="(ctx, i) in ctxs" :key="i" class="ctx-item" :title="ctx.name" @click="openPreview({ name: ctx.name, meta: ctx.meta, icon: '📄' })">
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
          <span class="ctx-remove" title="移除">×</span>
        </div>
        <div class="ctx-note">上下文由智能体根据对话内容自动收集，点 × 可移除；点文件可新开预览标签。</div>
      </div>
    </div>

    <div class="rp-pane" :class="{ active: store.activeRtab === 'files' }">
      <div
        v-for="(f, i) in files"
        :key="i"
        class="file-tree-item"
        @click="!f.isDir && openPreview({ name: f.name, meta: f.meta || '', icon: f.icon || '📄' })"
      >
        <span v-for="n in f.indent" :key="n" class="indent"></span>
        <span class="ft-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path :d="f.isDir ? 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' : 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'" />
            <polyline v-if="!f.isDir" points="14 2 14 8 20 8" />
          </svg>
        </span>
        {{ f.name }}
      </div>
    </div>

    <div class="rp-pane" :class="{ active: store.activeRtab === 'preview' }">
      <div class="file-preview-pane" style="height:100%; display:flex; flex-direction:column;">
        <div class="fp-head">
          <span class="fp-icon">{{ store.previewFile.icon }}</span>
          <span class="fp-name">{{ store.previewFile.name }}</span>
          <span class="fp-meta">{{ store.previewFile.meta }}</span>
        </div>
        <div class="fp-body" style="flex:1; overflow:auto;">
          <pre class="fp-code">export class OrderService {
  async createOrder(input: CreateOrderInput) {
    // 创建订单：校验库存、生成订单号、扣减库存
    const inventory = await this.inventory.check(input.skuId, input.qty);
    if (!inventory.enough) {
      throw new InsufficientInventoryError();
    }
    const order = await this.orderRepo.create({
      ...input,
      status: 'pending',
      createdAt: new Date(),
    });
    await this.inventory.deduct(input.skuId, input.qty, order.id);
    return order;
  }

  async getOrder(orderId: string) {
    return this.orderRepo.findById(orderId);
  }

  async cancelOrder(orderId: string) {
    const order = await this.getOrder(orderId);
    if (!order) throw new OrderNotFoundError();
    if (order.status === 'cancelled') throw new AlreadyCancelledError();
    order.status = 'cancelled';
    await this.orderRepo.save(order);
    await this.inventory.restore(order.skuId, order.qty, order.id);
    return order;
  }
}</pre>
        </div>
      </div>
    </div>
  </aside>
</template>
