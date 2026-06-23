import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, TerminalSquare, Sparkles, Play, Bot, GitCommit, Lightbulb, Maximize2, Minimize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { sanitizePlugin } from '../../lib/sanitize';
import { FileTree } from './FileTree';
import { EnvironmentStatus } from '../settings/EnvironmentStatus';
import { markdownComponents } from '../../utils/codeRenderer.tsx';
import { motion } from 'motion/react';
import MonacoEditor from '@monaco-editor/react';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useTerminal } from '../../hooks/useTerminal';
import { fetchSSEWithRetry } from '../../hooks/useStreamFetch';
import { getMonacoLang } from '../../lib/monaco';
import { ResizablePanel } from '../layout/ResizablePanel';
import { cn } from '../../lib/utils';

export function ProjectWorkspace({ project, onBack, courseId }: { project: any; onBack: () => void; courseId: string }) {
  const {
    fileTree, activeFile, setActiveFile, fileContent,
    handleEditorChange, handleCreateFile, handleRenameFile, handleDeleteFile,
    aiModifyOpen, setAiModifyOpen, aiModifyInput, setAiModifyInput,
    aiModifying, aiModifyResult, handleAIModify,
  } = useWorkspace('projects', project?.id, courseId,
    !!(project?.starter_code && (typeof project.starter_code !== 'object' || Object.keys(project.starter_code).length > 0)),
    project?.starter_code
  );
  const { terminalRef, writeToTerminal } = useTerminal('proj', project?.id ? `project:${courseId}:${project.id}` : undefined);
  const terminalKey = project?.id || 'pending';
  const milestones = project?.milestones || [];

  const [submitting, setSubmitting] = useState(false);
  const [milestoneFeedback, setMilestoneFeedback] = useState('');
  const [aiHelpQuery, setAiHelpQuery] = useState('');
  const [aiHelpAnswer, setAiHelpAnswer] = useState('');
  const [helpLoading, setHelpLoading] = useState(false);

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

  const handleSubmitMilestone = async () => {
    setSubmitting(true);
    setMilestoneFeedback('');
    try {
      let fullContent = '';
      const currentMilestone = milestones.find((m: any) => m.status === 'in-progress') || milestones[0];
      const acceptanceHint = currentMilestone
        ? `\n\n当前里程碑：${currentMilestone.title}\n验收标准：${currentMilestone.acceptance || currentMilestone.description || '（未指定）'}`
        : '';
      await fetchSSEWithRetry('/api/review', { code: fileContent, labTitle: project?.title, instructions: `请审查此 Milestone 的完成情况，确认是否达到了验收标准。${acceptanceHint}`, courseId, projectId: project?.id }, {
        onChunk: (d) => {
          if (d.type === 'chunk') { fullContent += d.content; setMilestoneFeedback(fullContent); }
        },
        onError: (msg) => {
          setMilestoneFeedback(`提交失败：${msg}`);
        },
      });
    } catch { setMilestoneFeedback('提交失败，请检查 API 设置。'); }
    setSubmitting(false);
  };

  const askAI = async (query: string, prompt: string) => {
    setHelpLoading(true);
    setAiHelpQuery(query);
    setAiHelpAnswer('');
    try {
      const code = activeFile ? `${activeFile}:\n${fileContent}` : '';
      let full = '';
      await fetchSSEWithRetry('/api/review', { code, labTitle: project?.title, instructions: prompt, courseId, projectId: project?.id }, {
        onChunk: (d) => {
          if (d.type === 'chunk') { full += d.content; setAiHelpAnswer(full); }
        },
        onError: (msg) => {
          setAiHelpAnswer(`请求失败：${msg}`);
        },
      });
    } catch { setAiHelpAnswer('请求失败，请检查 API 设置。'); }
    setHelpLoading(false);
  };

  if (!project) return <div className="flex h-full items-center justify-center"><div className="w-7 h-7 rounded-full bg-white/[0.06] animate-pulse" /></div>;

  const workspaceContent = (
    <motion.div initial={isFullscreen ? false : { opacity: 0, scale: 0.98 }} animate={isFullscreen ? false : { opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="h-full flex flex-col min-h-0">
      {project?.starter_code && (<>
      {!isFullscreen && (
        <>
          <div className="flex items-center justify-between shrink-0 mb-4 min-w-0 gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors" aria-label="返回"><ArrowLeft className="w-5 h-5" /></button>
              <div>
                <div className="flex items-center gap-3 mb-1"><span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">{project?.id?.toUpperCase() || 'PROJECT'}</span></div>
                <h2 className="text-2xl font-medium tracking-tight text-white">{project?.title || '加载中...'}</h2>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
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
              <button onClick={() => setAiModifyOpen(!aiModifyOpen)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors whitespace-nowrap"><Sparkles className="w-4 h-4" />AI 修改</button>
              <button onClick={() => writeToTerminal('npm test 2>&1 || echo "No test script configured"')} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors whitespace-nowrap"><Play className="w-4 h-4" />运行测试用例</button>
              <button onClick={handleSubmitMilestone} disabled={submitting} className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-black bg-white hover:bg-white/90 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)] whitespace-nowrap disabled:opacity-50"><GitCommit className="w-4 h-4" />{submitting ? '提交中...' : '提交 Milestone'}</button>
            </div>
          </div>

          <EnvironmentStatus courseId={courseId} />
        </>
      )}

      <div className="flex-1 min-h-0 min-w-0 flex rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-bg-surface">
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

        <div className="flex-1 flex flex-col min-w-0 border-r border-white/10">
          <div className="flex items-center justify-between px-4 py-3 bg-bg-base border-b border-white/10">
            <span className="text-sm text-white/80 truncate">{activeFile || '未选择文件'}</span>
            {isFullscreen && (
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <button 
                  onClick={() => setAiModifyOpen(!aiModifyOpen)} 
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap",
                    aiModifyOpen 
                      ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" 
                      : "text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border-white/10"
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 修改</span>
                </button>
                <button 
                  onClick={() => writeToTerminal('npm test 2>&1 || echo "No test script configured"')} 
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>运行测试</span>
                </button>
                <button 
                  onClick={handleSubmitMilestone} 
                  disabled={submitting} 
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium text-black bg-white hover:bg-white/90 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <GitCommit className="w-3.5 h-3.5" />
                  <span>{submitting ? '提交中...' : '提交 Milestone'}</span>
                </button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <button
                  onClick={exitFullscreen}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all duration-200 group"
                  title="退出沉浸模式 (ESC)"
                >
                  <Minimize2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                  <span>退出沉浸</span>
                </button>
              </div>
            )}
          </div>
          <ResizablePanel
            top={
              <div className="h-full min-h-0">
                <MonacoEditor height="100%" language={getMonacoLang(activeFile)} theme="vs-dark" value={fileContent}
                  options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: 'Menlo, Monaco, "Courier New", monospace', lineNumbers: 'on', scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16 }, renderLineHighlight: 'gutter', unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false } }}
                  beforeMount={((_editor: any, monaco: any) => {
                    const langs = ['typescript', 'javascript', 'python', 'java', 'go', 'rust', 'cpp', 'c'];
                    for (const lang of langs) {
                      const defaults = monaco?.languages?.[lang]?.defaults;
                      if (defaults?.setDiagnosticsOptions) defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
                    }
                  }) as any}
                  onChange={handleEditorChange}
                />
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
        </div>
        <div className="w-80 shrink-0 flex flex-col bg-bg-surface">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2 text-sm font-medium text-white/80 bg-white/[0.02]"><Sparkles className="w-4 h-4 text-indigo-400" />AI 导师向导</div>
          {aiModifyOpen && (
            <div className="border-b border-indigo-500/20 p-4 space-y-2">
              <input
                value={aiModifyInput}
                onChange={e => setAiModifyInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleAIModify(); }}
                placeholder="描述修改..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50"
              />
              <button onClick={handleAIModify} disabled={aiModifying || !aiModifyInput.trim()} className="w-full px-4 py-2 rounded-lg text-sm font-medium text-black bg-white hover:bg-white/90 transition-colors disabled:opacity-50">
                {aiModifying ? '修改中...' : '执行修改'}
              </button>
              {aiModifyResult && <p className="text-xs text-indigo-300/80">{aiModifyResult}</p>}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
            <div><h3 className="text-white font-medium mb-2">项目目标</h3><p className="text-sm text-white/60 leading-relaxed">{project?.description || '暂无描述'}</p></div>
            {milestones.length > 0 && (
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                <h4 className="flex items-center gap-2 text-sm font-medium text-indigo-400 mb-2"><Lightbulb className="w-4 h-4" />当前里程碑</h4>
                <p className="text-sm text-indigo-200/70">{milestones.find((m: any) => m.status === 'in-progress')?.description || milestones[0]?.description || ''}</p>
              </div>
            )}
            {milestoneFeedback && (
              <div className="border border-indigo-500/20 rounded-xl bg-indigo-500/[0.03] overflow-hidden">
                <div className="px-4 py-2 border-b border-indigo-500/20 flex items-center gap-2 bg-white/[0.02] shrink-0">
                  <Bot className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-medium text-indigo-300">Milestone 审查</span>
                  <button onClick={() => setMilestoneFeedback('')} className="ml-auto text-white/40 hover:text-white text-xs">清除</button>
                </div>
                <div className="max-h-64 overflow-y-auto p-4 prose prose-invert prose-sm max-w-none prose-headings:font-medium prose-headings:text-indigo-200 prose-p:text-indigo-200/80 break-words custom-scrollbar">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeKatex, sanitizePlugin]} components={markdownComponents}>{milestoneFeedback}</ReactMarkdown>
                </div>
              </div>
            )}
            <div className="border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
                <h4 className="text-sm font-medium text-white/80">遇到困难了？</h4>
              </div>
              <div className="p-4">
                {aiHelpAnswer ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-indigo-400">{aiHelpQuery}</span>
                      <button onClick={() => { setAiHelpAnswer(''); setAiHelpQuery(''); }} className="text-xs text-white/40 hover:text-white">返回</button>
                    </div>
                    <div className="max-h-64 overflow-y-auto prose prose-invert prose-sm max-w-none prose-headings:font-medium prose-headings:text-indigo-200 prose-p:text-indigo-200/80 break-words custom-scrollbar">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeKatex, sanitizePlugin]} components={markdownComponents}>{aiHelpAnswer}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button onClick={() => askAI('解释任务目标', `请解释一下当前项目「${project?.title}」的任务目标是什么？当前代码如下：\n\n${activeFile ? `${activeFile}:\n${fileContent}` : ''}`)} disabled={helpLoading} className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white/70 transition-colors disabled:opacity-50">{helpLoading ? '思考中...' : '解释一下当前任务的目标'}</button>
                    <button onClick={() => askAI('审查代码', `请帮我审查以下项目代码，看看哪里有问题：\n\n项目：${project?.title}\n\n${activeFile ? `${activeFile}:\n${fileContent}` : ''}`)} disabled={helpLoading} className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white/70 transition-colors disabled:opacity-50">{helpLoading ? '思考中...' : '帮我看看代码哪里不对'}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
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
