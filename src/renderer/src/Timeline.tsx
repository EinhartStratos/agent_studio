import type { ReactNode } from 'react';
import { useState } from 'react';
import { marked } from 'marked';
import type { TranscriptItem } from './types';

interface TimelineProps {
  items: TranscriptItem[];
  onFileClick: (path: string) => void;
}

function getFilePath(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  for (const key of ['file_path', 'path', 'file', 'target']) {
    const v = input[key];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function renderDiff(diff: string): ReactNode {
  if (!diff) return null;
  const lines = diff.split('\n').slice(0, 200);
  return (
    <div
      className="mt-3 rounded-2xl overflow-auto max-h-[340px] font-mono text-[11.5px] leading-relaxed"
      style={{
        border: '1px solid var(--native-border-soft)',
        background: 'var(--native-pre-bg)',
      }}
    >
      {lines.map((ln, i) => {
        let cls = 'px-3 py-0.5 whitespace-pre';
        let text = ln;
        if (ln.startsWith('---') || ln.startsWith('+++') || ln.startsWith('@@')) {
          cls += ' text-native-muted bg-native-hover/60';
        } else if (ln.startsWith('+')) {
          cls += ' text-native-success bg-native-success/[0.08]';
        } else if (ln.startsWith('-')) {
          cls += ' text-native-danger bg-native-danger/[0.08]';
        } else {
          cls += ' text-native-text/85';
        }
        return (
          <div key={i} className={cls}>
            {text}
          </div>
        );
      })}
      {diff.split('\n').length > 200 && (
        <div className="px-3 py-1.5 text-native-muted text-[11px] border-t border-native-border-soft">
          …(diff 过长已截断)
        </div>
      )}
    </div>
  );
}

function renderStatusBadge(status?: string, kind?: string): ReactNode {
  const base =
    'inline-flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-medium rounded-full border';
  let color =
    'bg-native-hover text-native-muted border-native-border-soft';
  if (kind === 'read')
    color =
      'bg-sky-500/12 text-sky-400/95 border-sky-400/25';
  if (kind === 'edit')
    color =
      'bg-violet-500/12 text-violet-300/95 border-violet-400/25';
  if (kind === 'execute')
    color =
      'bg-amber-500/12 text-amber-300/95 border-amber-400/25';
  switch (status) {
    case 'pending':
      return (
        <span className={`${base} ${color}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-native-muted/80" />
          等待中
        </span>
      );
    case 'in_progress':
      return (
        <span className={`${base} ${color}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
          执行中
        </span>
      );
    case 'completed':
      return (
        <span
          className={`${base} bg-native-success/12 text-native-success/95 border-native-success/25`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-native-success" />
          已完成
        </span>
      );
    case 'failed':
      return (
        <span
          className={`${base} bg-native-danger/12 text-native-danger/95 border-native-danger/25`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-native-danger" />
          失败
        </span>
      );
    default:
      return <span className={`${base} ${color}`}>{status ?? 'pending'}</span>;
  }
}

interface ToolCardProps {
  tool: NonNullable<TranscriptItem['tool']>;
  onFileClick?: (path: string) => void;
}
function ToolCard({ tool, onFileClick }: ToolCardProps): ReactNode {
  const filePath = getFilePath(tool.input);
  const kindLabel: Record<string, string> = {
    read: '读文件',
    edit: '改文件',
    execute: '执行命令',
  };
  const headerTitle =
    tool.title && tool.title !== tool.name
      ? tool.title
      : tool.name
        ? `调用 ${tool.name}`
        : '工具调用';

  const [showAll, setShowAll] = useState(false);
  let resultText = '';
  try {
    if (typeof tool.result === 'string') resultText = tool.result;
    else if (tool.result !== undefined && tool.result !== null) {
      resultText = JSON.stringify(tool.result, null, 2);
    }
  } catch {
    resultText = String(tool.result ?? '');
  }
  const outputText =
    typeof tool.contentText === 'string' && tool.contentText
      ? tool.contentText
      : resultText;
  const hasLongOutput =
    typeof outputText === 'string' && outputText.length > 1200;
  const showOutput =
    hasLongOutput && !showAll ? outputText.slice(0, 1200) : outputText;

  const locations = Array.isArray(tool.locations) ? tool.locations : [];
  const inputIsObject =
    tool.input !== null &&
    typeof tool.input === 'object' &&
    !Array.isArray(tool.input);
  const hasInputKeys =
    inputIsObject &&
    Object.keys(tool.input as Record<string, unknown>).length > 0;

  return (
    <div
      className="mt-2.5 rounded-2xl overflow-hidden shadow-soft animate-fade-in"
      style={{
        background:
          'linear-gradient(135deg, rgba(245,158,11,0.14), rgba(234,88,12,0.08) 55%, rgba(217,119,6,0.10))',
        border: '1px solid rgba(245, 158, 11, 0.18)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 30px -16px rgba(245,158,11,0.35)',
      }}
    >
      {/* 顶部 */}
      <header
        className="flex items-center gap-2.5 px-4 py-3 border-b"
        style={{ borderColor: 'rgba(245, 158, 11, 0.14)' }}
      >
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] uppercase tracking-[0.14em] font-semibold"
          style={{
            background: 'rgba(245, 158, 11, 0.14)',
            color: '#fbbf24',
            border: '1px solid rgba(245,158,11,0.22)',
          }}
        >
          ⚙️
          {kindLabel[tool.kind ?? ''] ??
            (tool.kind ? String(tool.kind).toUpperCase() : 'TOOL')}
        </span>
        {renderStatusBadge(tool.status, tool.kind)}
        <span className="flex-1 font-mono text-[12.5px] truncate text-native-text/95">
          {headerTitle}
          {filePath && filePath !== headerTitle ? (
            <span className="text-native-muted ml-2">· {filePath}</span>
          ) : null}
        </span>
      </header>

      {/* 内容 */}
      <div className="px-4 py-3 space-y-2.5">
        {locations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {locations.map((loc, i) =>
              loc && typeof loc.path === 'string' ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onFileClick?.(loc.path)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[11.5px] font-medium text-native-text/90 transition-all hover:-translate-y-[1px]"
                  style={{
                    background: 'var(--native-panel)',
                    border: '1px solid var(--native-border)',
                  }}
                  title={loc.path}
                >
                  📎 {loc.path.split(/[\\/]/).slice(-2).join('/')}
                </button>
              ) : null
            )}
          </div>
        ) : null}

        {typeof tool.diffText === 'string' && tool.diffText
          ? renderDiff(tool.diffText)
          : null}

        {!(typeof tool.diffText === 'string' && tool.diffText) &&
        typeof outputText === 'string' &&
        outputText ? (
          <pre
            className="whitespace-pre-wrap break-words rounded-2xl px-3 py-2.5 font-mono text-[11.8px] leading-relaxed text-native-text/90 max-h-[280px] overflow-auto"
            style={{
              background: 'var(--native-pre-bg)',
              border: '1px solid var(--native-border-soft)',
            }}
          >
            {showOutput}
            {hasLongOutput && !showAll ? '\n…（点击展开查看全部）' : ''}
          </pre>
        ) : null}

        {hasInputKeys ? (
          <details className="text-[11.8px] text-native-muted group">
            <summary className="cursor-pointer select-none inline-flex items-center gap-1.5 hover:text-native-text transition-colors">
              🔧 查看参数
            </summary>
            <pre
              className="mt-2 whitespace-pre-wrap break-words font-mono rounded-2xl px-3 py-2"
              style={{
                background: 'var(--native-pre-bg)',
                border: '1px solid var(--native-border-soft)',
              }}
            >
{JSON.stringify(tool.input, null, 2)}
            </pre>
          </details>
        ) : null}

        {hasLongOutput ? (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-[11.8px] text-native-muted hover:text-native-text underline-offset-4 hover:underline transition-colors"
          >
            {showAll ? '收起' : `展开全部（${outputText.length} 字）`}
          </button>
        ) : null}

        {typeof tool.error === 'string' && tool.error ? (
          <div
            className="rounded-2xl px-3 py-2.5 font-mono text-[11.8px]"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.22)',
              color: '#fecaca',
            }}
          >
            <div className="font-semibold text-native-danger mb-1 flex items-center gap-1.5">
              ❌ 错误
            </div>
            <div className="whitespace-pre-wrap break-words">
              {tool.error}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isFilePath(str: string): boolean {
  return /^[A-Za-z]:\\|^\.[\\/]|^\/[^\/]/.test(str);
}

function linkFilePaths(text: string): string {
  return text.replace(
    /(\b[A-Za-z]:\\[^\s]+|\b\.\/[^\s]+|\/[^\s]+)/g,
    (match) => `[${match}](<${match}>)`
  );
}

function renderMarkdown(
  text: string,
  onFileClick: (path: string) => void
): ReactNode {
  const linked = linkFilePaths(text);
  const html = marked(linked, {
    async: false,
    gfm: true,
    breaks: true,
  }) as string;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A') {
      const href = target.getAttribute('href');
      if (href && isFilePath(href)) {
        e.preventDefault();
        onFileClick(href);
      }
    }
  };

  return (
    <div
      className="markdown-body whitespace-normal"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}

function renderContent(
  item: TranscriptItem,
  onFileClick: (path: string) => void
): ReactNode {
  if (item.type === 'tool') {
    return item.tool ? (
      <ToolCard tool={item.tool} onFileClick={onFileClick} />
    ) : null;
  }

  const entries =
    item.type === 'plan' && Array.isArray(item.plan?.entries)
      ? item.plan.entries
      : [];
  if (entries.length > 0) {
    const badge = (status?: string) => {
      switch (status) {
        case 'completed':
          return (
            <span className="inline-flex w-5 h-5 items-center justify-center rounded-full text-native-success"
              style={{ background: 'rgba(16,185,129,0.14)' }}>
              ✓
            </span>
          );
        case 'in_progress':
          return (
            <span className="inline-flex w-5 h-5 items-center justify-center rounded-full text-amber-400 animate-pulse-soft"
              style={{ background: 'rgba(245,158,11,0.14)' }}>
              ◷
            </span>
          );
        case 'pending':
        default:
          return (
            <span className="inline-flex w-5 h-5 items-center justify-center rounded-full text-native-muted"
              style={{ background: 'var(--native-hover)' }}>
              ○
            </span>
          );
      }
    };
    return (
      <div
        className="mt-2.5 rounded-2xl p-4 shadow-soft animate-fade-in"
        style={{
          background:
            'linear-gradient(135deg, rgba(20,184,166,0.12), rgba(59,130,246,0.08) 60%, rgba(99,102,241,0.08))',
          border: '1px solid rgba(20, 184, 166, 0.18)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="inline-flex items-center gap-2 text-[11.5px] uppercase tracking-[0.12em] font-semibold text-teal-300/90">
            📋 执行计划
          </div>
          <span className="chip text-[10.5px]">
            共 {entries.length} 项
          </span>
        </div>
        <div className="space-y-1.5">
          {entries.map((e, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 px-2.5 py-2 rounded-xl transition-colors hover:bg-white/[0.03]"
            >
              {badge(e.status)}
              <span
                className={`flex-1 text-[13.2px] leading-relaxed ${
                  e.status === 'completed'
                    ? 'text-native-muted line-through'
                    : 'text-native-text/95'
                }`}
              >
                {typeof e.content === 'string'
                  ? e.content
                  : String(e.content ?? '')}
              </span>
              {e.priority === 'high' || e.priority === 'urgent' ? (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                  style={{
                    background: 'rgba(239,68,68,0.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239,68,68,0.22)',
                  }}
                >
                  HIGH
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const text = item.content ?? '';

  if (item.type === 'assistant' || item.type === 'error') {
    try {
      return renderMarkdown(text, onFileClick);
    } catch {
      return (
        <div className="whitespace-pre-wrap break-words">
          {text.split(/(\b[A-Za-z]:\\[^\s]+|\b\.\/[^\s]+|\/[^\s]+)/).map((part, idx) => {
            const isPath =
              /^[A-Za-z]:\\/.test(part) || /^\.\/|^\//.test(part);
            return isPath ? (
              <span
                key={idx}
                className="text-native-accent-hover underline cursor-pointer underline-offset-2"
                onClick={() => onFileClick(part)}
              >
                {part}
              </span>
            ) : (
              <span key={idx}>{part}</span>
            );
          })}
        </div>
      );
    }
  }

  return (
    <div className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.85]">
      {text.split(/(\b[A-Za-z]:\\[^\s]+|\b\.\/[^\s]+|\/[^\s]+)/).map((part, idx) => {
        const isPath =
          /^[A-Za-z]:\\/.test(part) || /^\.\/|^\//.test(part);
        return isPath ? (
          <span
            key={idx}
            className="text-native-accent-hover underline cursor-pointer underline-offset-2"
            onClick={() => onFileClick(part)}
          >
            {part}
          </span>
        ) : (
          <span key={idx}>{part}</span>
        );
      })}
    </div>
  );
}

function BubbleMeta({
  icon,
  name,
  ts,
  accent,
}: {
  icon: string;
  name: string;
  ts?: number;
  accent?: 'violet' | 'amber' | 'indigo' | 'rose' | 'default';
}) {
  const ringColor = (() => {
    switch (accent) {
      case 'violet':
        return 'rgba(139,92,246,0.22)';
      case 'amber':
        return 'rgba(245,158,11,0.22)';
      case 'indigo':
        return 'rgba(99,102,241,0.28)';
      case 'rose':
        return 'rgba(244,63,94,0.22)';
      default:
        return 'var(--native-border)';
    }
  })();
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span
        className="w-6 h-6 rounded-2xl inline-flex items-center justify-center text-[12px] shrink-0"
        style={{
          background: 'var(--native-panel-2)',
          border: `1px solid ${ringColor}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {icon}
      </span>
      <span className="text-[12px] font-medium text-native-text/95 tracking-wide">
        {name}
      </span>
      <span className="text-[11px] text-native-muted/90 ml-1">
        {formatTime(ts ?? Date.now())}
      </span>
    </div>
  );
}

export function Timeline({
  items,
  onFileClick,
}: TimelineProps): ReactNode {
  const safeItems = Array.isArray(items) ? items : [];
  const visibleItems = safeItems.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'assistant') return !!item.content?.trim();
    if (item.type === 'thinking') return !!item.content?.trim();
    return true;
  });

  return (
    <div className="relative flex-1 min-h-0 overflow-auto">
      {/* 顶部柔和渐变，让消息区像信纸 */}
      <div
        aria-hidden
        className="pointer-events-none sticky top-0 -mb-16 h-16 z-[1]"
        style={{
          background:
            'linear-gradient(180deg, var(--native-bg) 10%, transparent 100%)',
        }}
      />

      <div className="mx-auto w-full max-w-4xl px-6 pt-8 pb-10 space-y-5">
        {visibleItems.length === 0 && (
          <div className="glass-card px-6 py-14 text-center animate-lift-in">
            <div
              aria-hidden
              className="mx-auto w-14 h-14 rounded-3xl flex items-center justify-center text-[28px] mb-4"
              style={{
                background:
                  'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.14))',
                border: '1px solid rgba(99,102,241,0.22)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.06), 0 14px 30px -16px rgba(99,102,241,0.45)',
              }}
            >
              ✦
            </div>
            <div className="text-[15px] font-semibold text-native-text mb-1">
              开始一场对话吧
            </div>
            <div className="text-[12.5px] text-native-muted">
              在下方输入您的工作需求，Agent 会为您调用工具并一步步解决。
            </div>
          </div>
        )}

        {visibleItems.map((item, idx) => {
          if (!item || typeof item.id === 'undefined' || item.id === null)
            return null;
          const keyId = String(item.id);
          const isUser = item.type === 'user';
          const isTool = item.type === 'tool';
          const isError = item.type === 'error';
          const isThinking = item.type === 'thinking';
          const isSystem = item.type === 'system' || item.type === 'model';

          if (isSystem) {
            return (
              <div key={keyId} className="flex justify-center animate-fade-in">
                <span className="chip">
                  <span className="text-native-muted/90">{item.content ?? ''}</span>
                </span>
              </div>
            );
          }

          if (isError) {
            return (
              <div
                key={keyId}
                className="flex justify-start animate-lift-in"
                style={{ animationDelay: `${idx * 20}ms` }}
              >
                <div
                  className="max-w-[82%] rounded-3xl px-5 py-4 shadow-soft"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(239,68,68,0.14), rgba(244,63,94,0.08))',
                    border: '1px solid rgba(239,68,68,0.22)',
                  }}
                >
                  <BubbleMeta
                    icon="⚠️"
                    name="错误"
                    ts={item.timestamp}
                    accent="rose"
                  />
                  {renderContent(item, onFileClick)}
                </div>
              </div>
            );
          }

          if (isThinking) {
            return (
              <div
                key={keyId}
                className="flex justify-start animate-lift-in"
                style={{ animationDelay: `${idx * 18}ms` }}
              >
                <div
                  className="max-w-[82%] rounded-3xl px-5 py-4 shadow-soft"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(139,92,246,0.16), rgba(99,102,241,0.10) 55%, rgba(14,165,233,0.10))',
                    border: '1px solid rgba(139,92,246,0.20)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 32px -18px rgba(139,92,246,0.45)',
                  }}
                >
                  <BubbleMeta
                    icon="🧠"
                    name="思考中"
                    ts={item.timestamp}
                    accent="violet"
                  />
                  <div className="text-[13px] leading-[1.9] whitespace-pre-wrap break-words text-violet-100/95 font-[450] tracking-wide">
                    {item.content ?? ''}
                  </div>
                </div>
              </div>
            );
          }

          if (isUser) {
            return (
              <div
                key={keyId}
                className="flex justify-end animate-lift-in"
                style={{ animationDelay: `${idx * 18}ms` }}
              >
                <div
                  className="max-w-[78%] rounded-3xl px-5 py-3.5 text-white shadow-lift"
                  style={{
                    background:
                      'linear-gradient(135deg,#4f46e5 0%,#6366f1 50%,#8b5cf6 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 40px -22px rgba(99,102,241,0.75)',
                  }}
                >
                  <div className="flex items-center justify-end gap-2 mb-1">
                    <span className="text-[11px] text-white/75">
                      {formatTime(item.timestamp ?? Date.now())}
                    </span>
                    <span
                      className="w-6 h-6 rounded-2xl inline-flex items-center justify-center text-[12px] shrink-0"
                      style={{
                        background: 'rgba(255,255,255,0.18)',
                        border: '1px solid rgba(255,255,255,0.25)',
                      }}
                    >
                      👤
                    </span>
                  </div>
                  <div className="text-[13.8px] leading-[1.85] whitespace-pre-wrap break-words font-[470]">
                    {item.content ?? ''}
                  </div>
                </div>
              </div>
            );
          }

          // 默认：assistant / tool（tool 单独在 renderContent 里美化）
          return (
            <div
              key={keyId}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-lift-in`}
              style={{ animationDelay: `${idx * 18}ms` }}
            >
              <div
                className={
                  isTool
                    ? 'max-w-[86%] w-full'
                    : 'max-w-[82%] rounded-3xl px-5 py-4 glass-card'
                }
              >
                {!isTool && (
                  <BubbleMeta
                    icon="✦"
                    name="助手"
                    ts={item.timestamp}
                    accent="indigo"
                  />
                )}
                {renderContent(item, onFileClick)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
