<script setup lang="ts">
const api = (window as any).electronAPI;

function min() { api?.windowMinimize?.(); }
function max() { api?.windowMaximize?.(); }
function close() { api?.windowClose?.(); }
</script>

<template>
  <div class="title-bar">
    <div class="brand">
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="10" fill="#3b6cff" />
        <path d="M12 14h10v2H12v-2zm0 5h16v2H12v-2zm0 5h12v2H12v-2z" fill="#fff" />
        <circle cx="28" cy="26" r="5" fill="#10b981" />
        <path d="M26 26l1.5 1.5L30 24" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>AIxCoding 桌面端</span>
      <span style="color: var(--text-tertiary); font-weight: 400; font-size: 12px;">v0.1 预览</span>
    </div>
    <div class="window-ctrls">
      <button class="wc-btn" data-wc="min" title="最小化" @click="min">
        <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>
      </button>
      <button class="wc-btn" data-wc="max" title="恢复" @click="max">
        <svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2" /></svg>
      </button>
      <button class="wc-btn wc-close" data-wc="close" title="关闭" @click="close">
        <svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>
      </button>
    </div>
  </div>
</template>
