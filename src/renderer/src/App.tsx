import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { api } from './api';
import { AgentMarket } from './AgentMarket';
import { Composer } from './Composer';
import { FilePreview } from './FilePreview';
import { FileTree } from './FileTree';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { Timeline } from './Timeline';
import type { AgentTemplate, DriverHealth, FileTreeNode, ModelInfo, SessionRef, SkillInfo, TranscriptItem } from './types';

const DEFAULT_WORKSPACE = '/Users/apple/Documents/work_two/temp_test';

const BUILTIN_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'requirement-splitter',
    name: '需求拆解大师',
    emoji: '🧩',
    description: '帮您把模糊的产品需求自动拆成「核心目标 / 功能模块 / 任务清单 / 验收标准 / 风险点」5 段结构化输出。',
    presetSkillNames: [],
  },
];
function resolveAgentTemplate(id?: string): AgentTemplate | undefined {
  if (!id) return undefined;
  return BUILTIN_AGENT_TEMPLATES.find((t) => t.id === id);
}

class ErrorBoundary extends Component<
  { children: ReactNode; fallbackTitle?: string; onError?: (e: Error) => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallbackTitle?: string; onError?: (e: Error) => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error } {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught error:', error, info);
    try { this.props.onError?.(error); } catch { /* ignore */ }
  }
  render(): ReactNode {
    if (this.state.hasError) {
      const msg = this.state.error?.message ?? String(this.state.error);
      const stack = this.state.error?.stack ?? '';
      return (
        <div className="flex-1 flex items-start justify-center p-4">
          <div className="max-w-2xl w-full rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm">
            <div className="font-semibold text-rose-300 mb-1">
              ⚠️ {this.props.fallbackTitle ?? '界面渲染异常（已被安全捕获，不会白屏）'}
            </div>
            <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-rose-200 bg-black/30 rounded p-2 max-h-64 overflow-auto">
{msg}
{stack ? `\n--- stack ---\n${stack.slice(0, 800)}` : ''}
            </div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-3 text-[11px] text-rose-200 hover:text-white underline"
            >
              尝试重新渲染
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 会话标签页：包含自己的转录、模型和 skill 状态 */
interface SessionTab {
  id: string;
  type: 'session';
  ref: SessionRef;
  transcript: TranscriptItem[];
  skills: SkillInfo[];
  selectedModel?: ModelInfo;
  sending: boolean;
  agentTemplateId?: string;
}

/** 文件预览标签页 */
interface FileTab {
  id: string;
  type: 'file';
  path: string;
  fileName: string;
  preview: string;
  diff: string;
}

/** 智能体市场视图 tab（不是会话也不是文件，占据右侧主视图） */
interface MarketViewTab {
  id: string;
  type: 'market';
}

type Tab = SessionTab | FileTab | MarketViewTab;

export function App(): ReactNode {
  const [health, setHealth] = useState<DriverHealth | null>(null);
  const [sessions, setSessions] = useState<SessionRef[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [workspacePath, setWorkspacePath] = useState<string>(DEFAULT_WORKSPACE);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [rightWidth, setRightWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [toast, setToast] = useState<{ message: string; level: 'info' | 'warn' | 'error' | 'success'; key: number } | null>(null);
  const MARKET_TAB_ID = 'view:market';

  const openMarketView = useCallback(() => {
    setTabs((prev) => {
      const exist = prev.find((t) => t.id === MARKET_TAB_ID);
      if (exist) return prev;
      return [...prev, { id: MARKET_TAB_ID, type: 'market' } as MarketViewTab];
    });
    setActiveTabId(MARKET_TAB_ID);
  }, [MARKET_TAB_ID]);
  const openSessionsView = useCallback(() => {
    // 切到第一个会话 tab：① 优先找非 market 的会话/文件 tab；② 没有就把 activeTabId 设为 ''（中间内容区留空），
    // 但**绝对不能保留 MARKET_TAB_ID**，否则 Sidebar 的 activeView 会因为 activeTabId 还是 market 而回滚，导致用户感觉『切不动』。
    let fallbackActiveId: string = '';
    setTabs((prev) => {
      const firstSessionOrFile = prev.find((t) => t.type !== 'market') ?? null;
      fallbackActiveId = firstSessionOrFile?.id ?? '';
      const filtered = prev.filter((t) => t.id !== MARKET_TAB_ID);
      return filtered.length > 0 || firstSessionOrFile ? filtered : filtered;
    });
    // 在下一帧里同步 activeTabId（避免 setTabs 内的 setState 和外层顺序不确定）
    queueMicrotask(() => {
      setActiveTabId(fallbackActiveId);
    });
  }, [MARKET_TAB_ID]);
  // sidebarActiveView：只要当前 activeTabId 不是 market Tab（包括空字符串），就显示为 sessions 高亮——
  // 这样 openSessionsView 即使当前没有会话 Tab，Segmented 也能稳定停留在「会话列表」选中态，不再『回滚亮市场』
  const sidebarActiveView: 'sessions' | 'market' = activeTabId === MARKET_TAB_ID ? 'market' : 'sessions';

  const tabsRef = useRef<Tab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // 通过 health.currentModel（形如 "provider / modelId"）匹配模型对象
  const resolveModelFromHealth = useCallback(
    (list: ModelInfo[], current?: string): ModelInfo | undefined => {
      if (!current) return list[0];
      return list.find((m) => current.includes(m.modelId) && current.includes(m.providerId)) ?? list[0];
    },
    []
  );

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);
  const activeSessionTab = activeTab?.type === 'session' ? activeTab : null;
  const activeFileTab = activeTab?.type === 'file' ? activeTab : null;

  const refreshSessions = useCallback(async () => {
    const result = (await api.nativeListSessions(workspacePath)) as {
      ok: boolean;
      sessions?: SessionRef[];
      error?: string;
    };
    if (result.ok && result.sessions) {
      setSessions(result.sessions);
      // 更新已打开会话标签的 ref，使左侧列表和标签标题同步新名称
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.type !== 'session') return tab;
          const updated = result.sessions!.find((s) => s.sessionId === tab.ref.sessionId);
          return updated ? { ...tab, ref: updated } : tab;
        })
      );
    }
  }, [workspacePath]);

  const loadTree = useCallback(async () => {
    const result = (await api.nativeGetWorkspaceTree(workspacePath)) as {
      ok: boolean;
      tree?: FileTreeNode[];
      error?: string;
    };
    if (result.ok && result.tree) setTree(result.tree);
  }, [workspacePath]);

  const refreshTranscript = useCallback(async (sessionId?: string) => {
    const id = sessionId;
    if (!id) return;
    const result = (await api.nativeGetTranscript(id)) as {
      ok: boolean;
      transcript?: TranscriptItem[];
      error?: string;
    };
    if (result.ok && result.transcript) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.type === 'session' && tab.ref.sessionId === id
            ? { ...tab, transcript: result.transcript! }
            : tab
        )
      );
    }
  }, []);

  const refreshSkills = useCallback(async (sessionId?: string) => {
    const id = sessionId;
    if (!id) {
      setTabs((prev) => prev.map((tab) => (tab.type === 'session' ? { ...tab, skills: [] } : tab)));
      return;
    }
    const result = (await api.nativeListSkills(id)) as {
      ok: boolean;
      skills?: SkillInfo[];
      error?: string;
    };
    setTabs((prev) =>
      prev.map((tab) =>
        tab.type === 'session' && tab.ref.sessionId === id ? { ...tab, skills: result.skills ?? [] } : tab
      )
    );
  }, []);

  const refreshModels = useCallback(async () => {
    const result = (await api.nativeListModels()) as {
      ok: boolean;
      models?: ModelInfo[];
      error?: string;
    };
    if (result.ok && result.models) {
      setModels(result.models);
      // 给所有还没有选择模型的会话标签补上一个默认模型
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.type !== 'session') return tab;
          return { ...tab, selectedModel: tab.selectedModel ?? resolveModelFromHealth(result.models!, health?.currentModel) };
        })
      );
    }
  }, [health, resolveModelFromHealth]);

  const init = useCallback(async () => {
    const result = (await api.nativeInitDriver()) as { ok: boolean; health?: DriverHealth; error?: string };
    if (result.ok && result.health) {
      setHealth(result.health);
      setInitialized(true);
      await refreshSessions();
      await loadTree();
      await refreshModels();
    } else {
      setHealth({ ok: false, runtimeReady: false, error: result.error ?? '初始化失败' });
    }
  }, [refreshSessions, loadTree, refreshModels]);

  const showToast = useCallback((message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    const key = Date.now() + Math.random();
    setToast({ message, level, key });
    setTimeout(() => {
      setToast((t) => (t && t.key === key ? null : t));
    }, 2600);
  }, []);

  const useAgentAndCreateSession = useCallback(async (agent: AgentTemplate) => {
    const result = (await api.nativeCreateSession(workspacePath, agent.name, agent.id)) as {
      ok: boolean;
      ref?: SessionRef;
      error?: string;
    };
    if (!result.ok || !result.ref) {
      showToast(`创建智能体会话失败：${result.error ?? '未知错误'}`, 'error');
      return;
    }
    const ref = result.ref;
    setSessions((prev) => {
      if (prev.some((s) => s.sessionId === ref.sessionId)) return prev;
      return [...prev, ref];
    });
    const tab: SessionTab = {
      id: `session:${ref.sessionId}`,
      type: 'session',
      ref,
      transcript: [],
      skills: [],
      selectedModel: resolveModelFromHealth(models, health?.currentModel),
      sending: false,
      agentTemplateId: agent.id,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    showToast(`已使用智能体「${agent.name}」创建新对话`, 'success');
    await refreshSkills(ref.sessionId);
  }, [workspacePath, models, health, resolveModelFromHealth, refreshSkills, showToast]);

  const refresh = useCallback(async () => {
    await refreshSessions();
    await loadTree();
    await refreshModels();
    if (activeSessionTab) await refreshSkills(activeSessionTab.ref.sessionId);
  }, [refreshSessions, loadTree, refreshModels, refreshSkills, activeSessionTab]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    init();
  }, []);

  const createSession = useCallback(async () => {
    const result = (await api.nativeCreateSession(workspacePath)) as {
      ok: boolean;
      ref?: SessionRef;
      error?: string;
    };
    if (result.ok && result.ref) {
      setSessions((prev) => [...prev, result.ref!]);
      const tab: SessionTab = {
        id: `session:${result.ref!.sessionId}`,
        type: 'session',
        ref: result.ref!,
        transcript: [],
        skills: [],
        selectedModel: resolveModelFromHealth(models, health?.currentModel),
        sending: false,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      await refreshSkills(result.ref!.sessionId);
    }
  }, [workspacePath, models, health, resolveModelFromHealth, refreshSkills]);

  const openSession = useCallback(
    async (ref: SessionRef) => {
      const existing = tabsRef.current.find(
        (t) => t.type === 'session' && t.ref.sessionId === ref.sessionId
      );
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      const result = (await api.nativeOpenSession(ref.sessionFile)) as {
        ok: boolean;
        ref?: SessionRef;
        error?: string;
      };
      if (result.ok && result.ref) {
        const tab: SessionTab = {
          id: `session:${result.ref!.sessionId}`,
          type: 'session',
          ref: result.ref!,
          transcript: [],
          skills: [],
          selectedModel: resolveModelFromHealth(models, health?.currentModel),
          sending: false,
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
        await refreshTranscript(result.ref!.sessionId);
        await refreshSkills(result.ref!.sessionId);
      } else {
          showToast(`打开会话失败：${result.error ?? '未知错误'}`, 'error');
      }
    },
    [models, health, resolveModelFromHealth, refreshTranscript, refreshSkills, showToast]
  );

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const idx = prev.findIndex((t) => t.id === id);
        const fallback = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
        setActiveTabId(fallback?.id ?? '');
      }
      return next;
    });
  }, [activeTabId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeSessionTab) return;
      const id = activeSessionTab.ref.sessionId;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.type === 'session' && tab.ref.sessionId === id ? { ...tab, sending: true } : tab
        )
      );
      try {
        const result = (await api.nativeSendMessage(id, { text })) as { ok: boolean; error?: string };
        if (!result.ok) console.error('发送失败:', result.error);
      } finally {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.type === 'session' && tab.ref.sessionId === id ? { ...tab, sending: false } : tab
          )
        );
        await refreshTranscript(id);
        await loadTree();
        await refreshSessions();
      }
    },
    [activeSessionTab, refreshTranscript, loadTree, refreshSessions]
  );

  const handleModelChange = useCallback(
    async (model: ModelInfo) => {
      if (!activeSessionTab) return;
      const id = activeSessionTab.ref.sessionId;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.type === 'session' && tab.ref.sessionId === id ? { ...tab, selectedModel: model } : tab
        )
      );
      const result = (await api.nativeSetModel(id, model.providerId, model.modelId)) as {
        ok: boolean;
        health?: DriverHealth;
        error?: string;
      };
      if (result.ok && result.health) setHealth(result.health);
      else console.error('切换模型失败:', result.error);
    },
    [activeSessionTab]
  );

  const previewFile = useCallback(async (filePath: string) => {
    const existing = tabsRef.current.find(
      (t) => t.type === 'file' && t.path === filePath && !t.diff
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const result = (await api.nativeGetFilePreview(filePath)) as {
      ok: boolean;
      preview?: string;
      error?: string;
    };
    // ⬇⬇⬇ 关键修复：预览失败（例如 File not found / Not a file）
    // → 不 push 这个 tab，也不切 activeTabId，避免「会话 tab 被覆盖、UI 看起来全没了」
    if (!result.ok) {
      try { await api.nativeClipboardCopy(filePath); } catch { /* ignore */ }
      showToast(`预览失败：${result.error ?? '未知错误'}，已复制路径到剪贴板`, 'error');
      return;
    }
    const tab: FileTab = {
      id: `file:${filePath}`,
      type: 'file',
      path: filePath,
      fileName,
      preview: result.preview ?? '',
      diff: '',
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [showToast]);

  /** 用户点路径想预览文件时的保护：
   * 1) 先查 nativePathExists 确认是本机真实存在的文件才开 tab；
   * 2) 不存在的路径直接复制到剪贴板 + toast 提示（极大概率是 pi ls 输出里的「工作区虚拟路径」/相对路径，不是用户本地磁盘上的路径）；
   * 3) 就算硬开 tab，nativeGetFilePreview 返回 !ok 也自动撤销切 tab，保证会话视图不会被空的预览 tab 覆盖（用户这次看到「布局全没了」的根因）。
   */
  const safeHandleFileClick = useCallback(
    async (rawPath: string) => {
      const p = (rawPath ?? '').trim();
      if (!p) return;
      try {
        const existsRes = (await api.nativePathExists(p)) as {
          ok: boolean;
          exists?: boolean;
          isFile?: boolean;
          error?: string;
        };
        const isRealFile = existsRes.ok && !!existsRes.exists && !!existsRes.isFile;
        if (!isRealFile) {
          // ⬇⬇⬇ 关键：不是本地真实文件（多半是 pi 执行 ls 时打印的工作区路径/相对路径）
          // → 不切 file tab 覆盖会话视图，只复制路径给用户
          await api.nativeClipboardCopy(p);
          showToast(
            existsRes.exists ? '该路径是文件夹，无法预览，已复制路径到剪贴板' : '该路径并非本机上的真实文件（可能是 ls 输出的工作区路径），已复制路径到剪贴板',
            'warn'
          );
          return;
        }
      } catch {
        /* ignore, fallback to preview */
      }
      // 真实存在的文件 → 切到预览 tab
      await previewFile(p);
    },
    [previewFile, showToast]
  );

  const diffFile = useCallback(async (filePath: string) => {
    const existing = tabsRef.current.find(
      (t) => t.type === 'file' && t.path === filePath && t.diff
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const fileName = `${filePath.split(/[\\/]/).pop() ?? filePath} (diff)`;
    const oldContent = 'hello world\n';
    const newContent = 'hello world\nnew line\n';
    const result = (await api.nativeGetDiff(filePath, oldContent, newContent)) as {
      ok: boolean;
      diff?: string;
      error?: string;
    };
    const tab: FileTab = {
      id: `file:${filePath}:diff`,
      type: 'file',
      path: filePath,
      fileName,
      preview: '',
      diff: result.ok ? result.diff ?? '' : result.error ?? 'Diff 失败',
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  // 会话事件处理
  const refreshTranscriptRef = useRef(refreshTranscript);
  const refreshSkillsRef = useRef(refreshSkills);
  const loadTreeRef = useRef(loadTree);
  const refreshSessionsRef = useRef(refreshSessions);
  useEffect(() => {
    refreshTranscriptRef.current = refreshTranscript;
    refreshSkillsRef.current = refreshSkills;
    loadTreeRef.current = loadTree;
    refreshSessionsRef.current = refreshSessions;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.onNativeSessionEvent((payload) => {
      const id = payload.sessionId;
      const event = (payload as any).event;
      if (!id) return;

      if (event?.type === 'session_renamed') {
        refreshSessionsRef.current();
        return;
      }

      const hasSessionTab = tabsRef.current.some(
        (t) => t.type === 'session' && t.ref.sessionId === id
      );
      if (hasSessionTab) {
        refreshTranscriptRef.current(id);
        if (event && (event.type === 'agent_end' || event.type === 'agent_settled' || event.type === 'tool_execution')) {
          loadTreeRef.current();
        }
        if (event?.type === 'agent_end' || event?.type === 'agent_settled') {
          refreshSkillsRef.current(id);
        }
      } else if (event?.type === 'agent_end' || event?.type === 'agent_settled') {
        // 会话未打开时，也可能修改了工作区文件
        loadTreeRef.current();
      }
    });
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = rightWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      setRightWidth(Math.max(200, Math.min(600, startWidth + delta)));
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightWidth]);

  const tabBarItems = useMemo(
    () =>
      tabs.map((tab) => {
        if (tab.type === 'session') {
          const tmpl = resolveAgentTemplate(tab.agentTemplateId);
          return {
            id: tab.id,
            label: tab.ref.name ?? tab.ref.sessionId.slice(0, 8),
            kind: 'session' as const,
            agentEmoji: tmpl?.emoji,
            agentName: tmpl?.name,
          };
        }
        if (tab.type === 'file') {
          return {
            id: tab.id,
            label: tab.fileName,
            kind: 'file' as const,
          };
        }
        return {
          id: tab.id,
          label: '智能体市场',
          kind: 'market' as const,
        };
      }),
    [tabs]
  );

  const currentSessionRef = activeSessionTab?.ref ?? null;
  const centerTitle = (() => {
    if (activeSessionTab) {
      const tmpl = resolveAgentTemplate(activeSessionTab.agentTemplateId);
      if (tmpl) return `${tmpl.emoji ?? ''} ${tmpl.name} · ${currentSessionRef?.name ?? activeSessionTab.ref.sessionId.slice(0,8)}`.trim();
      return currentSessionRef?.name ?? activeSessionTab.ref.sessionId.slice(0,8);
    }
    if (activeTabId === MARKET_TAB_ID) return '🧩 智能体市场';
    return activeFileTab?.fileName ?? '未选择';
  })();

  return (
    <div className="flex h-screen w-screen bg-native-bg text-native-text overflow-hidden">
      <Sidebar
        sessions={sessions}
        current={currentSessionRef}
        health={health}
        workspace={workspacePath}
        activeView={sidebarActiveView}
        onWorkspaceChange={setWorkspacePath}
        onRefresh={refresh}
        onCreate={createSession}
        onSelect={openSession}
        onOpenMarket={openMarketView}
        onOpenSessions={openSessionsView}
      />

      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-native-border bg-native-panel">
          <div className="text-sm font-medium truncate" title={centerTitle}>
            {centerTitle}
          </div>
          <div className="text-xs text-native-muted">
            {health?.runtimeReady ? `模型: ${health.currentModel ?? '未知'}` : '驱动未就绪'}
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            <TabBar tabs={tabBarItems} activeId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} />

            <div className="flex-1 overflow-hidden relative">
              {activeSessionTab && (
                <div className="flex h-full flex-col">
                  <ErrorBoundary
                    fallbackTitle="会话时间轴渲染异常"
                    onError={(e) => showToast(`渲染错误: ${e.message.slice(0, 80)}`, 'error')}
                  >
                    <Timeline items={activeSessionTab.transcript} onFileClick={safeHandleFileClick} />
                  </ErrorBoundary>
                  <ErrorBoundary
                    fallbackTitle="输入框渲染异常"
                    onError={(e) => showToast(`输入框错误: ${e.message.slice(0, 80)}`, 'error')}
                  >
                    <Composer
                      onSend={sendMessage}
                      models={models}
                      selectedModel={activeSessionTab.selectedModel}
                      onModelChange={handleModelChange}
                      sending={activeSessionTab.sending}
                      disabled={false}
                      skills={activeSessionTab.skills}
                    />
                  </ErrorBoundary>
                </div>
              )}
              {activeFileTab && (
                <ErrorBoundary
                  fallbackTitle="文件预览渲染异常"
                  onError={(e) => showToast(`预览错误: ${e.message.slice(0, 80)}`, 'error')}
                >
                  <FilePreview
                    file={activeFileTab.path}
                    preview={activeFileTab.preview}
                    diff={activeFileTab.diff}
                    onPreview={() => previewFile(activeFileTab.path)}
                    onDiff={() => diffFile(activeFileTab.path)}
                  />
                </ErrorBoundary>
              )}
              {activeTabId === MARKET_TAB_ID && (
                <ErrorBoundary
                  fallbackTitle="智能体市场渲染异常"
                  onError={(e) => showToast(`市场错误: ${e.message.slice(0, 80)}`, 'error')}
                >
                  <AgentMarket onUseAgent={useAgentAndCreateSession} />
                </ErrorBoundary>
              )}
              {!activeTab && (
                <div className="flex h-full items-center justify-center text-sm text-native-muted">
                  点击左侧会话或右侧文件开始
                </div>
              )}

              {/* Toast 顶部提示 */}
              {toast && (
                <div
                  key={toast.key}
                  className={`pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded shadow-lg border text-xs font-medium animate-[fadeIn_.15s_ease-out] ${
                    toast.level === 'warn'
                      ? 'bg-amber-500/90 border-amber-300/50 text-amber-50'
                      : toast.level === 'error'
                      ? 'bg-rose-600/90 border-rose-300/50 text-rose-50'
                      : toast.level === 'success'
                      ? 'bg-emerald-600/90 border-emerald-300/50 text-emerald-50'
                      : 'bg-neutral-800/95 border-neutral-500/50 text-neutral-100'
                  }`}
                >
                  {toast.message}
                </div>
              )}
            </div>
          </div>

          <div
            className={`w-1 bg-native-border hover:bg-blue-500 cursor-col-resize ${isResizing ? 'bg-blue-500' : ''}`}
            onMouseDown={startResize}
          />

          <div
            className="border-l border-native-border flex flex-col min-w-0 bg-native-panel h-full overflow-hidden"
            style={{ width: rightWidth }}
          >
            <FileTree nodes={tree} onSelect={previewFile} selectedPath={activeFileTab?.path} />
          </div>
        </div>
      </div>
    </div>
  );
}
