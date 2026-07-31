import type { ReactNode } from 'react';
import type { DriverHealth, SessionRef } from './types';

interface SidebarProps {
  sessions: SessionRef[];
  current: SessionRef | null;
  health: DriverHealth | null;
  workspace: string;
  onWorkspaceChange: (value: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onSelect: (ref: SessionRef) => void;
}

export function Sidebar({
  sessions,
  current,
  health,
  workspace,
  onWorkspaceChange,
  onRefresh,
  onCreate,
  onSelect,
}: SidebarProps): ReactNode {
  const ready = health?.ok && health.runtimeReady;

  return (
    <div className="w-64 flex flex-col border-r border-native-border bg-native-panel">
      <div className="p-4 border-b border-native-border">
        <h1 className="text-lg font-semibold text-white mb-1">Agent Studio</h1>
        <div className={`text-xs ${ready ? 'text-green-400' : 'text-red-400'}`}>
          {ready ? '驱动已就绪' : health?.error ?? '未初始化'}
        </div>
        {health?.currentModel && <div className="text-xs text-native-muted mt-1">{health.currentModel}</div>}
      </div>

      <div className="p-3 border-b border-native-border space-y-2">
        <input
          type="text"
          value={workspace}
          onChange={(e) => onWorkspaceChange(e.target.value)}
          placeholder="工作区路径"
          className="w-full text-xs px-2 py-1.5 rounded bg-black/30 border border-native-border focus:outline-none focus:border-native-accent"
        />
        <div className="flex gap-2">
          <button
            onClick={onRefresh}
            className="flex-1 text-xs px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            初始化 / 刷新
          </button>
          <button
            onClick={onCreate}
            disabled={!ready}
            className="flex-1 text-xs px-2 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            新建会话
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <div className="text-xs text-native-muted uppercase tracking-wide mb-2 px-2">会话列表</div>
        {sessions.length === 0 && <div className="text-xs text-native-muted px-2">暂无会话</div>}
        <ul className="space-y-1">
          {sessions.map((s) => (
            <li
              key={s.sessionId}
              onClick={() => onSelect(s)}
              className={`px-2 py-1.5 rounded text-sm cursor-pointer truncate ${
                s.sessionId === current?.sessionId
                  ? 'bg-blue-600/30 text-white'
                  : 'hover:bg-white/5 text-native-text'
              }`}
              title={s.sessionFile}
            >
              {s.name ?? s.sessionId.slice(0, 8)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
