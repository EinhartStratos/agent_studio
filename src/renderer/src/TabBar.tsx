import type { ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
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
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`group flex items-center gap-2 px-3 py-1.5 text-xs border-r border-native-border cursor-pointer whitespace-nowrap select-none ${
            tab.id === activeId
              ? 'bg-native-bg text-white border-t-2 border-t-blue-500'
              : 'text-native-muted hover:bg-white/5'
          }`}
        >
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
      ))}
    </div>
  );
}
