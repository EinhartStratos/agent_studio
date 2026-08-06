<script setup lang="ts">
import { useAppStore } from '../stores/app';

const store = useAppStore();

function applyTheme(t: 'light' | 'dark') {
  store.setTheme(t);
  document.body.classList.toggle('theme-dark', t === 'dark');
}

function close() {
  store.settingsVisible = false;
}
</script>

<template>
  <div class="modal-overlay active" @click.self="close">
    <div class="modal settings-modal">
      <div class="modal-header">
        <h3>设置</h3>
        <button class="modal-close" @click="close">×</button>
      </div>
      <div class="modal-body settings-body">
        <div class="set-group">
          <div class="set-group-title">外观</div>
          <div class="set-row">
            <span class="set-row-label">主题</span>
            <div class="theme-switch">
              <button class="theme-opt" :class="{ active: store.theme === 'light' }" @click="applyTheme('light')" title="亮色">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
                亮
              </button>
              <button class="theme-opt" :class="{ active: store.theme === 'dark' }" @click="applyTheme('dark')" title="暗色">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
                暗
              </button>
            </div>
          </div>
        </div>
        <div class="set-group">
          <div class="set-group-title">通用</div>
          <div class="set-about-item">
            <span>默认模型</span>
            <button class="set-link-btn" @click="store.showToastMsg('模型管理功能待接入')">管理默认模型</button>
          </div>
          <div class="set-about-item">
            <span>快捷键</span>
            <button class="set-link-btn" @click="store.showToastMsg('快捷键面板待接入')">查看快捷键</button>
          </div>
          <div class="set-about-item">
            <span>清除本地数据</span>
            <button class="set-link-btn" style="color:#ef4444" @click="store.showToastMsg('本地数据已清除（演示）')">清除</button>
          </div>
        </div>
        <div class="set-group">
          <div class="set-group-title">关于</div>
          <div class="set-about-item">
            <span>版本</span>
            <span class="val">v0.1 预览</span>
          </div>
          <div class="set-about-item">
            <span>检查更新</span>
            <button class="set-link-btn" @click="store.showToastMsg('已是最新版本')">检查更新</button>
          </div>
          <div class="set-about-item">
            <span>帮助文档</span>
            <button class="set-link-btn" @click="store.showToastMsg('帮助文档待接入')">查看帮助</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <div class="modal-actions">
          <button class="btn btn-primary" @click="close">完成</button>
        </div>
      </div>
    </div>
  </div>
</template>
