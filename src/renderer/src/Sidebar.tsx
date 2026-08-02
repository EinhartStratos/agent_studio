import type { ReactNode } from 'react';
import type { DriverHealth, SessionRef } from './types';

interface SidebarProps {
  sessions: SessionRef[];
  current: SessionRef | null;
  health: DriverHealth | null;
  workspace: string;
  activeView: 'sessions' | 'market';
  onWorkspaceChange: (value: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onSelect: (ref: SessionRef) => void;
  onOpenMarket: () => void;
  onOpenSessions: () => void;
}

export function Sidebar({
  sessions,
  current,
  health,
  workspace,
  activeView,
  onWorkspaceChange,
  onRefresh,
  onCreate,
  onSelect,
  onOpenMarket,
  onOpenSessions,
}: SidebarProps): ReactNode {
  const ready = health?.ok && health.runtimeReady;
  const navItem = (key: 'sessions' | 'market', icon: string, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
        activeView === key
          ? 'bg-blue-600/25 text-white border border-blue-500/30'
          : 'text-neutral-300 hover:bg-white/5 border border-transparent'
      }`}
    >
      <span className="w-4 text-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );

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

      <div className="px-3 pt-2 pb-1 border-b border-native-border space-y-1">
        {navItem('sessions', '💬', '会话列表', onOpenSessions)}
        {navItem('market', '🧩', '智能体市场', onOpenMarket)}
      </div>

      <div className="flex-1 overflow-auto p-2">
        {activeView === 'sessions' ? (
          <>
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
          </>
        ) : (
          <div className="px-2 pt-3 text-xs text-neutral-400 leading-relaxed">
            右侧为智能体市场卡片列表，选择您需要的智能体一键创建专属对话。
          </div>
        )}
      </div>
    </div>
  );
}
