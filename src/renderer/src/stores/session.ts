import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AgentInfo, Project, SessionRef, TranscriptItem, FileTreeNode, SkillInfo } from '../types';
import type { UserMessageInput } from '../../../shared/types';
import type { WorkspaceHistoryEntry } from '../../../shared/config';

const api = (window as any).electronAPI;

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (isToday) return `今天 ${hh}:${mm}`;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}

function fileNameFromPath(p?: string): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface PreviewFile {
  name: string;
  meta: string;
  icon: string;
  content: string;
  path?: string;
}

interface TodoItem {
  title: string;
  meta: string;
  done: boolean;
}

interface ContextFile {
  name: string;
  meta: string;
  icon: string;
  path?: string;
}

interface ProjectOption {
  name: string;
  path: string;
}

function serializeWorkspaceHistory(entries: ProjectOption[]): WorkspaceHistoryEntry[] {
  return entries.map((entry) => ({
    name: String(entry.name ?? '').trim(),
    path: String(entry.path ?? '').trim(),
  })).filter((entry) => entry.name && entry.path);
}

function normalizeWorkspaceHistory(entries?: WorkspaceHistoryEntry[]): ProjectOption[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const result: ProjectOption[] = [];
  for (const entry of entries) {
    const name = String(entry?.name ?? '').trim();
    const p = String(entry?.path ?? '').trim();
    if (!name || !p || seen.has(p)) continue;
    seen.add(p);
    result.push({ name, path: p });
  }
  return result;
}

function upsertWorkspaceHistory(entries: ProjectOption[], item: ProjectOption): ProjectOption[] {
  return [
    { name: item.name.trim(), path: item.path.trim() },
    ...entries.filter((entry) => entry.path !== item.path),
  ].filter((entry) => entry.name && entry.path);
}

