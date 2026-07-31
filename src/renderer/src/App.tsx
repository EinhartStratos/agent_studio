import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { Composer } from './Composer';
import { FilePreview } from './FilePreview';
import { FileTree } from './FileTree';
import { Sidebar } from './Sidebar';
import { Timeline } from './Timeline';
import type { DriverHealth, FileTreeNode, ModelInfo, SessionRef, SkillInfo, TranscriptItem } from './types';

const DEFAULT_WORKSPACE = 'C:\\temp\\agent-studio-workspace';

interface ApiResult<T> {
  ok: boolean;
  error?: string;
}

export function App(): ReactNode {
  const [health, setHealth] = useState<DriverHealth | null>(null);
  const [sessions, setSessions] = useState<SessionRef[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionRef | null>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string>(DEFAULT_WORKSPACE);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [preview, setPreview] = useState<string>('');
  const [diff, setDiff] = useState<string>('');
  const [initialized, setInitialized] = useState(false);
  const [sending, setSending] = useState(false);
  const [rightWidth, setRightWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | undefined>();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const currentSessionRef = useRef<SessionRef | null>(null);
  const refreshTranscriptRef = useRef<(sessionId?: string) => Promise<void>>(async () => {});
  const loadTreeRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    api.onNativeSessionEvent((payload) => {
      if (payload.sessionId === currentSessionRef.current?.sessionId) {
        refreshTranscriptRef.current(payload.sessionId);
        const event = (payload as any).event;
        if (event && (event.type === 'agent_end' || event.type === 'agent_settled' || event.type === 'tool_execution')) {
          loadTreeRef.current();
        }
      }
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    const result = (await api.nativeListSessions(workspacePath)) as {
      ok: boolean;
      sessions?: SessionRef[];
      error?: string;
    };
    if (result.ok && result.sessions) {
      setSessions(result.sessions);
    }
  }, [workspacePath]);

  const loadTree = useCallback(async () => {
    const result = (await api.nativeGetWorkspaceTree(workspacePath)) as {
      ok: boolean;
      tree?: FileTreeNode[];
      error?: string;
    };
    if (result.ok && result.tree) {
      setTree(result.tree);
    }
  }, [workspacePath]);

  const refreshTranscript = useCallback(async (sessionId?: string) => {
    const id = sessionId ?? currentSessionRef.current?.sessionId;
    if (!id) return;
    const result = (await api.nativeGetTranscript(id)) as {
      ok: boolean;
      transcript?: TranscriptItem[];
      error?: string;
    };
    if (result.ok && result.transcript) {
      setTranscript(result.transcript);
    }
  }, []);

  const refreshSkills = useCallback(async (sessionId?: string) => {
    const id = sessionId ?? currentSessionRef.current?.sessionId;
    if (!id) {
      setSkills([]);
      return;
    }
    const result = (await api.nativeListSkills(id)) as {
      ok: boolean;
      skills?: SkillInfo[];
      error?: string;
    };
    if (result.ok && result.skills) {
      setSkills(result.skills);
    } else {
      setSkills([]);
    }
  }, []);

  useEffect(() => {
    refreshTranscriptRef.current = refreshTranscript;
    loadTreeRef.current = loadTree;
  });

  const refreshModels = useCallback(async () => {
    const result = (await api.nativeListModels()) as {
      ok: boolean;
      models?: ModelInfo[];
      error?: string;
    };
    if (result.ok && result.models) {
      setModels(result.models);
      const current = result.models.find(
        (m) => health?.currentModel && health.currentModel.includes(m.modelId) && health.currentModel.includes(m.providerId)
      );
      if (current) setSelectedModel(current);
      else if (result.models.length > 0) setSelectedModel(result.models[0]);
    }
  }, [health]);

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
    await refreshSkills();
  }, [refreshSessions, loadTree, refreshModels, refreshSkills]);

  const createSession = useCallback(async () => {
    const result = (await api.nativeCreateSession(workspacePath)) as {
      ok: boolean;
      ref?: SessionRef;
      error?: string;
    };
    if (result.ok && result.ref) {
      setSessions((prev) => [...prev, result.ref!]);
      setCurrentSession(result.ref);
      setTranscript([]);
      await refreshSkills(result.ref.sessionId);
    }
  }, [workspacePath, refreshSkills]);

  const openSession = useCallback(async (ref: SessionRef) => {
    const result = (await api.nativeOpenSession(ref.sessionFile)) as {
      ok: boolean;
      ref?: SessionRef;
      error?: string;
    };
    if (result.ok && result.ref) {
      setCurrentSession(result.ref);
      await refreshTranscript(result.ref.sessionId);
      await refreshSkills(result.ref.sessionId);
    }
  }, [refreshTranscript, refreshSkills]);

  const sendMessage = useCallback(
    async (text: string) => {
      const id = currentSessionRef.current?.sessionId;
      if (!id) return;
      setSending(true);
      try {
        const result = (await api.nativeSendMessage(id, { text })) as { ok: boolean; error?: string };
        if (!result.ok) {
          console.error('发送失败:', result.error);
        }
      } finally {
        setSending(false);
        await refreshTranscript(id);
        await loadTree();
        await refreshSessions();
      }
    },
    [refreshTranscript, loadTree, refreshSessions]
  );

  const handleModelChange = useCallback(
    async (model: ModelInfo) => {
      const id = currentSessionRef.current?.sessionId;
      if (!id) {
        setSelectedModel(model);
        return;
      }
      setSending(true);
      try {
        const result = (await api.nativeSetModel(id, model.providerId, model.modelId)) as {
          ok: boolean;
          health?: DriverHealth;
          error?: string;
        };
        if (result.ok && result.health) {
          setHealth(result.health);
          setSelectedModel(model);
        } else {
          console.error('切换模型失败:', result.error);
        }
      } finally {
        setSending(false);
      }
    },
    []
  );

  useEffect(() => {
    init();
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

  const previewFile = useCallback(async (filePath: string) => {
    setSelectedFile(filePath);
    const result = (await api.nativeGetFilePreview(filePath)) as {
      ok: boolean;
      preview?: string;
      error?: string;
    };
    setPreview(result.ok ? result.preview ?? '' : result.error ?? '预览失败');
    setDiff('');
  }, []);

  const diffFile = useCallback(async (filePath: string) => {
    setSelectedFile(filePath);
    const oldContent = 'hello world\n';
    const newContent = 'hello world\nnew line\n';
    const result = (await api.nativeGetDiff(filePath, oldContent, newContent)) as {
      ok: boolean;
      diff?: string;
      error?: string;
    };
    setDiff(result.ok ? result.diff ?? '' : result.error ?? 'Diff 失败');
    setPreview('');
  }, []);

  return (
    <div className="flex h-screen w-screen bg-native-bg text-native-text overflow-hidden">
      <Sidebar
        sessions={sessions}
        current={currentSession}
        health={health}
        workspace={workspacePath}
        onWorkspaceChange={setWorkspacePath}
        onRefresh={refresh}
        onCreate={createSession}
        onSelect={openSession}
      />

      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-native-border bg-native-panel">
          <div className="text-sm font-medium">{currentSession?.name ?? '未选择会话'}</div>
          <div className="text-xs text-native-muted">
            {health?.runtimeReady ? `模型: ${health.currentModel ?? '未知'}` : '驱动未就绪'}
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="flex flex-1 flex-col min-w-0">
            <Timeline items={transcript} onFileClick={previewFile} />
            <Composer
              onSend={sendMessage}
              models={models}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              sending={sending}
              disabled={!currentSession}
              skills={skills}
            />
          </div>

          <div
            className={`w-1 bg-native-border hover:bg-blue-500 cursor-col-resize ${isResizing ? 'bg-blue-500' : ''}`}
            onMouseDown={startResize}
          />

          <div
            className="border-l border-native-border flex flex-col min-w-0 bg-native-panel"
            style={{ width: rightWidth }}
          >
            <FileTree nodes={tree} onSelect={previewFile} />
            <FilePreview
              file={selectedFile}
              preview={preview}
              diff={diff}
              onPreview={() => previewFile(selectedFile)}
              onDiff={() => diffFile(selectedFile)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
