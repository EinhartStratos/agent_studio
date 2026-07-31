import type { ReactNode } from 'react';
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

function renderTool(tool?: TranscriptItem['tool']): ReactNode {
  if (!tool) return null;
  const filePath = getFilePath(tool.input);
  let summary = `调用 ${tool.name}`;
  if (filePath) {
    summary = tool.name === 'read_file' || tool.name === 'view' ? `读取了 ${filePath}` : `${tool.name}：${filePath}`;
  }
  return (
    <div className="mt-2 p-2 rounded bg-black/30 border border-native-border text-xs font-mono">
      <div className="text-blue-400 font-semibold">{summary}</div>
      {tool.error && <div className="text-red-400 mt-1">错误: {tool.error}</div>}
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
    return renderTool(item.tool);
  }

  const text = item.content ?? '';

  // 助手和错误输出渲染为 Markdown；用户消息保持原样并支持路径点击
  if (item.type === 'assistant' || item.type === 'error') {
    return renderMarkdown(text, onFileClick);
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
  // 隐藏助手连续调用工具时产生的空对话框，只在有实际输出时显示
  const visibleItems = items.filter((item) => {
    if (item.type === 'assistant') {
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
        const isUser = item.type === 'user';
        const isTool = item.type === 'tool';
        const isError = item.type === 'error';
        const isSystem = item.type === 'system' || item.type === 'model' || item.type === 'thinking';

        if (isSystem) {
          return (
            <div key={item.id} className="flex justify-center">
              <div className="px-2 py-1 rounded-full bg-black/30 border border-native-border text-[10px] text-native-muted">
                {item.content}
              </div>
            </div>
          );
        }

        if (isError) {
          return (
            <div key={item.id} className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-red-600/20 text-red-100 border border-red-800">
                <div className="text-[10px] text-red-300 mb-1">{formatTime(item.timestamp)}</div>
                {renderContent(item, onFileClick)}
              </div>
            </div>
          );
        }

        return (
          <div key={item.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
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
                <span>{formatTime(item.timestamp)}</span>
              </div>
              {renderContent(item, onFileClick)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