export const useAppStore = defineStore('app', () => {
  // ---- UI / 旧状态 ----
  const theme = ref<'light' | 'dark'>('light');
  const isRightPanelOpen = ref(false);
  const isRightPanelFullscreen = ref(false);
  const activeRtab = ref<'task' | 'files' | 'preview'>('task');
  const previewFile = ref<PreviewFile>({ name: '', meta: '', icon: '📄', content: '' });
  const settingsVisible = ref(false);
  const newProjectVisible = ref(false);
  const activeProject = ref<Project | null>(null);
  const currentAgent = ref<AgentInfo | null>(null);
  const currentPermission = ref<string>('readonly');
  const currentProject = ref<string>('');
  const workspaceHistory = ref<ProjectOption[]>([]);
  const contextUsed = ref(0);
  const showToast = ref(false);
  const toastMessage = ref('');

  // ---- 原生对话状态 ----
  const appConfig = ref<any>(null);
  const workspacePath = ref<string>('');
  const sessions = ref<SessionRef[]>([]);
  const currentSession = ref<SessionRef | null>(null);
  const transcript = ref<TranscriptItem[]>([]);
  const workspaceTree = ref<FileTreeNode[]>([]);
  const isLoading = ref(false);
  const isGenerating = ref(false);
  const driverHealth = ref<any>(null);
  const CTX_MAX = 18000;
  const contextUsedTokens = ref(0);
  const skills = ref<SkillInfo[]>([]);

  // ---- 计算属性 ----
  const hasMessages = computed(() => transcript.value.length > 0 || isGenerating.value);

  const pct = computed(() => Math.min(100, Math.round((contextUsedTokens.value / CTX_MAX) * 100)));

  const todos = computed<TodoItem[]>(() => {
    // 优先从 plan 类型消息取待办
    const plan = [...transcript.value].reverse().find((t) => t.type === 'plan');
    if (plan?.plan?.entries?.length) {
      return plan.plan.entries.map((e: any) => ({
        title: String(e.content ?? ''),
        meta: String(e.status ?? '待执行'),
        done: /^(done|completed|success)$/.test(String(e.status ?? '')),
      }));
    }

    // 没有 plan 时，从最近的 tool 调用推导执行步骤
    const toolItems = transcript.value
      .filter((t) => t.type === 'tool' && (t.tool?.title || t.tool?.name))
      .slice(-6);
    if (toolItems.length) {
      return toolItems.map((t) => {
        const title = String(t.tool?.title || t.tool?.name || '工具调用');
        const status = String(t.tool?.status || '');
        const done = /^(done|completed|success)$/.test(status.toLowerCase());
        const meta = status || (done ? '已完成' : '执行中');
        return { title, meta, done };
      });
    }

    // 模型正在生成但还没有任何 tool/plan 时，显示一个占位提示
    if (isGenerating.value) {
      return [{ title: '模型正在处理任务', meta: '执行中', done: false }];
    }

    return [];
  });

  const contextFiles = computed<ContextFile[]>(() => {
    const list: ContextFile[] = [];
    const seen = new Set<string>();
    for (const item of transcript.value) {
      if (item.type === 'tool' && item.tool?.locations) {
        for (const loc of item.tool.locations) {
          if (!loc.path || seen.has(loc.path)) continue;
          seen.add(loc.path);
          list.push({
            name: fileNameFromPath(loc.path),
            meta: item.tool.title || item.tool.name || '上下文文件',
            icon: '📄',
            path: loc.path,
          });
        }
      }
    }
    return list;
  });

  const rightPanelFiles = computed(() => {
    const list: Array<{ name: string; indent: number; isDir: boolean; meta: string; icon?: string; path?: string }> = [];
    function walk(nodes: FileTreeNode[], indent: number) {
      for (const n of nodes) {
        const isDir = n.type === 'directory';
        list.push({
          name: n.name,
          indent,
          isDir,
          meta: isDir ? '' : '文件',
          icon: isDir ? undefined : '📄',
          path: n.path,
        });
        if (n.children && n.children.length) {
          walk(n.children, indent + 1);
        }
      }
    }
    walk(workspaceTree.value, 0);
    return list;
  });

  const projects = computed<ProjectOption[]>(() => {
    return workspaceHistory.value;
  });

  const activeTask = computed(() => currentSession.value?.sessionId ?? '');

  // ---- UI actions ----
  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light';
  }
  function setTheme(t: 'light' | 'dark') {
    theme.value = t;
  }
  function openRightPanel() {
    isRightPanelOpen.value = true;
  }
  function closeRightPanel() {
    isRightPanelOpen.value = false;
    isRightPanelFullscreen.value = false;
  }
  function toggleRightPanel() {
    isRightPanelOpen.value = !isRightPanelOpen.value;
  }
  function toggleRightPanelFullscreen() {
    isRightPanelFullscreen.value = !isRightPanelFullscreen.value;
  }
  function setActiveRtab(tab: 'task' | 'files' | 'preview') {
    activeRtab.value = tab;
  }
  function setPreviewFile(f: { name: string; meta: string; icon: string; content?: string; path?: string }) {
    previewFile.value = { ...previewFile.value, ...f, content: f.content ?? '' };
    activeRtab.value = 'preview';
  }
  function showToastMsg(msg: string) {
    toastMessage.value = msg;
    showToast.value = true;
    setTimeout(() => {
      showToast.value = false;
    }, 2200);
  }
  function setActiveProject(p: Project | null) {
    activeProject.value = p;
  }
  function setAgent(a: AgentInfo | null) {
    currentAgent.value = a;
  }
  function setPermission(p: string) {
    currentPermission.value = p;
  }

  async function persistWorkspaceSelection(nextWorkspacePath: string, nextHistory = workspaceHistory.value): Promise<void> {
    const res = await api.updateAppConfig({
      native: {
        defaultWorkspace: String(nextWorkspacePath || ''),
        workspaceHistory: serializeWorkspaceHistory(nextHistory),
      },
    });
    if (!res?.ok) {
      throw new Error(String(res?.error || '保存工作区配置失败'));
    }
    appConfig.value = res.config ?? appConfig.value;
  }

  async function selectProject(pathOrName: string): Promise<boolean> {
    const project = projects.value.find((entry) => entry.path === pathOrName || entry.name === pathOrName);
    if (!project) return false;
    currentProject.value = project.name;
    workspacePath.value = project.path;
    workspaceHistory.value = upsertWorkspaceHistory(workspaceHistory.value, project);
    try {
      await persistWorkspaceSelection(project.path, workspaceHistory.value);
      await loadWorkspaceTree();
      await loadSessions();
      showToastMsg('已归属到文件夹：' + project.name);
      return true;
    } catch (e: any) {
      showToastMsg('保存工作区失败：' + String(e?.message || e));
      return false;
    }
  }

  async function createWorkspaceHistory(name: string, folderPath: string): Promise<ProjectOption> {
    const entry = {
      name: name.trim(),
      path: folderPath.trim(),
    };
    if (!entry.name) throw new Error('请输入工作区描述');
    if (!entry.path) throw new Error('请选择本地文件夹');
    workspaceHistory.value = upsertWorkspaceHistory(workspaceHistory.value, entry);
    currentProject.value = entry.name;
    workspacePath.value = entry.path;
    await persistWorkspaceSelection(entry.path, workspaceHistory.value);
    await loadWorkspaceTree();
    await loadSessions();
    showToastMsg('已选择工作区：' + entry.name);
    return entry;
  }

  // ---- 原生对话 actions ----
  async function loadAppConfig() {
    try {
      const cfg = await api.getAppConfig();
      appConfig.value = cfg;
      const ws = cfg?.native?.defaultWorkspace?.trim() || '';
      workspaceHistory.value = normalizeWorkspaceHistory(cfg?.native?.workspaceHistory);
      if (ws && !workspaceHistory.value.some((entry) => entry.path === ws)) {
        workspaceHistory.value = upsertWorkspaceHistory(workspaceHistory.value, {
          name: fileNameFromPath(ws),
          path: ws,
        });
      }
      workspacePath.value = ws;
      currentProject.value = ws
        ? (workspaceHistory.value.find((entry) => entry.path === ws)?.name || fileNameFromPath(ws))
        : '';
    } catch (e: any) {
      showToastMsg('读取配置失败：' + String(e?.message || e));
    }
  }

  async function initDriver() {
    try {
      const res = await api.nativeInitDriver();
      driverHealth.value = res.health || res;
      if (!res.ok) {
        showToastMsg('初始化驱动失败：' + String(res.error || '未知错误'));
      }
    } catch (e: any) {
      showToastMsg('初始化驱动失败：' + String(e?.message || e));
    }
  }

  async function loadSessions() {
    if (!workspacePath.value) return;
    try {
      const res = await api.nativeListSessions(workspacePath.value);
      if (res.ok) {
        sessions.value = (res.sessions || []) as SessionRef[];
      } else {
        showToastMsg('加载会话列表失败：' + String(res.error || ''));
      }
    } catch (e: any) {
      showToastMsg('加载会话列表失败：' + String(e?.message || e));
    }
  }

  async function loadTranscript() {
    if (!currentSession.value) return;
    try {
      const res = await api.nativeGetTranscript(currentSession.value.sessionId);
      if (res.ok) {
        transcript.value = (res.transcript || []) as TranscriptItem[];
        updateContextUsage();
      }
    } catch (e: any) {
      showToastMsg('加载对话失败：' + String(e?.message || e));
    }
  }

  async function loadSkills() {
    if (!currentSession.value) {
      skills.value = [];
      return;
    }
    try {
      const res = await api.nativeListSkills(currentSession.value.sessionId);
      if (res.ok) {
        skills.value = (res.skills || []) as SkillInfo[];
      } else {
        skills.value = [];
      }
    } catch (e: any) {
      skills.value = [];
    }
  }

  async function loadWorkspaceTree() {
    if (!workspacePath.value) return;
    try {
      const res = await api.nativeGetWorkspaceTree(workspacePath.value);
      if (res.ok) {
        workspaceTree.value = (res.tree || []) as FileTreeNode[];
      }
    } catch (e: any) {
      showToastMsg('加载文件树失败：' + String(e?.message || e));
    }
  }

  async function getFilePreview(filePath: string) {
    try {
      const res = await api.nativeGetFilePreview(filePath);
      if (res.ok) {
        const name = fileNameFromPath(filePath);
        setPreviewFile({
          name,
          meta: '文本文件',
          icon: '📄',
          content: String(res.preview ?? '（空文件）'),
          path: filePath,
        });
      } else {
        showToastMsg('读取文件失败：' + String(res.error || ''));
      }
    } catch (e: any) {
      showToastMsg('读取文件失败：' + String(e?.message || e));
    }
  }

  async function createSession() {
    isLoading.value = true;
    try {
      currentSession.value = null;
      transcript.value = [];
      const fallbackWorkspace = String(
        workspacePath.value ||
        appConfig.value?.native?.defaultWorkspace ||
        ''
      ).trim();
      const res = await api.nativeCreateSession(fallbackWorkspace, undefined, undefined);
      if (res.ok && res.ref) {
        currentSession.value = res.ref as SessionRef;
        openRightPanel();
        setActiveRtab('task');
        await loadTranscript();
        await loadWorkspaceTree();
        await loadSkills();
      } else {
        showToastMsg('创建会话失败：' + String(res.error || ''));
      }
    } catch (e: any) {
      showToastMsg('创建会话失败：' + String(e?.message || e));
    } finally {
      isLoading.value = false;
    }
  }

  function startDraftSession() {
    currentSession.value = null;
    transcript.value = [];
    workspaceTree.value = [];
    contextUsedTokens.value = 0;
    contextUsed.value = 0;
    isLoading.value = false;
    isGenerating.value = false;
    openRightPanel();
    setActiveRtab('task');
  }

  async function openSession(session: SessionRef) {
    isLoading.value = true;
    try {
      // 优先用 sessionFile（便于后端做真实文件路径校验），为空则用 sessionId
      const res = await api.nativeOpenSession(session.sessionFile || session.sessionId);
      if (res.ok && res.ref) {
        currentSession.value = res.ref as SessionRef;
        openRightPanel();
        setActiveRtab('task');
        await loadTranscript();
        await loadWorkspaceTree();
        await loadSkills();
      } else {
        showToastMsg('打开会话失败：' + String(res.error || ''));
      }
    } catch (e: any) {
      showToastMsg('打开会话失败：' + String(e?.message || e));
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteSession(sessionId: string) {
    if (!sessionId) return false;
    try {
      const res = await api.nativeDeleteSession(sessionId);
      if (res.ok) {
        sessions.value = sessions.value.filter((s) => s.sessionId !== sessionId);
        if (currentSession.value?.sessionId === sessionId) {
          currentSession.value = null;
          transcript.value = [];
          workspaceTree.value = [];
          contextUsedTokens.value = 0;
          contextUsed.value = 0;
        }
        showToastMsg('会话已删除');
        return true;
      }
      showToastMsg('删除会话失败：' + String(res.error || ''));
      return false;
    } catch (e: any) {
      showToastMsg('删除会话失败：' + String(e?.message || e));
      return false;
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim()) return;
    if (!currentSession.value) {
      await createSession();
    }
    if (!currentSession.value) return;
    isGenerating.value = true;
    try {
      const input: UserMessageInput = { text };
      if (currentAgent.value?.id && currentAgent.value.id !== 'simple') {
        input.selectedAgentId = currentAgent.value.id;
      }
      const res = await api.nativeSendMessage(currentSession.value.sessionId, input);
      if (res.ok) {
        await loadTranscript();
        await loadSessions();
        // 找到刚发送的 user 条目，检查其后是否有模型回复；没有则提示检查凭证
        const userIdx = (() => {
          for (let i = transcript.value.length - 1; i >= 0; i--) {
            const t = transcript.value[i];
            if (t.type === 'user' && t.content === text) return i;
          }
          return -1;
        })();
        if (userIdx >= 0) {
          const hasResponse = transcript.value.slice(userIdx + 1).some((t) =>
            t.type === 'assistant' || t.type === 'tool' || t.type === 'error'
          );
          if (!hasResponse) {
            showToastMsg('模型未返回内容，请检查 API Key 与模型配置（当前可能 401/鉴权失败）');
          }
        }
      } else {
        showToastMsg('发送失败：' + String(res.error || ''));
      }
    } catch (e: any) {
      showToastMsg('发送失败：' + String(e?.message || e));
    } finally {
      isGenerating.value = false;
    }
  }

  async function invokeSkill(skillName: string, args?: string) {
    if (!currentSession.value) {
      await createSession();
    }
    if (!currentSession.value) return;
    isGenerating.value = true;
    try {
      const res = await api.nativeInvokeSkill(currentSession.value.sessionId, skillName, args);
      if (res.ok) {
        await loadTranscript();
        await loadSessions();
      } else {
        showToastMsg('调用技能失败：' + String(res.error || ''));
      }
    } catch (e: any) {
      showToastMsg('调用技能失败：' + String(e?.message || e));
    } finally {
      isGenerating.value = false;
    }
  }

  function updateContextUsage() {
    let total = 0;
    for (const t of transcript.value) {
      total += (t.content?.length || 0);
    }
    contextUsedTokens.value = Math.min(CTX_MAX, Math.round(total / 4));
    contextUsed.value = pct.value;
  }

  function startNativeListener() {
    try {
      api.onNativeSessionEvent(async (payload: { sessionId: string; event: any }) => {
        const { sessionId, event } = payload;
        if (sessionId === currentSession.value?.sessionId) {
          if (event?.type === 'entry_appended' || event?.type === 'acp_update') {
            await loadTranscript();
            loadWorkspaceTree();

            // plan / plan_update 到达时，自动展开右侧任务面板并聚焦任务摘要
            if (event?.type === 'acp_update' && (event?.subtype === 'plan' || event?.subtype === 'plan_update')) {
              if (todos.value.length && !isRightPanelOpen.value) {
                openRightPanel();
                setActiveRtab('task');
              }
            }
          }
          if (event?.type === 'session_info_update') {
            loadSessions();
          }
        }
        if (event?.type === 'session_info_update') {
          loadSessions();
        }
      });
    } catch (e: any) {
      showToastMsg('监听会话事件失败：' + String(e?.message || e));
    }
  }

  async function initApp() {
    await loadAppConfig();
    await initDriver();
    await loadWorkspaceTree();
    await loadSessions();
    startNativeListener();
  }

  return {
    // state
    theme,
    isRightPanelOpen,
    isRightPanelFullscreen,
    activeRtab,
    previewFile,
    settingsVisible,
    newProjectVisible,
    activeProject,
    currentAgent,
    currentPermission,
    currentProject,
    workspaceHistory,
    contextUsed,
    showToast,
    toastMessage,
    appConfig,
    workspacePath,
    sessions,
    currentSession,
    transcript,
    workspaceTree,
    isLoading,
    isGenerating,
    driverHealth,
    skills,
    // computed
    hasMessages,
    pct,
    todos,
    contextFiles,
    rightPanelFiles,
    projects,
    activeTask,
    // actions
    toggleTheme,
    setTheme,
    openRightPanel,
    closeRightPanel,
    toggleRightPanel,
    toggleRightPanelFullscreen,
    setActiveRtab,
    setPreviewFile,
    showToastMsg,
    setActiveProject,
    setAgent,
    setPermission,
    selectProject,
    createWorkspaceHistory,
    loadAppConfig,
    initDriver,
    loadSessions,
    loadTranscript,
    loadWorkspaceTree,
    getFilePreview,
    startDraftSession,
    createSession,
    openSession,
    deleteSession,
    sendMessage,
    invokeSkill,
    loadSkills,
    updateContextUsage,
    startNativeListener,
    initApp,
  };
});
