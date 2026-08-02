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
    <div className="mt-2 rounded border border-native-border bg-black/40 overflow-auto max-h-[320px] font-mono text-[11px] leading-relaxed">
      {lines.map((ln, i) => {
        let cls = 'px-2 py-0.5 whitespace-pre';
        let text = ln;
        if (ln.startsWith('---') || ln.startsWith('+++') || ln.startsWith('@@')) {
          cls += ' text-neutral-400 bg-neutral-800/60';
        } else if (ln.startsWith('+')) {
          cls += ' text-green-400 bg-green-900/15';
        } else if (ln.startsWith('-')) {
          cls += ' text-red-400 bg-red-900/15';
        } else {
          cls += ' text-neutral-200';
        }
        return <div key={i} className={cls}>{text}</div>;
      })}
      {diff.split('\n').length > 200 && <div className="px-2 py-1 text-neutral-500 text-[11px]">…(diff 过长已截断)</div>}
    </div>
  );
}

function renderStatusBadge(status?: string, kind?: string): ReactNode {
  let text = status ?? 'pending';
  let color = 'bg-neutral-500/30 text-neutral-200 border-neutral-400/40';
  if (kind === 'read') color = 'bg-sky-500/15 text-sky-300 border-sky-400/40';
  if (kind === 'edit') color = 'bg-violet-500/15 text-violet-300 border-violet-400/40';
  if (kind === 'execute') color = 'bg-amber-500/15 text-amber-300 border-amber-400/40';
  switch (status) {
    case 'pending':
      return <span className={`px-1.5 py-0.5 text-[10px] rounded border ${color}`}>等待中</span>;
    case 'in_progress':
      return <span className={`px-1.5 py-0.5 text-[10px] rounded border ${color} animate-pulse`}>执行中</span>;
    case 'completed':
      return <span className="px-1.5 py-0.5 text-[10px] rounded border bg-emerald-500/15 text-emerald-300 border-emerald-400/40">已完成</span>;
    case 'failed':
      return <span className="px-1.5 py-0.5 text-[10px] rounded border bg-rose-500/15 text-rose-300 border-rose-400/40">失败</span>;
    default:
      return <span className={`px-1.5 py-0.5 text-[10px] rounded border ${color}`}>{text}</span>;
  }
}

