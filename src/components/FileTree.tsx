import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { cn } from '../lib/utils';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileTreeProps {
  tree: FileNode[];
  activeFile: string;
  onSelect: (path: string) => void;
  onCreate?: (path: string, type: 'file' | 'directory') => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onDelete?: (path: string) => void;
}

function getFileIconColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const colorMap: Record<string, string> = {
    ts: 'text-blue-400', tsx: 'text-blue-400', js: 'text-yellow-400', jsx: 'text-yellow-400',
    py: 'text-green-400', java: 'text-orange-400', go: 'text-cyan-400', rs: 'text-red-400',
    md: 'text-gray-400', json: 'text-yellow-300', yaml: 'text-pink-300', yml: 'text-pink-300',
    html: 'text-orange-400', css: 'text-blue-300', scss: 'text-pink-400',
    sql: 'text-blue-200', sh: 'text-green-300', bash: 'text-green-300',
    txt: 'text-gray-400', toml: 'text-gray-300', lock: 'text-gray-500',
  };
  return colorMap[ext] || 'text-white/60';
}

function TreeNode({
  node,
  depth,
  activeFile,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  node: FileNode;
  depth: number;
  activeFile: string;
  onSelect: (path: string) => void;
  onCreate?: (path: string, type: 'file' | 'directory') => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onDelete?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [showActions, setShowActions] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');

  const isDir = node.type === 'directory';
  const isActive = activeFile === node.path;

  const handleClick = () => {
    if (isDir) {
      setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };

  const handleRename = () => {
    if (editName.trim() && editName !== node.name && onRename) {
      const parentPath = node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
      const newPath = parentPath ? `${parentPath}/${editName.trim()}` : editName.trim();
      onRename(node.path, newPath);
    }
    setIsEditing(false);
  };

  const handleCreate = () => {
    if (newItemName.trim() && onCreate) {
      const basePath = isDir ? node.path : node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
      const newPath = basePath ? `${basePath}/${newItemName.trim()}` : newItemName.trim();
      onCreate(newPath, newItemType);
      setNewItemName('');
      setShowNewInput(false);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-sm group relative",
          "hover:bg-white/5 transition-colors",
          isActive && !isDir && "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
          !isActive && "text-white/70"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {isDir ? (
          expanded ? <ChevronDown className="w-3.5 h-3.5 text-white/40 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-white/40 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {isDir ? (
          expanded ? <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" /> : <Folder className="w-4 h-4 text-blue-400 shrink-0" />
        ) : (
          <File className={cn("w-4 h-4 shrink-0", getFileIconColor(node.name))} />
        )}

        {isEditing ? (
          <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsEditing(false); }}
              className="flex-1 bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-xs text-white outline-none"
            />
            <button onClick={handleRename} className="p-0.5 hover:bg-white/10 rounded" aria-label="确认重命名"><Check className="w-3 h-3 text-emerald-400" /></button>
            <button onClick={() => setIsEditing(false)} className="p-0.5 hover:bg-white/10 rounded" aria-label="取消重命名"><X className="w-3 h-3 text-white/40" /></button>
          </div>
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}

        {showActions && !isEditing && (
          <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
            {isDir && (
              <button onClick={() => { setShowNewInput(true); setNewItemName(''); setNewItemType('file'); }} className="p-1 hover:bg-white/10 rounded" title="新建文件" aria-label="新建文件">
                <Plus className="w-3 h-3 text-white/40" />
              </button>
            )}
            <button onClick={() => { setIsEditing(true); setEditName(node.name); }} className="p-1 hover:bg-white/10 rounded" title="重命名" aria-label="重命名">
              <Pencil className="w-3 h-3 text-white/40" />
            </button>
            <button onClick={() => onDelete?.(node.path)} className="p-1 hover:bg-red-500/10 rounded" title="删除" aria-label="删除">
              <Trash2 className="w-3 h-3 text-white/40 hover:text-red-400" />
            </button>
          </div>
        )}
      </div>

      {isDir && expanded && node.children && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelect={onSelect}
              onCreate={onCreate}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {showNewInput && (
        <div className="flex items-center gap-1.5 py-1 px-2 text-sm" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
          <span className="w-3.5 shrink-0" />
          {newItemType === 'directory' ? <Folder className="w-4 h-4 text-blue-400/50 shrink-0" /> : <File className="w-4 h-4 text-white/30 shrink-0" />}
          <input
            autoFocus
            value={newItemName}
            onChange={e => setNewItemName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNewInput(false); }}
            placeholder={newItemType === 'directory' ? 'folder name...' : 'file name...'}
            className="flex-1 bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-xs text-white placeholder:text-white/20 outline-none"
          />
          <button onClick={() => setNewItemType(newItemType === 'file' ? 'directory' : 'file')} className="text-[10px] text-white/40 hover:text-white px-1 py-0.5 rounded bg-white/5">
            {newItemType === 'file' ? 'dir' : 'file'}
          </button>
          <button onClick={handleCreate} className="p-0.5 hover:bg-white/10 rounded" aria-label="确认创建"><Check className="w-3 h-3 text-emerald-400" /></button>
          <button onClick={() => setShowNewInput(false)} className="p-0.5 hover:bg-white/10 rounded" aria-label="取消创建"><X className="w-3 h-3 text-white/40" /></button>
        </div>
      )}
    </div>
  );
}

export function FileTree({ tree, activeFile, onSelect, onCreate, onRename, onDelete }: FileTreeProps) {
  return (
    <div className="flex-1 overflow-y-auto py-1">
      {tree.length === 0 && (
        <div className="text-center text-white/30 text-xs py-4">暂无文件</div>
      )}
      {tree.map(node => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          activeFile={activeFile}
          onSelect={onSelect}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
