import { useState, useEffect, Suspense, lazy } from 'react';
import { FolderGit2, CheckCircle2, ArrowLeft, ArrowRight, Sparkles, Loader2, Trophy, XCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';

const LazyProjectWorkspace = lazy(() =>
  import('../workspace/ProjectWorkspace').then(m => ({ default: m.ProjectWorkspace }))
);

interface ProjectsTabProps {
  courseId: string;
  projects: any[];
  onProjectsChange: (projects: any[]) => void;
}

export function ProjectsTab({ courseId, projects, onProjectsChange }: ProjectsTabProps) {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    try { const s = JSON.parse(sessionStorage.getItem('tutor-nav') || '{}'); return s.projectId || null; } catch { return null; }
  });
  const [activeProject, setActiveProject] = useState<any>(null);
  const projectsRef = { current: projects };
  projectsRef.current = projects;
  const [activeMilestone, setActiveMilestone] = useState<number | null>(null);

  // Persist activeProjectId to sessionStorage
  useEffect(() => {
    if (!activeProjectId) return;
    try {
      const s = JSON.parse(sessionStorage.getItem('tutor-nav') || '{}');
      s.projectId = activeProjectId;
      sessionStorage.setItem('tutor-nav', JSON.stringify(s));
    } catch { /* ignore */ }
  }, [activeProjectId]);

  // Load project detail when activeProjectId changes
  useEffect(() => {
    if (!activeProjectId) { setActiveProject(null); return; }
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    const loadProject = () => {
      apiFetch(`/api/courses/${courseId}/projects/${activeProjectId}`)
        .then(proj => {
          if (cancelled) return;
          setActiveProject(proj);
          if (proj && proj.status === 'in-progress' && (!proj.starter_code || Object.keys(proj.starter_code).length === 0)) {
            apiFetch(`/api/courses/${courseId}/generate-project/${activeProjectId}`, { method: 'POST' }).catch(() => {});
            let delay = 3000;
            const poll = async () => {
              if (cancelled) return;
              try {
                const updated = await apiFetch(`/api/courses/${courseId}/projects/${activeProjectId}`);
                if (cancelled) return;
                if (updated && updated.starter_code && Object.keys(updated.starter_code).length > 0) {
                  setActiveProject(updated);
                  onProjectsChange((projectsRef.current || []).map((p: any) => p.id === activeProjectId ? updated : p));
                  return;
                }
              } catch { /* retry */ }
              delay = Math.min(delay * 1.5, 10000);
              pollTimer = setTimeout(poll, delay);
            };
            pollTimer = setTimeout(poll, delay);
            maxTimer = setTimeout(() => {
              if (pollTimer) clearTimeout(pollTimer);
              pollTimer = null;
            }, 180000);
          }
        })
        .catch(() => {
          if (!cancelled) {
            try { const s = JSON.parse(sessionStorage.getItem('tutor-nav') || '{}'); delete s.projectId; sessionStorage.setItem('tutor-nav', JSON.stringify(s)); } catch {}
            setActiveProject({ id: activeProjectId, title: '加载失败', status: 'error' } as any);
          }
        });
    };
    loadProject();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (maxTimer) clearTimeout(maxTimer);
    };
  }, [activeProjectId, courseId]);

  // Poll projects list with exponential backoff
  useEffect(() => {
    const hasGenerating = projects.some((p: any) => {
      if (p.status !== 'in-progress') return false;
      if (typeof p.starter_code === 'string' && p.starter_code.includes('"error":true')) return false;
      return !p.starter_code || (typeof p.starter_code === 'object' && Object.keys(p.starter_code).length === 0);
    });
    if (!hasGenerating) return;
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const newProjects = await apiFetch(`/api/courses/${courseId}/projects`);
        onProjectsChange(newProjects);
        const stillGenerating = newProjects.some((p: any) => {
          if (p.status !== 'in-progress') return false;
          if (typeof p.starter_code === 'string' && p.starter_code.includes('"error":true')) return false;
          return !p.starter_code || (typeof p.starter_code === 'object' && Object.keys(p.starter_code).length === 0);
        });
        if (stillGenerating && attempts < 60) {
          const delay = Math.min(3000 * Math.pow(1.3, attempts - 1), 15000);
          setTimeout(poll, delay);
        }
      } catch {
        if (attempts < 60) setTimeout(poll, Math.min(3000 * Math.pow(1.3, attempts - 1), 15000));
      }
    };
    const timer = setTimeout(poll, 3000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, courseId]);

  const hasProjContent = activeProject?.starter_code && typeof activeProject.starter_code === 'object' && Object.keys(activeProject.starter_code).length > 0;
  if (activeMilestone !== null && hasProjContent) return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 rounded-full bg-white/[0.06] animate-pulse" /><div className="text-white/30 text-sm font-mono">Loading...</div></div></div>}>
      <LazyProjectWorkspace project={activeProject} onBack={() => setActiveMilestone(null)} courseId={courseId} />
    </Suspense>
  );

  if (activeProjectId !== null && hasProjContent) {
    const milestones = activeProject?.milestones || [];
    const completedCount = milestones.filter((m: any) => m.status === 'completed').length;
    const progress = milestones.length > 0 ? Math.round((completedCount / milestones.length) * 100) : 0;
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-8 overflow-y-auto p-6 md:p-8 h-full"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setActiveProjectId(null)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors -ml-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-widest bg-purple-500/10 text-purple-400 border border-purple-500/20">
                {activeProject.id.toUpperCase()}
              </span>
            </div>
            <h2 className="text-3xl font-medium tracking-tight text-white">{activeProject.title}</h2>
            <p className="mt-2 text-white/60 max-w-2xl">{activeProject.description}</p>
          </div>
        </div>

        <div className="bg-[#0A0A0A] border border-white/10 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
            <h3 className="font-medium text-white">里程碑</h3>
            <span className="text-xs font-mono text-white/40">已完成 {progress}%</span>
          </div>
          {milestones.length === 0 ? (
            <div className="p-8 text-center text-white/30 text-sm">暂无里程碑</div>
          ) : (
            <div className="divide-y divide-white/5">
              {milestones.map((ms: any, idx: number) => (
                <div
                  key={ms.id || idx}
                  onClick={() => setActiveMilestone(idx)}
                  className={cn(
                    "p-6 flex gap-6 transition-all",
                    "cursor-pointer group hover:bg-indigo-500/[0.03] border-l-2 border-indigo-500/30"
                  )}
                >
                  <div className="shrink-0 mt-1">
                    {ms.status === 'completed' ? (
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                    ) : ms.status === 'in-progress' ? (
                      <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border border-white/20 flex items-center justify-center">
                        <span className="text-xs font-mono text-white/40">{idx + 1}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className={cn("font-medium", ms.status === 'in-progress' ? "text-white group-hover:text-indigo-400 transition-colors" : "text-white")}>
                        {ms.title}
                      </h4>
                      {ms.status === 'in-progress' && (
                        <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded">进行中</span>
                      )}
                    </div>
                    <p className="text-sm text-white/60 mb-2">{ms.description}</p>
                    {ms.acceptance && (
                      <div className="bg-bg-raised border border-white/5 rounded-lg p-3 group-hover:border-indigo-500/30 transition-colors">
                        <span className="text-white/70 text-sm">验收标准：{ms.acceptance}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // Projects list
  if (projects.length === 0) return (
    <div className="flex items-center justify-center h-64 overflow-y-auto p-6 md:p-8">
      <div className="flex flex-col items-center gap-4 text-white/30">
        <FolderGit2 className="w-12 h-12" />
        <span className="text-lg font-medium">暂无项目</span>
        <span className="text-sm">点击大纲中的项目链接即可创建并生成</span>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8 overflow-y-auto p-6 md:p-8 h-full"
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-3xl font-medium tracking-tight text-white mb-2">综合项目 (Projects)</h2>
          <p className="text-white/60">将所学知识融会贯通，构建完整的实际应用。</p>
        </div>
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400 text-sm">
          <Trophy className="w-4 h-4" />
          <span>完成所有项目可获得结课证书</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {projects.map((proj, idx) => {
          const projHasError = typeof proj.starter_code === 'string' && proj.starter_code.includes('"error":true');
          const hasContent = !!(proj.starter_code && typeof proj.starter_code === 'object' && Object.keys(proj.starter_code).length > 0);
          const isGenerating = !hasContent && !projHasError && proj.status === 'in-progress';
          const isPending = !hasContent && !projHasError && proj.status !== 'in-progress';
          return (
          <div
            key={proj.id}
            onClick={() => {
              if (hasContent) setActiveProjectId(proj.id);
              else if (projHasError) {
                onProjectsChange((projectsRef.current || []).map((p: any) => p.id === proj.id ? { ...p, starter_code: null } : p));
                apiFetch(`/api/courses/${courseId}/generate-project/${proj.id}`, { method: 'POST' }).catch(() => {});
              } else if (isPending) {
                onProjectsChange((projectsRef.current || []).map((p: any) => p.id === proj.id ? { ...p, status: 'in-progress' } : p));
                apiFetch(`/api/courses/${courseId}/generate-project/${proj.id}`, { method: 'POST' }).catch(() => {});
              }
            }}
            className={cn(
              "relative p-6 rounded-2xl border transition-all duration-300 flex flex-col md:flex-row gap-6 items-start md:items-center shadow-xl",
              "bg-[#0A0A0A] border-white/10",
              hasContent
                ? "hover:border-purple-500/30 hover:bg-purple-500/[0.02] cursor-pointer group"
                : projHasError
                ? "opacity-80 cursor-pointer hover:border-red-500/30 border-red-500/20"
                : isPending
                ? "opacity-80 cursor-pointer hover:border-purple-500/20 border-dashed border-white/10"
                : "opacity-60 cursor-not-allowed border-dashed border-white/5"
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-3">
                <span className={cn(
                  "px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-widest border",
                  proj.status === 'completed' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  "bg-purple-500/10 text-purple-400 border-purple-500/20"
                )}>
                  Project {idx}
                </span>
                <div className="flex gap-2">
                  {(proj.tags || []).map((tag: string) => (
                    <span key={tag} className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              </div>
              <h3 className="text-xl font-medium mb-2 text-white group-hover:text-purple-400 transition-colors">
                {proj.title}
              </h3>
              <p className="text-sm text-white/50 leading-relaxed line-clamp-2">{proj.description}</p>
            </div>

            <div className="w-full md:w-64 shrink-0 flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60">进度</span>
                <span className={cn("font-mono", proj.progress === 100 ? "text-emerald-400" : "text-purple-400")}>{proj.progress || 0}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-1000", (proj.progress || 0) === 100 ? "bg-emerald-500" : "bg-purple-500")}
                  style={{ width: `${proj.progress || 0}%` }}
                />
              </div>
              {proj.status === 'in-progress' && (
                <div className="mt-2 text-xs font-medium text-purple-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                  继续开发 <ArrowRight className="w-3 h-3" />
                </div>
              )}
              {proj.status === 'completed' && (
                <div className="mt-2 text-xs font-medium text-emerald-400 flex items-center gap-1 justify-end">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 已完成
                </div>
              )}
              {isGenerating && (
                <div className="mt-2 text-xs font-medium text-indigo-400 flex items-center gap-1 justify-end">
                  <Loader2 className="w-3 h-3 animate-spin" /> AI 生成中...
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      apiFetch(`/api/courses/${courseId}/cancel-project/${proj.id}`, { method: 'POST' })
                        .then(() => onProjectsChange((projectsRef.current || []).map((p: any) => p.id === proj.id ? { ...p, status: 'pending', starter_code: {} } : p)))
                        .catch(() => {});
                    }}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <XCircle className="w-3 h-3" /> 取消
                  </button>
                </div>
              )}
              {isPending && (
                <div className="mt-2 text-xs font-medium text-white/40 flex items-center gap-1 justify-end">
                  已取消
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectsChange((projectsRef.current || []).map((p: any) => p.id === proj.id ? { ...p, status: 'in-progress' } : p));
                      apiFetch(`/api/courses/${courseId}/generate-project/${proj.id}`, { method: 'POST' }).catch(() => {});
                    }}
                    className="px-1 py-0.5 rounded text-purple-400 hover:bg-purple-500/10 transition-colors"
                  >
                    生成
                  </button>
                </div>
              )}
              {projHasError && (
                <div className="mt-2 text-xs font-medium text-red-400 flex items-center gap-1 justify-end">
                  生成失败
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectsChange((projectsRef.current || []).map((p: any) => p.id === proj.id ? { ...p, starter_code: null } : p));
                      apiFetch(`/api/courses/${courseId}/generate-project/${proj.id}`, { method: 'POST' }).catch(() => {});
                    }}
                    className="px-1 py-0.5 rounded hover:bg-red-500/10 transition-colors"
                  >
                    重试
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      apiFetch(`/api/courses/${courseId}/projects/${proj.id}`, { method: 'DELETE' }).then(() => {
                        onProjectsChange((projectsRef.current || []).filter((p: any) => p.id !== proj.id));
                      }).catch(() => {});
                    }}
                    className="px-1 py-0.5 rounded hover:bg-red-500/10 transition-colors"
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </motion.div>
  );
}
