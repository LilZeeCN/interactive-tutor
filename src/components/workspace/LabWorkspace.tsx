import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Clock, Code, TerminalSquare, Bot, MessageSquare, PanelLeftClose, PanelLeftOpen, Play, Sparkles, Loader2, ListChecks, ArrowLeft, Maximize2, Minimize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { sanitizePlugin } from '../../lib/sanitize';
import { FileTree } from './FileTree';
import { EnvironmentStatus } from '../settings/EnvironmentStatus';
import { cn } from '../../lib/utils';
import { markdownComponents } from '../../utils/codeRenderer.tsx';
import { motion } from 'motion/react';
import MonacoEditor from '@monaco-editor/react';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useTerminal } from '../../hooks/useTerminal';
import { fetchSSEWithRetry } from '../../hooks/useStreamFetch';
import { getMonacoLang } from '../../lib/monaco';

import { ResizablePanel } from '../layout/ResizablePanel';
import type { FileNode } from './FileTree';

export function LabWorkspace({ lab, onBack, isInstructionsOpen, onToggleInstructions, courseId }: {
  lab: any; onBack: () => void; isInstructionsOpen: boolean; onToggleInstructions: () => void; courseId: string;
}) {
  const {
    fileTree, activeFile, setActiveFile, fileContent,
    handleEditorChange, handleCreateFile, handleRenameFile, handleDeleteFile,
    aiModifyOpen, setAiModifyOpen, aiModifyInput, setAiModifyInput,
    aiModifying, aiModifyResult, handleAIModify,
  } = useWorkspace('labs', lab?.id, courseId, !!lab?.instructions, lab?.starter_code);

  const { terminalRef, writeToTerminal } = useTerminal('lab', lab?.id ? `lab:${courseId}:${lab.id}` : undefined);
  const terminalKey = lab?.id || 'pending';
  const [hintOpen, setHintOpen] = useState(false);
  const [aiFeedback, setAiFeedback] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [tutorMessages, setTutorMessages] = useState<{role: 'user' | 'assistant'; content: string}[]>([]);
  const [tutorInput, setTutorInput] = useState('');
  const [tutorLoading, setTutorLoading] = useState(false);
  const tutorEndRef = useRef<HTMLDivElement>(null);

  // Fullscreen immersive mode
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const exitFullscreen = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      setIsFullscreen(false);
      setIsExiting(false);
    }, 250);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, exitFullscreen]);

  const handleTutorSend = async () => {
    if (!tutorInput.trim() || tutorLoading) return;
    const question = tutorInput.trim();
    setTutorMessages(prev => [...prev, { role: 'user', content: question }]);
    setTutorInput('');
    setTutorLoading(true);
    try {
      const code = activeFile ? `\n当前打开的文件 ${activeFile}:\n\`\`\`\n${fileContent}\n\`\`\`` : '';
      let full = '';
      setTutorMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      await fetchSSEWithRetry('/api/review', { code, labTitle: lab?.title, instructions: `你是这个实验的AI助教。学生的问题是：${question}\n\n实验标题：${lab?.title}\n实验主题:${lab?.topic}\n\n实验说明：\n${lab?.instructions || '无'}${code}\n\n请用简洁的中文回答，给出具体建议和代码示例。`, courseId, labId: lab?.id }, {
        onChunk: (d) => {
          if (d.type === 'chunk') {
            full += d.content;
            setTutorMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: full };
              return updated;
            });
          }
        },
        onError: (msg) => {
          setTutorMessages(prev => [...prev, { role: 'assistant', content: `请求失败：${msg}` }]);
        },
      });
      setTimeout(() => tutorEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {
      setTutorMessages(prev => [...prev, { role: 'assistant', content: '请求失败，请检查 API 设置。' }]);
    }
    setTutorLoading(false);
  };

  const handleRunTests = () => {
    const testCases = lab?.test_cases || [];
    const commands = testCases
      .filter((tc: any) => tc.command)
      .map((tc: any) => tc.command);
    if (commands.length > 0) {
      writeToTerminal(commands.join(' && '));
    } else {
      writeToTerminal('echo "No test command configured for this lab."');
    }
  };

  const handleSubmitReview = async () => {
    setReviewing(true);
    setAiFeedback('');
    try {
      let fullContent = '';
      await fetchSSEWithRetry('/api/review', { code: fileContent, labTitle: lab?.title, instructions: lab?.instructions, courseId, labId: lab?.id }, {
        onChunk: (d) => {
          if (d.type === 'chunk') {
            fullContent += d.content;
            setAiFeedback(fullContent);
          }
        },
        onError: (msg) => {
          setAiFeedback(`审查失败：${msg}`);
        },
      });
    } catch {
      setAiFeedback('审查失败，请检查 API 设置。');
    }
    setReviewing(false);
  };

  if (!lab) return <div className="flex h-full items-center justify-center"><div className="w-7 h-7 rounded-full bg-white/[0.06] animate-pulse" /></div>;

  const workspaceContent = (
    <motion.div
      initial={isFullscreen ? false : { opacity: 0, y: 10 }}
      animate={isFullscreen ? false : { opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={isFullscreen ? "h-full flex flex-col min-h-0" : "space-y-6 h-full flex flex-col min-h-0"}
    >
      {lab?.instructions && (<>
      {!isFullscreen && (
        <>
          <div className="flex items-start justify-between shrink-0">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <button onClick={onBack} className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors -ml-1.5" aria-label="返回"><ArrowLeft className="w-4 h-4" /></button>
                <span className="px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-widest bg-amber-500/10 text-amber-400 border border-amber-500/20">LAB</span>
                <span className="px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-widest bg-white/5 text-white/60 border border-white/10">{lab.topic}</span>
              </div>
              <h2 className="text-3xl font-medium tracking-tight text-white">{lab.title}</h2>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => isFullscreen ? exitFullscreen() : setIsFullscreen(true)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all duration-200 group",
                  isFullscreen
                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20"
                    : "text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20"
                )}
                title={isFullscreen ? "退出沉浸模式 (ESC)" : "沉浸式编程模式"}
              >
                {isFullscreen
                  ? <Minimize2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  : <Maximize2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                }
                <span className="hidden lg:inline">{isFullscreen ? '退出沉浸' : '沉浸模式'}</span>
              </button>
              <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 px-4 py-2 rounded-lg border border-amber-500/20"><Clock className="w-4 h-4" /><span className="text-sm font-medium">进行中</span></div>
            </div>
          </div>

          <EnvironmentStatus courseId={courseId} />
        </>
      )}

      <div className="flex-1 min-h-0 flex rounded-xl overflow-hidden border border-white/10 shadow-2xl">
        {isInstructionsOpen && (
          <div className="w-[400px] shrink-0 flex flex-col bg-bg-surface border-r border-white/10">
            <div className="flex items-center px-5 py-3 border-b border-white/10 bg-white/[0.02]"><BookOpen className="w-4 h-4 text-emerald-400 mr-2" /><span className="text-sm font-medium text-white/80">实验说明</span></div>
            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-6">
              {lab.instructions ? (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeKatex, sanitizePlugin]} components={markdownComponents}>{lab.instructions}</ReactMarkdown>
                </div>
              ) : (<p className="text-white/50 text-sm">暂无实验说明</p>)}
              {lab.test_cases && lab.test_cases.length > 0 && (<>
                <div className="h-px w-full bg-white/5" />
                <div>
                  <h3 className="flex items-center gap-2 font-medium text-white mb-4"><ListChecks className="w-4 h-4 text-emerald-400" />测试用例</h3>
                  <ul className="space-y-3 text-sm text-white/70">
                    {lab.test_cases.map((tc: any, i: number) => (<li key={i} className="flex items-start gap-2"><div className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /><div><span className="text-white/90 font-medium">{tc.name}</span>{tc.description && <p className="text-white/50 text-xs mt-1">{tc.description}</p>}</div></li>))}
                  </ul>
                </div>
              </>)}
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col bg-bg-surface min-w-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <button onClick={onToggleInstructions} className="p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors" aria-label={isInstructionsOpen ? "收起说明" : "展开说明"}>
                {isInstructionsOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
              <div className="w-px h-4 bg-white/10 mx-1" /><Code className="w-4 h-4 text-indigo-400" />
              <span className="text-sm text-white/80 truncate">{activeFile || '未选择文件'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/40 font-mono">{activeFile.split('.').pop()?.toUpperCase()}</span>
              {isFullscreen && (
                <>
                  <div className="w-px h-4 bg-white/10" />
                  <button
                    onClick={exitFullscreen}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all duration-200 group"
                    title="退出沉浸模式 (ESC)"
                  >
                    <Minimize2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                    <span>退出沉浸</span>
                  </button>
                </>
              )}
            </div>
          </div>
          <ResizablePanel
            top={
              <div className="h-full flex">
                <div className="w-56 shrink-0 flex flex-col border-r border-white/10 bg-bg-base">
                  <FileTree
                    tree={fileTree}
                    activeFile={activeFile}
                    onSelect={setActiveFile}
                    onCreate={handleCreateFile}
                    onRename={handleRenameFile}
                    onDelete={handleDeleteFile}
                  />
                </div>
                <div className="flex-1 min-h-0">
                  <MonacoEditor height="100%" language={getMonacoLang(activeFile)} theme="vs-dark" value={fileContent}
                    options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: 'Menlo, Monaco, "Courier New", monospace', lineNumbers: 'on', scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16 }, renderLineHighlight: 'gutter', unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false } }}
                    onChange={handleEditorChange}
                  />
                </div>
              </div>
            }
            bottom={
              <div className="h-full border-t border-white/10 bg-bg-base flex flex-col">
                <div className="px-4 py-2 border-b border-white/10 text-xs font-medium text-white/50 flex items-center gap-2 bg-white/[0.02]"><TerminalSquare className="w-4 h-4" />终端</div>
                <div ref={terminalRef} key={terminalKey} className="flex-1 min-h-0 p-2 overflow-hidden" />
              </div>
            }
            className="flex-1 min-h-0"
          />
          {hintOpen && (
            <div className="h-72 shrink-0 border-t border-indigo-500/20 bg-bg-surface flex flex-col">
              <div className="px-5 py-2.5 border-b border-indigo-500/20 flex items-center gap-2 bg-white/[0.02]">
                <Bot className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-medium text-indigo-300">AI 助教</span>
                <button onClick={() => setHintOpen(false)} className="ml-auto p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors text-lg leading-none">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
                {tutorMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-white/20 gap-2">
                    <Bot className="w-8 h-8" />
                    <p className="text-xs">遇到问题随时问我，我会根据当前实验帮你分析</p>
                  </div>
                )}
                {tutorMessages.map((msg, i) => (
                  <div key={i} className={cn("text-sm", msg.role === 'user' ? "text-indigo-300 bg-indigo-500/10 rounded-lg px-3 py-2 ml-8" : "text-white/70")}>
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeKatex, sanitizePlugin]} components={markdownComponents}>{msg.content}</ReactMarkdown>
                    ) : msg.content}
                  </div>
                ))}
                <div ref={tutorEndRef} />
              </div>
              <div className="shrink-0 border-t border-white/10 p-2 flex gap-2">
                <input
                  value={tutorInput}
                  onChange={e => setTutorInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTutorSend(); } }}
                  placeholder="输入你的问题..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/40"
                  disabled={tutorLoading}
                />
                <button onClick={handleTutorSend} disabled={tutorLoading || !tutorInput.trim()} className="px-3 py-2 bg-indigo-500/20 text-indigo-300 rounded-lg text-sm hover:bg-indigo-500/30 disabled:opacity-50 transition-colors">
                  {tutorLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
          {aiFeedback && (
            <div className="h-56 shrink-0 border-t border-indigo-500/20 bg-indigo-500/[0.03] flex flex-col">
              <div className="px-5 py-2.5 border-b border-indigo-500/20 flex items-center gap-2 bg-white/[0.02]">
                <Bot className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-medium text-indigo-300">AI 审查</span>
                {!reviewing && <button onClick={() => setAiFeedback('')} className="ml-auto p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors text-lg leading-none">×</button>}
              </div>
              <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                <div className="prose prose-invert prose-sm max-w-none prose-headings:font-medium prose-headings:text-indigo-200 prose-p:text-indigo-200/80 prose-p:leading-relaxed">
                  {reviewing && !aiFeedback && <div className="flex items-center gap-2 text-indigo-300/60"><Loader2 className="w-4 h-4 animate-spin" />审查中...</div>}
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeKatex, sanitizePlugin]} components={markdownComponents}>{aiFeedback}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
          <div className="p-4 border-t border-white/10 bg-bg-surface flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={() => setHintOpen(!hintOpen)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"><Bot className="w-4 h-4" />AI 助教</button>
              <button onClick={() => setAiModifyOpen(!aiModifyOpen)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"><Sparkles className="w-4 h-4" />AI 修改</button>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleRunTests} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors"><Play className="w-4 h-4" />运行本地测试</button>
              <button onClick={handleSubmitReview} className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-black bg-white hover:bg-white/90 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)]"><MessageSquare className="w-4 h-4" />提交给 AI 审查</button>
            </div>
          </div>
          {aiModifyOpen && (
            <div className="shrink-0 border-t border-indigo-500/20 bg-indigo-500/[0.03] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-medium text-indigo-300">AI 修改代码</span>
                <button onClick={() => setAiModifyOpen(false)} className="ml-auto p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors text-lg leading-none">×</button>
              </div>
              <div className="flex gap-2">
                <input
                  value={aiModifyInput}
                  onChange={e => setAiModifyInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleAIModify(); }}
                  placeholder="描述你想要的修改，例如：添加输入验证、修复 bug、添加新功能..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50"
                />
                <button onClick={handleAIModify} disabled={aiModifying || !aiModifyInput.trim()} className="px-5 py-2 rounded-lg text-sm font-medium text-black bg-white hover:bg-white/90 transition-colors disabled:opacity-50 shrink-0">
                  {aiModifying ? '修改中...' : '执行修改'}
                </button>
              </div>
              {aiModifyResult && <p className="mt-2 text-xs text-indigo-300/80">{aiModifyResult}</p>}
            </div>
          )}
        </div>
      </div>
      </>)}
    </motion.div>
  );

  // Fullscreen portal overlay
  if (isFullscreen) {
    return (
      <>
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-white/30">
            <Maximize2 className="w-8 h-8" />
            <span className="text-sm font-mono">沉浸模式已开启</span>
          </div>
        </div>
        {createPortal(
          <div
            className={`fixed inset-0 z-[60] bg-bg-base flex flex-col ${
              isExiting ? 'fullscreen-workspace-exit' : 'fullscreen-workspace-enter'
            }`}
          >
            <div className="flex-1 min-h-0 flex flex-col p-2">
              {workspaceContent}
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return workspaceContent;
}