interface ToolCardProps {
  tool: NonNullable<TranscriptItem['tool']>;
  onFileClick?: (path: string) => void;
}
function ToolCard({ tool, onFileClick }: ToolCardProps): ReactNode {
  const filePath = getFilePath(tool.input);
  const kindLabel: Record<string, string> = { read: '读文件', edit: '改文件', execute: '执行命令' };
  const headerTitle = tool.title && tool.title !== tool.name ? tool.title : (tool.name ? `调用 ${tool.name}` : '工具调用');

  const [showAll, setShowAll] = useState(false);
  let resultText = '';
  try {
    if (typeof tool.result === 'string') resultText = tool.result;
    else if (tool.result !== undefined && tool.result !== null) {
      resultText = JSON.stringify(tool.result, null, 2);
    }
  } catch { resultText = String(tool.result ?? ''); }
  const outputText = (typeof tool.contentText === 'string' && tool.contentText) ? tool.contentText : resultText;
  const hasLongOutput = typeof outputText === 'string' && outputText.length > 1200;
  const showOutput = hasLongOutput && !showAll ? outputText.slice(0, 1200) : outputText;

  const locations = Array.isArray(tool.locations) ? tool.locations : [];
  const inputIsObject = tool.input !== null && typeof tool.input === 'object' && !Array.isArray(tool.input);
  const hasInputKeys = inputIsObject && Object.keys(tool.input as Record<string, unknown>).length > 0;

  return (
    <div className="mt-2 rounded border border-native-border bg-black/30 text-xs overflow-hidden font-sans">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-native-border/70 bg-neutral-900/40">
        <span className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold">
          {kindLabel[tool.kind ?? ''] ?? (tool.kind ? String(tool.kind).toUpperCase() : 'TOOL')}
        </span>
        {renderStatusBadge(tool.status, tool.kind)}
        <span className="flex-1 font-mono text-blue-300 truncate">
          {headerTitle}
          {filePath && filePath !== headerTitle ? <span className="text-neutral-500"> · {filePath}</span> : null}
        </span>
      </div>

      <div className="px-2.5 py-2 space-y-2">
        {locations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {locations.map((loc, i) => (
              loc && typeof loc.path === 'string' ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onFileClick?.(loc.path)}
                  className="px-1.5 py-0.5 rounded bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] underline-offset-2 hover:underline transition-colors"
                  title={loc.path}
                >
                  📎 {loc.path.split(/[\\/]/).slice(-2).join('/')}
                </button>
              ) : null
            ))}
          </div>
        ) : null}

        {typeof tool.diffText === 'string' && tool.diffText ? renderDiff(tool.diffText) : null}

        {!(typeof tool.diffText === 'string' && tool.diffText) && typeof outputText === 'string' && outputText ? (
          <pre className="whitespace-pre-wrap break-words rounded border border-neutral-700/50 bg-black/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-neutral-200 max-h-[260px] overflow-auto">
{showOutput}
{hasLongOutput && !showAll ? '\n…（点击展开查看全部）' : ''}
          </pre>
        ) : null}

        {hasInputKeys ? (
          <details className="text-[11px] text-neutral-400">
            <summary className="cursor-pointer select-none hover:text-neutral-200">🔧 参数</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono bg-black/40 px-2 py-1 rounded border border-neutral-700/50">
{JSON.stringify(tool.input, null, 2)}
            </pre>
          </details>
        ) : null}

        {hasLongOutput ? (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-[11px] text-neutral-400 hover:text-neutral-200 underline"
          >
            {showAll ? '收起' : `展开全部 (${outputText.length} 字)`}
          </button>
        ) : null}

        {typeof tool.error === 'string' && tool.error ? (
          <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 font-mono text-[11px] text-rose-200">
            <div className="font-semibold text-rose-300 mb-0.5">❌ 错误</div>
            <div className="whitespace-pre-wrap break-words">{tool.error}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
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

function splitWithPaths(text: string): Array<{ text: string; isPath: boolean }> {
  const parts = text.split(/(\b[A-Za-z]:\\[^\s]+|\b\.\/[^\s]+|\/[^\s]+)/);
  return parts.map((part) => ({
    text: part,
    isPath: /^[A-Za-z]:\\/.test(part) || /^\.\/|^\//.test(part),
  }));
}

function renderMarkdown(text: string, onFileClick: (path: string) => void): ReactNode {
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

  return <div className="markdown-body whitespace-normal" dangerouslySetInnerHTML={{ __html: html }} onClick={handleClick} />;
}

function renderContent(item: TranscriptItem, onFileClick: (path: string) => void): ReactNode {
  if (item.type === 'tool') {
    return item.tool ? <ToolCard tool={item.tool} onFileClick={onFileClick} /> : null;
  }

  const entries = item.type === 'plan' && Array.isArray(item.plan?.entries) ? item.plan.entries : [];
  if (entries.length > 0) {
    const badge = (status?: string) => {
      switch (status) {
        case 'completed':
          return <span className="inline-block w-4 text-center text-emerald-400">✓</span>;
        case 'in_progress':
          return <span className="inline-block w-4 text-center text-amber-400 animate-pulse">◷</span>;
        case 'pending':
        default:
          return <span className="inline-block w-4 text-center text-neutral-500">○</span>;
      }
    };
    return (
      <div className="mt-2 rounded border border-native-border bg-black/30 p-2 text-xs font-mono space-y-1">
        <div className="text-[10px] uppercase text-neutral-400 font-semibold mb-1">📋 执行计划</div>
        {entries.map((e, i) => (
          <div key={i} className="flex items-start gap-2">
            {badge(e.status)}
            <span className={`flex-1 ${e.status === 'completed' ? 'text-neutral-500 line-through' : 'text-neutral-100'}`}>
              {typeof e.content === 'string' ? e.content : String(e.content ?? '')}
            </span>
            {e.priority === 'high' || e.priority === 'urgent' ? (
              <span className="text-[10px] px-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">HIGH</span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  const text = item.content ?? '';

  if (item.type === 'assistant' || item.type === 'error') {
    try {
      return renderMarkdown(text, onFileClick);
    } catch (e) {
      return (
        <div className="whitespace-pre-wrap break-words">
          {splitWithPaths(text).map((part, idx) =>
            part.isPath ? (
              <span
                key={idx}
                className="text-blue-400 underline cursor-pointer"
                onClick={() => onFileClick(part.text)}
              >
                {part.text}
              </span>
            ) : (
              <span key={idx}>{part.text}</span>
            )
          )}
        </div>
      );
    }
  }

  return (
    <div className="whitespace-pre-wrap">
      {splitWithPaths(text).map((part, idx) =>
        part.isPath ? (
          <span
            key={idx}
            className="text-blue-400 underline cursor-pointer"
            onClick={() => onFileClick(part.text)}
          >
            {part.text}
          </span>
        ) : (
          <span key={idx}>{part.text}</span>
        )
      )}
    </div>
  );
}

export function Timeline({ items, onFileClick }: TimelineProps): ReactNode {
  const safeItems = Array.isArray(items) ? items : [];
  const visibleItems = safeItems.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'assistant') {
      return !!item.content?.trim();
    }
    if (item.type === 'thinking') {
      return !!item.content?.trim();
    }
    return true;
  });

  return (
    <div className="flex-1 overflow-auto p-4 space-y-3">
      {visibleItems.length === 0 && (
        <div className="text-sm text-native-muted text-center mt-8">暂无消息，开始一场对话吧</div>
      )}
      {visibleItems.map((item) => {
        if (!item || typeof item.id === 'undefined' || item.id === null) return null;
        const isUser = item.type === 'user';
        const isTool = item.type === 'tool';
        const isError = item.type === 'error';
        const isThinking = item.type === 'thinking';
        const isSystem = item.type === 'system' || item.type === 'model';

        if (isSystem) {
          return (
            <div key={String(item.id)} className="flex justify-center">
              <div className="px-2 py-1 rounded-full bg-black/30 border border-native-border text-[10px] text-native-muted">
                {item.content ?? ''}
              </div>
            </div>
          );
        }

        if (isThinking) {
          return (
            <div key={String(item.id)} className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-violet-500/5 text-violet-100 border border-violet-400/20 shadow-sm">
                <div className="text-[10px] text-violet-300/90 mb-1 flex items-center gap-2">
                  <span className="font-semibold">🧠 思考</span>
                  <span>{formatTime(item.timestamp ?? Date.now())}</span>
                </div>
                <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-violet-100/95">
                  {item.content ?? ''}
                </div>
              </div>
            </div>
          );
        }

        if (isError) {
          return (
            <div key={String(item.id)} className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-red-600/20 text-red-100 border border-red-800">
                <div className="text-[10px] text-red-300 mb-1">{formatTime(item.timestamp ?? Date.now())}</div>
                {renderContent(item, onFileClick)}
              </div>
            </div>
          );
        }

        return (
          <div key={String(item.id)} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                isUser
                  ? 'bg-blue-600/30 text-white'
                  : isTool
                  ? 'bg-yellow-600/20 text-yellow-100'
                  : 'bg-native-panel text-native-text border border-native-border'
              }`}
            >
              <div className="text-[10px] text-native-muted mb-1 flex items-center gap-2">
                <span>{isUser ? '你' : isTool ? '工具' : '助手'}</span>
                <span>{formatTime(item.timestamp ?? Date.now())}</span>
              </div>
              {renderContent(item, onFileClick)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
