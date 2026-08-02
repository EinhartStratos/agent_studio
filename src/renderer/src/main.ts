const api = window.electronAPI;

let currentSessionId = '';
let initialized = false;

function $<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function log(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info'): void {
  const el = $('log');
  if (!el) return;
  const colorClass = {
    info: '',
    success: 'success',
    error: 'error',
    warn: 'warn',
  }[type];
  const line = `<span class="${colorClass}">[${new Date().toLocaleTimeString()}] ${escapeHtml(message)}</span>`;
  el.innerHTML += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setDisabled(ids: string[], disabled: boolean): void {
  for (const id of ids) {
    const el = $(id);
    if (el) (el as HTMLButtonElement).disabled = disabled;
  }
}

function getWorkspacePath(): string {
  const input = $<HTMLInputElement>('workspaceInput');
  const value = input?.value.trim();
  if (value) return value;
  return '/Users/apple/Documents/work_two/temp_test';
}

async function initDriver(): Promise<void> {
  log('正在初始化 PiSdkDriver...');
  try {
    const result = (await api.nativeInitDriver()) as { ok: boolean; health?: any; error?: string };
    if (result.ok && result.health) {
      initialized = true;
      const health = result.health;
      const healthEl = $('health');
      if (healthEl) {
        healthEl.innerHTML = `
          <div class="success">初始化成功</div>
          <div>runtimeReady: ${health.runtimeReady}</div>
          <div>currentModel: ${health.currentModel ?? '无'}</div>
        `;
      }
      log(`驱动初始化成功，模型: ${health.currentModel ?? '无'}`, 'success');
      setDisabled(['createSessionBtn', 'listSessionsBtn', 'loadTreeBtn', 'sendBtn', 'previewBtn', 'diffBtn'], false);
    } else {
      throw new Error(result.error ?? 'Unknown error');
    }
  } catch (err) {
    log(`初始化失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function createSession(): Promise<void> {
  const workspace = getWorkspacePath();
  log(`创建会话，工作区: ${workspace}`);
  try {
    const result = (await api.nativeCreateSession(workspace)) as { ok: boolean; ref?: any; error?: string };
    if (result.ok && result.ref) {
      currentSessionId = result.ref.sessionId;
      const input = $<HTMLInputElement>('sessionIdInput');
      if (input) input.value = currentSessionId;
      log(`会话创建成功: ${result.ref.sessionId}`, 'success');
      log(`  文件: ${result.ref.sessionFile}`);
      log(`  名称: ${result.ref.name}`);
    } else {
      throw new Error(result.error ?? 'Unknown error');
    }
  } catch (err) {
    log(`创建会话失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function listSessions(): Promise<void> {
  const workspace = getWorkspacePath();
  log(`列出 ${workspace} 的会话...`);
  try {
    const result = (await api.nativeListSessions(workspace)) as { ok: boolean; sessions?: any[]; error?: string };
    if (result.ok) {
      const list = $('sessionList');
      if (list) list.innerHTML = '';
      (result.sessions ?? []).forEach((s) => {
        const li = document.createElement('li');
        li.textContent = `${s.name} (${s.sessionId.slice(0, 8)})`;
        list?.appendChild(li);
      });
      log(`找到 ${(result.sessions ?? []).length} 个会话`, 'success');
    } else {
      throw new Error(result.error ?? 'Unknown error');
    }
  } catch (err) {
    log(`列出会话失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function loadWorkspaceTree(): Promise<void> {
  const workspace = getWorkspacePath();
  log(`加载目录树: ${workspace}`);
  try {
    const result = (await api.nativeGetWorkspaceTree(workspace)) as { ok: boolean; tree?: any[]; error?: string };
    if (result.ok) {
      renderTree($('tree'), result.tree ?? []);
      log(`目录树加载成功`, 'success');
    } else {
      throw new Error(result.error ?? 'Unknown error');
    }
  } catch (err) {
    log(`加载目录树失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

function renderTree(container: HTMLElement | null, nodes: any[], level = 0): void {
  if (!container) return;
  if (level === 0) container.innerHTML = '';
  for (const node of nodes) {
    const div = document.createElement('div');
    div.className = 'tree-node';
    div.textContent = `${node.type === 'directory' ? '📁' : '📄'} ${node.name}`;
    div.style.paddingLeft = `${level * 12}px`;
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      if (node.type === 'file') {
        const input = $<HTMLInputElement>('filePathInput');
        if (input) input.value = node.path;
      }
      if (node.children?.length) {
        const childrenEl = div.nextElementSibling as HTMLElement | null;
        if (childrenEl) {
          childrenEl.style.display = childrenEl.style.display === 'none' ? 'block' : 'none';
        }
      }
    });
    container.appendChild(div);
    if (node.children?.length) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      renderTree(children, node.children, level + 1);
      container.appendChild(children);
    }
  }
}

async function sendMessage(): Promise<void> {
  const sessionId = $<HTMLInputElement>('sessionIdInput')?.value.trim() ?? currentSessionId;
  const text = $<HTMLTextAreaElement>('messageInput')?.value.trim() ?? '';
  if (!sessionId) {
    log('请先创建会话', 'warn');
    return;
  }
  if (!text) {
    log('消息不能为空', 'warn');
    return;
  }
  log(`发送消息到 ${sessionId.slice(0, 8)}: ${text}`);
  try {
    const result = (await api.nativeSendMessage(sessionId, { text })) as { ok: boolean; error?: string };
    if (result.ok) {
      log('消息已发送', 'success');
    } else {
      throw new Error(result.error ?? 'Unknown error');
    }
  } catch (err) {
    log(`发送失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function previewFile(): Promise<void> {
  const filePath = $<HTMLInputElement>('filePathInput')?.value.trim();
  if (!filePath) {
    log('请输入文件路径', 'warn');
    return;
  }
  log(`预览文件: ${filePath}`);
  try {
    const result = (await api.nativeGetFilePreview(filePath)) as { ok: boolean; preview?: string; error?: string };
    if (result.ok) {
      log('文件内容:', 'success');
      log(result.preview ?? '');
    } else {
      throw new Error(result.error ?? 'Unknown error');
    }
  } catch (err) {
    log(`预览失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function diffFile(): Promise<void> {
  const filePath = $<HTMLInputElement>('filePathInput')?.value.trim();
  if (!filePath) {
    log('请输入文件路径', 'warn');
    return;
  }
  log(`Diff 文件: ${filePath}`);
  try {
    const oldContent = 'hello world\n';
    const newContent = 'hello world\nnew line\n';
    const result = (await api.nativeGetDiff(filePath, oldContent, newContent)) as { ok: boolean; diff?: string; error?: string };
    if (result.ok) {
      log('Diff 结果:', 'success');
      log(result.diff ?? '');
    } else {
      throw new Error(result.error ?? 'Unknown error');
    }
  } catch (err) {
    log(`Diff 失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

api.onNativeSessionEvent((payload) => {
  log(`会话事件 [${payload.sessionId.slice(0, 8)}]: ${(payload.event as any)?.type ?? 'unknown'}`);
});

$('initBtn')?.addEventListener('click', initDriver);
$('createSessionBtn')?.addEventListener('click', createSession);
$('listSessionsBtn')?.addEventListener('click', listSessions);
$('loadTreeBtn')?.addEventListener('click', loadWorkspaceTree);
$('sendBtn')?.addEventListener('click', sendMessage);
$('previewBtn')?.addEventListener('click', previewFile);
$('diffBtn')?.addEventListener('click', diffFile);
