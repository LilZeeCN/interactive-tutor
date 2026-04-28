import { useState, useEffect, useRef } from 'react';
import { FileNode } from '../components/FileTree';
import { readSSEStream } from './useStreamFetch';
import { apiFetch, authFetchInit } from '../lib/api';

/**
 * Shared workspace logic for Lab and Project workspaces.
 * Handles file tree, file content, CRUD operations, and AI modify.
 */
export function useWorkspace(
  type: 'labs' | 'projects',
  itemId: string | undefined,
  courseId: string,
  hasContent: boolean,
  starterCode?: any,
) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const [aiModifyOpen, setAiModifyOpen] = useState(false);
  const [aiModifyInput, setAiModifyInput] = useState('');
  const [aiModifying, setAiModifying] = useState(false);
  const [aiModifyResult, setAiModifyResult] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const starterCodeRef = useRef(starterCode);
  starterCodeRef.current = starterCode;

  const baseUrl = `/api/workspace/${courseId}/${type}/${itemId}`;

  function findFirstFile(nodes: FileNode[]): string | null {
    for (const node of nodes) {
      if (node.type === 'file') return node.path;
      if (node.children) {
        const found = findFirstFile(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  const reloadTree = () => {
    apiFetch(`${baseUrl}/tree`).then(setFileTree).catch(() => {});
  };

  // Load file tree
  useEffect(() => {
    if (!itemId || !hasContent) return;
    apiFetch(`${baseUrl}/tree`)
      .then(data => {
        setFileTree(data);
        if (data.length > 0 && !activeFileRef.current) {
          const first = findFirstFile(data);
          if (first) setActiveFile(first);
        }
      })
      .catch(() => {
        if (starterCode) {
          const tree = Object.keys(starterCode).map(f => ({
            name: f.split('/').pop() || f, path: f, type: 'file' as const,
          }));
          setFileTree(tree);
          if (tree.length > 0 && !activeFileRef.current) setActiveFile(tree[0].path);
        }
      });
  }, [itemId, hasContent, courseId]);

  // Load file content
  useEffect(() => {
    if (!activeFile || !itemId) { setFileContent(''); return; }
    let cancelled = false;
    apiFetch<{ content?: string }>(`${baseUrl}/file/${activeFile}`)
      .then(data => { if (!cancelled) setFileContent(data?.content || ''); })
      .catch(() => { if (!cancelled) setFileContent(starterCodeRef.current?.[activeFile] || ''); });
    return () => { cancelled = true; };
  }, [activeFile, itemId, courseId]);

  // Reset on item change + abort in-flight AI
  useEffect(() => {
    if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null; }
    setActiveFile('');
    setFileContent('');
    return () => { abortRef.current?.abort(); };
  }, [itemId]);

  const handleEditorChange = (value: string | undefined) => {
    setFileContent(value || '');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!activeFile || !itemId) return;
      apiFetch(`${baseUrl}/file/${activeFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value || '' }),
      }).catch(() => {});
    }, 500);
  };

  const handleCreateFile = (path: string, fileType: 'file' | 'directory') => {
    if (!itemId) return;
    apiFetch(`${baseUrl}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: fileType === 'file' ? '' : undefined, fileType }),
    }).then(reloadTree).catch(() => {});
  };

  const handleRenameFile = (oldPath: string, newPath: string) => {
    if (!itemId) return;
    apiFetch(`${baseUrl}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
    }).then(() => {
      reloadTree();
      if (activeFile === oldPath) setActiveFile(newPath);
    }).catch(() => {});
  };

  const handleDeleteFile = (path: string) => {
    if (!itemId) return;
    apiFetch(`${baseUrl}/file/${path}`, { method: 'DELETE' })
      .then(() => {
        reloadTree();
        if (activeFile === path) { setActiveFile(''); setFileContent(''); }
      }).catch(() => {});
  };

  const handleAIModify = async () => {
    if (!aiModifyInput.trim() || !itemId) return;
    setAiModifying(true);
    setAiModifyResult('');
    try {
      abortRef.current = new AbortController();
      const authInit = await authFetchInit();
      const res = await fetch(`/api/courses/${courseId}/${type}/${itemId}/ai-modify`, {
        method: 'POST',
        headers: authInit.headers,
        body: JSON.stringify({ instruction: aiModifyInput.trim() }),
        signal: abortRef.current.signal,
      });
      await readSSEStream(res, {
        onChunk: (data) => {
          if (data.type === 'summary') setAiModifyResult(data.summary);
        },
        onError: (msg) => {
          setAiModifyResult(`修改失败：${msg}`);
        },
      });
      reloadTree();
    } catch {
      setAiModifyResult('修改失败，请检查 API 设置。');
    }
    setAiModifying(false);
  };

  return {
    fileTree, activeFile, setActiveFile, fileContent, setFileContent,
    handleEditorChange, handleCreateFile, handleRenameFile, handleDeleteFile,
    reloadTree,
    aiModifyOpen, setAiModifyOpen, aiModifyInput, setAiModifyInput,
    aiModifying, setAiModifying, aiModifyResult, setAiModifyResult,
    handleAIModify, findFirstFile,
  };
}
