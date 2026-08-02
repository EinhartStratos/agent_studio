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

  const prefixIcon = (tab: TabItem) => {
    if (tab.agentEmoji) return <span className="text-[13px] leading-none">{tab.agentEmoji}</span>;
    if (tab.kind === 'file') return <span className="text-[13px] leading-none text-native-muted">📄</span>;
    if (tab.kind === 'market') return <span className="text-[13px] leading-none">🧩</span>;
    return <span className="text-[13px] leading-none text-native-muted">💬</span>;
  };

  return (
    <div
      className="flex items-end gap-1.5 px-4 pt-2 pb-1.5 border-b border-native-border bg-native-panel/70 backdrop-blur-xl overflow-x-auto"
      style={{ minHeight: 44 }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={[
              'group relative flex items-center gap-2 px-3 h-[34px] rounded-t-2xl text-[12.5px] cursor-pointer whitespace-nowrap select-none shrink-0 transition-all duration-150 ease-out',
              isActive
                ? 'bg-native-bg text-native-text shadow-[0_-1px_0_rgba(15,23,42,0.02)] z-[1]'
                : 'text-native-muted hover:text-native-text/90 hover:bg-native-hover',
            ].join(' ')}
          >
            {/* 选中态：柔和玻璃描边 + 底部渐变 underline */}
            {isActive && (
              <>
                <span
                  className="pointer-events-none absolute inset-0 rounded-t-2xl"
                  style={{
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.04)',
                    border: '1px solid var(--native-border)',
                    borderBottom: '1px solid transparent',
                  }}
                />
                <span
                  className="pointer-events-none absolute left-3 right-3 -bottom-[1px] h-[2.5px] rounded-full"
                  style={{
                    background:
                      'linear-gradient(90deg, #4f46e5 0%, #6366f1 45%, #8b5cf6 100%)',
                    boxShadow:
                      '0 6px 14px -4px rgba(99,102,241,0.55)',
                  }}
                />
              </>
            )}

            <span className="relative shrink-0">{prefixIcon(tab)}</span>

            {tab.agentName ? (
              <span
                className="relative shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium mr-0.5"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.12))',
                  color: isActive ? 'var(--native-accent-hover)' : '#a78bfa',
                  border: '1px solid rgba(139,92,246,0.22)',
                }}
              >
                {tab.agentName}
              </span>
            ) : null}

            <span
              className="relative truncate max-w-[180px] font-medium"
              title={tab.label}
            >
              {tab.label}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className={[
                'relative shrink-0 w-5 h-5 rounded-full text-[13px] leading-none flex items-center justify-center transition-all',
                isActive
                  ? 'opacity-70 hover:opacity-100 hover:bg-red-500/15 hover:text-red-400'
                  : 'opacity-0 group-hover:opacity-80 hover:opacity-100 hover:bg-red-500/10 hover:text-red-400',
              ].join(' ')}
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
