import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FileTreeNode } from './types';

interface FileTreeProps {
  nodes: FileTreeNode[];
  onSelect: (path: string) => void;
  selectedPath?: string;
}

function TreeNode({
  node,
  onSelect,
  selectedPath,
  depth,
}: {
  node: FileTreeNode;
  onSelect: (path: string) => void;
  selectedPath?: string;
  depth: number;
}): ReactNode {
  const [open, setOpen] = useState(true);
  const isDir = node.type === 'directory';

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 text-sm hover:bg-white/5 cursor-pointer truncate select-none ${
          selectedPath === node.path ? 'bg-blue-600/30 text-white' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (isDir) setOpen((v) => !v);
          else onSelect(node.path);
        }}
      >
        <span className="text-native-muted text-xs w-4 text-center">{isDir ? (open ? '▼' : '▶') : '•'}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {isDir && open && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} onSelect={onSelect} selectedPath={selectedPath} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ nodes, onSelect, selectedPath }: FileTreeProps): ReactNode {
  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="text-xs text-native-muted uppercase tracking-wide px-3 py-2 border-b border-native-border">文件树</div>
      {nodes.length === 0 && <div className="text-xs text-native-muted px-3 py-2">空目录</div>}
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} onSelect={onSelect} selectedPath={selectedPath} depth={0} />
      ))}
    </div>
  );
}
