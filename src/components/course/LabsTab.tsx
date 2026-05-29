import { useState, useEffect, Suspense, lazy } from 'react';
import { Code, CheckCircle2, Clock, Sparkles, Loader2, XCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';

const LazyLabWorkspace = lazy(() =>
  import('../workspace/LabWorkspace').then(m => ({ default: m.LabWorkspace }))
);

interface LabsTabProps {
  courseId: string;
  labs: any[];
  onLabsChange: (labs: any[]) => void;
}

export function LabsTab({ courseId, labs, onLabsChange }: LabsTabProps) {
  const [activeLabId, setActiveLabId] = useState<string | null>(() => {
    try { const s = JSON.parse(sessionStorage.getItem('tutor-nav') || '{}'); return s.labId || null; } catch { return null; }
  });
  const [activeLab, setActiveLab] = useState<any>(null);
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(true);
  const labsRef = { current: labs };
  labsRef.current = labs;

  // Persist activeLabId to sessionStorage
  useEffect(() => {
    if (!activeLabId) return;
    try {
      const s = JSON.parse(sessionStorage.getItem('tutor-nav') || '{}');
      s.labId = activeLabId;
      sessionStorage.setItem('tutor-nav', JSON.stringify(s));
    } catch { /* ignore */ }
  }, [activeLabId]);

  // Load lab detail when activeLabId changes
  useEffect(() => {
    if (!activeLabId) { setActiveLab(null); return; }
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    const loadLab = () => {
      apiFetch(`/api/courses/${courseId}/labs/${activeLabId}`)
        .then(lab => {
          if (cancelled) return;
          setActiveLab(lab);
          if (lab && !lab.instructions && lab.status === 'in-progress') {
            apiFetch(`/api/courses/${courseId}/generate-lab/${activeLabId}`, { method: 'POST' }).catch(() => {});
            let delay = 3000;
            const poll = async () => {
              if (cancelled) return;
              try {
                const updated = await apiFetch(`/api/courses/${courseId}/labs/${activeLabId}`);
                if (cancelled) return;
                if (updated && updated.instructions) {
                  setActiveLab(updated);
                  onLabsChange((labsRef.current || []).map((l: any) => l.id === activeLabId ? updated : l));
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
            try { const s = JSON.parse(sessionStorage.getItem('tutor-nav') || '{}'); delete s.labId; sessionStorage.setItem('tutor-nav', JSON.stringify(s)); } catch {}
            setActiveLab({ id: activeLabId, title: '加载失败', status: 'error' } as any);
          }
        });
    };
    loadLab();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (maxTimer) clearTimeout(maxTimer);
    };
  }, [activeLabId, courseId]);

  // Poll labs list to detect when generating items complete (with exponential backoff)
  useEffect(() => {
    const hasGenerating = labs.some((l: any) => l.status === 'in-progress' && !l.instructions && !(typeof l.instructions === 'string' && l.instructions.includes('"error":true')));
    if (!hasGenerating) return;
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const newLabs = await apiFetch(`/api/courses/${courseId}/labs`);
        onLabsChange(newLabs);
        const stillGenerating = newLabs.some((l: any) => l.status === 'in-progress' && !l.instructions && !(typeof l.instructions === 'string' && l.instructions.includes('"error":true')));
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
  }, [labs, courseId]);

  if (activeLabId && activeLab?.instructions) {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 rounded-full bg-white/[0.06] animate-pulse" /><div className="text-white/30 text-sm font-mono">Loading...</div></div></div>}>
        <LazyLabWorkspace lab={activeLab} onBack={() => setActiveLabId(null)} isInstructionsOpen={isInstructionsOpen} onToggleInstructions={() => setIsInstructionsOpen(!isInstructionsOpen)} courseId={courseId} />
      </Suspense>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6 overflow-y-auto p-6 md:p-8 h-full"
    >
      {labs.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-4 text-white/30">
            <Code className="w-12 h-12" />
            <span className="text-lg font-medium">暂无实验</span>
            <span className="text-sm">点击大纲中的实验链接即可创建并生成</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl font-medium tracking-tight text-white mb-2">随堂练习 (Labs)</h2>
              <p className="text-white/60">通过动手实践巩固理论知识。完成所有练习以解锁最终项目。</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {labs.filter(l => l.status === 'completed').length > 0 && <div className="flex items-center gap-2 text-white/60"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> {labs.filter(l => l.status === 'completed').length} 已完成</div>}
              {labs.filter(l => l.status === 'in-progress').length > 0 && <div className="flex items-center gap-2 text-white/60"><Clock className="w-4 h-4 text-amber-400" /> {labs.filter(l => l.status === 'in-progress').length} 进行中</div>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {labs.map((lab, idx) => {
              const hasContent = !!lab.instructions && !(typeof lab.instructions === 'string' && lab.instructions.includes('"error":true'));
              const hasError = !!lab.instructions && typeof lab.instructions === 'string' && lab.instructions.includes('"error":true');
              const isGenerating = !hasContent && !hasError && lab.status === 'in-progress';
              const isPending = !hasContent && !hasError && lab.status !== 'in-progress';
              return (
              <div
                key={lab.id}
                onClick={() => {
                  if (hasContent) setActiveLabId(lab.id);
                  else if (hasError) {
                    onLabsChange((labsRef.current || []).map((l: any) => l.id === lab.id ? { ...l, instructions: null } : l));
                    apiFetch(`/api/courses/${courseId}/generate-lab/${lab.id}`, { method: 'POST' }).catch(() => {});
                  } else if (isPending) {
                    onLabsChange((labsRef.current || []).map((l: any) => l.id === lab.id ? { ...l, status: 'in-progress' } : l));
                    apiFetch(`/api/courses/${courseId}/generate-lab/${lab.id}`, { method: 'POST' }).catch(() => {});
                  }
                }}
                className={cn(
                  "relative p-5 rounded-xl border transition-all duration-300 flex flex-col h-48",
                  "bg-[#0A0A0A] border-white/10 shadow-lg",
                  hasContent
                    ? "hover:border-amber-500/30 hover:bg-amber-500/[0.02] cursor-pointer group"
                    : hasError
                    ? "opacity-80 cursor-pointer hover:border-red-500/30 border-red-500/20"
                    : isPending
                    ? "opacity-80 cursor-pointer hover:border-amber-500/20 border-dashed border-white/10"
                    : "opacity-60 cursor-not-allowed border-dashed border-white/5"
                )}
              >
                <div className="flex items-start justify-between mb-auto">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-white/40 bg-white/5 px-2 py-1 rounded">Lab {idx + 1}</span>
                    <span className="text-xs text-white/40">{lab.topic}</span>
                  </div>
                  {hasContent && lab.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                  {hasContent && lab.status === 'in-progress' && <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse mt-1.5 mr-1.5" />}
                </div>

                <div>
                  <h3 className="text-lg font-medium mb-2 text-white group-hover:text-amber-400 transition-colors">
                    {lab.title}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-white/40">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {lab.time || '2小时'}</span>
                    {isGenerating && (
                      <span className="flex items-center gap-1.5 text-indigo-400">
                        <Loader2 className="w-3 h-3 animate-spin" /> AI 生成中...
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            apiFetch(`/api/courses/${courseId}/cancel-lab/${lab.id}`, { method: 'POST' })
                              .then(() => onLabsChange((labsRef.current || []).map((l: any) => l.id === lab.id ? { ...l, status: 'pending', instructions: '', starter_code: {}, test_cases: [] } : l)))
                              .catch(() => {});
                          }}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <XCircle className="w-3 h-3" /> 取消
                        </button>
                      </span>
                    )}
                    {isPending && (
                      <span className="flex items-center gap-1.5 text-white/40">
                        已取消
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onLabsChange((labsRef.current || []).map((l: any) => l.id === lab.id ? { ...l, status: 'in-progress' } : l));
                            apiFetch(`/api/courses/${courseId}/generate-lab/${lab.id}`, { method: 'POST' }).catch(() => {});
                          }}
                          className="px-1 py-0.5 text-xs rounded text-amber-400 hover:bg-amber-500/10 transition-colors"
                        >
                          生成
                        </button>
                      </span>
                    )}
                    {hasError && (
                      <span className="flex items-center gap-1 text-red-400">
                        生成失败
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onLabsChange((labsRef.current || []).map((l: any) => l.id === lab.id ? { ...l, instructions: null } : l));
                            apiFetch(`/api/courses/${courseId}/generate-lab/${lab.id}`, { method: 'POST' }).catch(() => {});
                          }}
                          className="px-1 py-0.5 text-xs rounded hover:bg-red-500/10 transition-colors"
                        >
                          重试
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            apiFetch(`/api/courses/${courseId}/labs/${lab.id}`, { method: 'DELETE' }).then(() => {
                              onLabsChange((labsRef.current || []).filter((l: any) => l.id !== lab.id));
                            }).catch(() => {});
                          }}
                          className="px-1 py-0.5 text-xs rounded hover:bg-red-500/10 transition-colors"
                        >
                          删除
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </>
      )}
    </motion.div>
  );
}
