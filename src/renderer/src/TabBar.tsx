import type { ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  /** Tab 种类，影响 icon 显示 */
  kind: 'session' | 'file' | 'market';
  /** 会话 kind=session 时的智能体图标 emoji（可选） */
  agentEmoji?: string;
  /** 会话 kind=session 时的智能体名（可选，显示在 label 前的小字标签） */
  agentName?: string;
}

interface TabBarProps {
  tabs: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, activeId, onSelect, onClose }: TabBarProps): ReactNode {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-native-border bg-native-panel h-9 overflow-x-auto">
      {tabs.map((tab) => {
        const prefixIcon = (() => {
          if (tab.agentEmoji) return <span className="text-[12px] leading-none">{tab.agentEmoji}</span>;
          if (tab.kind === 'file') return <span className="text-[11px] leading-none text-neutral-400">📄</span>;
          if (tab.kind === 'market') return <span className="text-[11px] leading-none text-violet-300">🧩</span>;
          return <span className="text-[11px] leading-none text-neutral-400">💬</span>;
        })();
        return (
          <div
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`group flex items-center gap-2 px-3 py-1.5 text-xs border-r border-native-border cursor-pointer whitespace-nowrap select-none ${
              tab.id === activeId
                ? 'bg-native-bg text-white border-t-2 border-t-blue-500'
                : 'text-native-muted hover:bg-white/5'
            }`}
          >
            <span className="shrink-0">{prefixIcon}</span>
            {tab.agentName ? (
              <span className="shrink-0 inline-flex items-center text-[10px] text-violet-300/90 bg-violet-500/10 border border-violet-500/20 rounded px-1 py-0.5 mr-0.5">
                {tab.agentName}
              </span>
            ) : null}
            <span className="truncate max-w-[160px]" title={tab.label}>
              {tab.label}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="text-[12px] leading-none opacity-60 group-hover:opacity-100 hover:text-red-400"
              title="关闭"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
