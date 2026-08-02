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

  const navItem = (
    key: 'sessions' | 'market',
    icon: string,
    label: string,
    onClick: () => void
  ) => {
    const active = activeView === key;
    return (
      <button
        type="button"
        onClick={onClick}
        className={[
          'group relative w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-180 ease-out whitespace-nowrap',
          active
            ? 'text-white shadow-glow-indigo'
            : 'text-native-text/80 hover:text-native-text',
        ].join(' ')}
      >
        {/* 选中态的柔和渐变发光背景（降饱和，更舒适） */}
        {active && (
          <span
            className="absolute inset-0 -z-0 rounded-lg pointer-events-none opacity-95"
            style={{
              background:
                'linear-gradient(135deg, rgba(99,102,241,0.88) 0%, rgba(129,140,248,0.80) 55%, rgba(167,139,250,0.74) 100%)',
              boxShadow:
                '0 1px 2px rgba(99,102,241,0.25), 0 10px 24px -14px rgba(129,140,248,0.55)',
            }}
          />
        )}
        {!active && (
          <span className="absolute inset-0 -z-0 rounded-lg bg-native-hover opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        )}
        <span className="relative w-4 text-[13px] leading-none text-center shrink-0">
          {icon}
        </span>
        <span className="relative flex-1 text-left min-w-0">{label}</span>
        {active && (
          <span className="relative w-[3px] h-5 rounded-full bg-white/80 shadow-[0_0_10px_rgba(255,255,255,0.55)] shrink-0" />
        )}
      </button>
    );
  };

  const sessionRowClass = (isActive: boolean) =>
    [
      'group relative flex items-center px-2.5 py-2 rounded-xl text-[13px] cursor-pointer truncate transition-all duration-150 ease-out',
      isActive
        ? 'text-white'
        : 'text-native-text/90 hover:text-native-text',
    ].join(' ');

  return (
    <aside
      className="w-66 shrink-0 flex flex-col border-r border-native-border bg-native-panel backdrop-blur-xl"
      style={{ width: 272 }}
    >
      {/* 顶部 Brand 区：玻璃卡 + 柔光阴影 */}
      <header className="relative px-4 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-glow-violet shrink-0"
            style={{
              background:
                'linear-gradient(135deg,#4f46e5 0%,#6366f1 45%,#8b5cf6 100%)',
            }}
          >
            <span className="text-[18px] leading-none">✦</span>
          </div>
          <div className="flex flex-col min-w-0">
            <h1 className="text-[15.5px] font-semibold tracking-tight truncate text-native-text">
              Agent Studio
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse-soft ${
                  ready ? 'bg-native-success' : 'bg-native-danger'
                }`}
              />
              <span
                className={`text-[11px] font-medium ${
                  ready ? 'text-native-success' : 'text-native-danger'
                }`}
              >
                {ready ? '驱动已就绪' : health?.error ?? '未初始化'}
              </span>
            </div>
          </div>
        </div>
        {health?.currentModel && (
          <div className="mt-3">
            <span className="chip chip-accent">
              <span>🤖</span>
              <span className="truncate max-w-[180px]">{health.currentModel}</span>
            </span>
          </div>
        )}
      </header>

      <div className="px-4 pb-3">
        <div className="soft-divider -mx-1" />
      </div>

      {/* 工作区输入 + 操作按钮 */}
      <section className="px-4 pb-3 space-y-2.5">
        <label className="block">
          <span className="sr-only">工作区路径</span>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-native-muted text-[13px] select-none">
              📁
            </span>
            <input
              type="text"
              value={workspace}
              onChange={(e) => onWorkspaceChange(e.target.value)}
              placeholder="工作区路径"
              spellCheck={false}
              className="w-full text-[13px] pl-8 pr-3 py-2 rounded-xl bg-native-input-bg border border-native-border
                         text-native-text placeholder:text-native-muted/80
                         focus:outline-none focus:border-native-accent/60
                         focus:shadow-[0_0_0_3px_rgba(99,102,241,0.18)]
                         transition-all"
            />
          </div>
        </label>

        <div className="flex gap-2">
          <button
            onClick={onRefresh}
            className="btn-ghost flex-1 text-[12.5px]"
          >
            初始化 / 刷新
          </button>
          <button
            onClick={onCreate}
            disabled={!ready}
            className={[
              'btn-primary flex-1 text-[12.5px]',
              !ready ? 'opacity-45 cursor-not-allowed hover:!transform-none hover:!filter-none' : '',
            ].join(' ')}
          >
            新建会话
          </button>
        </div>
      </section>

      {/* 导航条 */}
      <nav className="px-4 pb-2">
        <div className="rounded-2xl p-1 bg-native-glass border border-native-border shadow-soft">
          <div className="grid grid-cols-2 gap-1">
            {navItem('sessions', '💬', '会话列表', onOpenSessions)}
            {navItem('market', '🧩', '智能体市场', onOpenMarket)}
          </div>
        </div>
      </nav>

      <div className="px-4 pb-2">
        <div className="soft-divider -mx-1" />
      </div>

      {/* 主内容区：会话列表 or 市场说明 */}
      <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
        {activeView === 'sessions' ? (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between px-0.5 pt-1 pb-2">
              <div className="text-[11px] uppercase tracking-[0.12em] text-native-muted font-semibold">
                Sessions
              </div>
              <div className="chip">{sessions.length}</div>
            </div>

            {sessions.length === 0 && (
              <div className="glass-card px-4 py-5 text-[13px] text-native-muted text-center">
                <div className="text-[18px] mb-1">📭</div>
                暂无会话，点「新建会话」开始。
              </div>
            )}

            <ul className="space-y-1.5 mt-1">
              {sessions.map((s) => {
                const isActive = s.sessionId === current?.sessionId;
                return (
                  <li
                    key={s.sessionId}
                    onClick={() => onSelect(s)}
                    className={sessionRowClass(isActive)}
                    title={s.sessionFile}
                  >
                    {isActive && (
                      <span
                        className="absolute inset-0 -z-0 rounded-xl"
                        style={{
                          background:
                            'linear-gradient(135deg, rgba(129,140,248,0.82), rgba(167,139,250,0.72))',
                          boxShadow:
                            '0 1px 2px rgba(99,102,241,0.22), 0 12px 28px -16px rgba(129,140,248,0.55)',
                        }}
                      />
                    )}
                    {!isActive && (
                      <span className="absolute inset-0 -z-0 rounded-xl bg-native-hover opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    )}
                    <span className="relative w-5 text-center shrink-0 text-[13px]">
                      💬
                    </span>
                    <span className="relative flex-1 truncate">
                      {s.name?.trim() ? s.name : s.sessionId.slice(0, 8)}
                    </span>
                    {isActive && (
                      <span className="relative w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="animate-fade-in pt-2">
            <div className="glass-card p-4">
              <div className="text-[13px] font-semibold text-native-text flex items-center gap-2">
                <span>🧩</span>智能体市场
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-native-muted">
                右侧为智能体市场卡片列表，每个智能体都预设有专用的
                <span className="mx-1 chip chip-accent text-[10.5px]">System Prompt</span>
                或技能，一键创建专属对话。
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip chip-accent text-[10.5px]">零配置</span>
                <span className="chip text-[10.5px]">结构化输出</span>
                <span className="chip text-[10.5px]">可扩展</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
