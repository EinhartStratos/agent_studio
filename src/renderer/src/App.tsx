import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { Composer } from './Composer';
import { FilePreview } from './FilePreview';
import { FileTree } from './FileTree';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { Timeline } from './Timeline';
import type { DriverHealth, FileTreeNode, ModelInfo, SessionRef, SkillInfo, TranscriptItem } from './types';

const DEFAULT_WORKSPACE = 'C:\\temp\\agent-studio-workspace';

/** 会话标签页：包含自己的转录、模型和 skill 状态 */
interface SessionTab {
  id: string;
  type: 'session';
  ref: SessionRef;
  transcript: TranscriptItem[];
  skills: SkillInfo[];
  selectedModel?: ModelInfo;
  sending: boolean;
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

type Tab = SessionTab | FileTab;

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
      }
    },
    [models, health, resolveModelFromHealth, refreshTranscript, refreshSkills]
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
    const tab: FileTab = {
      id: `file:${filePath}`,
      type: 'file',
      path: filePath,
      fileName,
      preview: result.ok ? result.preview ?? '' : result.error ?? '预览失败',
      diff: '',
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

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
      tabs.map((tab) => ({
        id: tab.id,
        label: tab.type === 'session' ? tab.ref.name ?? tab.ref.sessionId.slice(0, 8) : tab.fileName,
      })),
    [tabs]
  );

  const currentSessionRef = activeSessionTab?.ref ?? null;
  const centerTitle = currentSessionRef?.name ?? activeFileTab?.fileName ?? '未选择';

  return (
    <div className="flex h-screen w-screen bg-native-bg text-native-text overflow-hidden">
      <Sidebar
        sessions={sessions}
        current={currentSessionRef}
        health={health}
        workspace={workspacePath}
        onWorkspaceChange={setWorkspacePath}
        onRefresh={refresh}
        onCreate={createSession}
        onSelect={openSession}
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

            <div className="flex-1 overflow-hidden">
              {activeSessionTab && (
                <div className="flex h-full flex-col">
                  <Timeline items={activeSessionTab.transcript} onFileClick={previewFile} />
                  <Composer
                    onSend={sendMessage}
                    models={models}
                    selectedModel={activeSessionTab.selectedModel}
                    onModelChange={handleModelChange}
                    sending={activeSessionTab.sending}
                    disabled={false}
                    skills={activeSessionTab.skills}
                  />
                </div>
              )}
              {activeFileTab && (
                <FilePreview
                  file={activeFileTab.path}
                  preview={activeFileTab.preview}
                  diff={activeFileTab.diff}
                  onPreview={() => previewFile(activeFileTab.path)}
                  onDiff={() => diffFile(activeFileTab.path)}
                />
              )}
              {!activeTab && (
                <div className="flex h-full items-center justify-center text-sm text-native-muted">
                  点击左侧会话或右侧文件开始
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
