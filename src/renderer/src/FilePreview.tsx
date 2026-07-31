import type { ReactNode } from 'react';

interface FilePreviewProps {
  file: string;
  preview: string;
  diff: string;
  onPreview: () => void;
  onDiff: () => void;
}

export function FilePreview({ file, preview, diff, onPreview, onDiff }: FilePreviewProps): ReactNode {
  const content = diff || preview;
  const mode = diff ? 'diff' : 'preview';

  return (
    <div className="flex flex-col h-1/2">
      <div className="text-xs text-native-muted uppercase tracking-wide px-3 py-2 border-b border-native-border flex items-center justify-between">
        <span>文件预览</span>
        <div className="flex gap-1">
          <button
            onClick={onPreview}
            disabled={!file}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-600/30 hover:bg-blue-600/50 disabled:opacity-40"
          >
            预览
          </button>
          <button
            onClick={onDiff}
            disabled={!file}
            className="text-[10px] px-2 py-0.5 rounded bg-green-600/30 hover:bg-green-600/50 disabled:opacity-40"
          >
            Diff
          </button>
        </div>
      </div>

      <div className="px-3 py-2 text-xs text-native-muted truncate border-b border-native-border" title={file}>
        {file || '未选择文件'}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {content ? (
          <pre
            className={`text-xs font-mono whitespace-pre-wrap ${
              mode === 'diff' ? 'text-green-100' : 'text-native-text'
            }`}
          >
            {content}
          </pre>
        ) : (
          <div className="text-xs text-native-muted text-center mt-8">在左侧文件树点击文件，再选择预览或 Diff</div>
        )}
      </div>
    </div>
  );
}
