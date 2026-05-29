import { useState, useRef, useEffect } from 'react';
import { BookOpen, CheckCircle2, Circle, Clock, ExternalLink, Sparkles, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { SyllabusRow } from '../../types';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../ui/Toast';

interface SyllabusTabProps {
  courseId: string;
  syllabus: SyllabusRow[];
  onNavigate?: (type: 'syllabus' | 'notes' | 'labs' | 'projects', itemId?: string) => void;
  onSyllabusChange?: (syllabus: SyllabusRow[]) => void;
}

export function SyllabusTab({ courseId, syllabus, onNavigate, onSyllabusChange }: SyllabusTabProps) {
  const { toast } = useToast();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [confirmPopover, setConfirmPopover] = useState<{
    visible: boolean; x: number; y: number;
    assignment: { title: string; type: 'lab' | 'project'; description?: string };
    syllabusRow: { id: string; week: number; topic: string };
  } | null>(null);

  useEffect(() => {
    if (!confirmPopover?.visible) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setConfirmPopover(null);
      }
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('mousedown', handler);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('mousedown', handler);
    };
  }, [confirmPopover?.visible]);

  if (syllabus.length === 0) return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4 text-white/30">
        <Sparkles className="w-12 h-12 animate-pulse" />
        <span className="text-lg font-medium">课程内容正在生成中</span>
        <span className="text-sm">AI 正在为这门课程创建学习材料，请稍后再来查看。</span>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="space-y-8"
    >
      <div className="prose prose-invert max-w-none">
        <h2 className="text-2xl font-medium tracking-tight text-white mb-2">课程大纲</h2>
        <p className="text-white/60 text-sm">
          本教学大纲概述了课程的主题、阅读材料和作业。点击链接即可访问阅读材料和讲义幻灯片。
        </p>
      </div>

      <div className="overflow-x-auto border border-white/10 rounded-xl bg-bg-surface">
        <table className="w-full text-sm text-left">
          <thead className="bg-white/[0.02] border-b border-white/10">
            <tr className="text-white/40 font-mono text-[10px] uppercase tracking-widest">
              <th className="px-6 py-4 font-medium">周次</th>
              <th className="px-6 py-4 font-medium">主题</th>
              <th className="px-6 py-4 font-medium">阅读与资源</th>
              <th className="px-6 py-4 font-medium">作业</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {syllabus.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "transition-colors hover:bg-white/[0.02]",
                  row.status === 'in-progress' ? "bg-indigo-500/[0.02]" : ""
                )}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {row.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-white/30" />}
                    {row.status === 'in-progress' && <Clock className="w-4 h-4 text-indigo-400" />}
                    {row.status === 'pending' && <Circle className="w-4 h-4 text-white/10" />}
                    <span className="font-mono text-white/60">{row.week}</span>
                  </div>
                </td>
                <td className="px-6 py-4 font-medium text-white/90">{row.topic}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-2">
                    {row.readings.map((r, i) => (
                      <a key={i} href={r.url} className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 transition-colors text-sm w-fit group">
                        <span className="underline decoration-indigo-400/30 underline-offset-4 group-hover:decoration-indigo-400">{r.title}</span>
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </a>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-2">
                    {row.assignments.map((a, i) => {
                      const alreadyCreated = !!a.id;
                      const inner = (
                        <div className="flex items-center gap-2 group/assign">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border",
                            a.type === 'lab' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                          )}>
                            {a.type}
                          </span>
                          <span className={cn(
                            "text-sm",
                            a.status === 'completed' ? "text-white/40 line-through" : "text-white/80",
                            "underline decoration-white/20 underline-offset-4 group-hover/assign:decoration-white/50"
                          )}>
                            {a.title}
                          </span>
                          {alreadyCreated
                            ? <ExternalLink className="w-3 h-3 text-white/20 group-hover/assign:text-white/50 shrink-0" />
                            : <Sparkles className="w-3 h-3 text-indigo-400/60 group-hover/assign:text-indigo-400 shrink-0" />
                          }
                        </div>
                      );
                      return (
                        <div
                          key={i}
                          onClick={async (e) => {
                            if (alreadyCreated && a.id) {
                              onNavigate?.(a.type === 'lab' ? 'labs' : 'projects', a.id);
                            } else {
                              const rect = (e.target as HTMLElement).getBoundingClientRect();
                              setConfirmPopover({
                                visible: true,
                                x: rect.left + rect.width / 2,
                                y: rect.bottom + 6,
                                assignment: a,
                                syllabusRow: { id: row.id, week: row.week, topic: row.topic },
                              });
                            }
                          }}
                          className="cursor-pointer"
                        >
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {confirmPopover?.visible && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15 }}
            className="fixed z-50 bg-bg-overlay border border-border-default rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.5)] p-5 w-[280px]"
            style={{ left: confirmPopover.x - 140, top: confirmPopover.y }}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-white/90 mb-0.5">
                  创建{confirmPopover.assignment.type === 'lab' ? '随堂练习' : '综合项目'}
                </p>
                <p className="text-xs text-white/40 leading-relaxed">
                  「{confirmPopover.assignment.title}」将开始 AI 生成
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (!confirmPopover) return;
                  const { assignment, syllabusRow } = confirmPopover;
                  const endpoint = assignment.type === 'lab' ? 'create-lab' : 'create-project';
                  const body = assignment.type === 'lab'
                    ? { syllabusRowId: syllabusRow.id, week: syllabusRow.week, title: assignment.title, topic: syllabusRow.topic }
                    : { syllabusRowId: syllabusRow.id, title: assignment.title, description: assignment.description };
                  setConfirmPopover(null);
                  try {
                    const data = await apiFetch(`/api/courses/${courseId}/${endpoint}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(body),
                    });
                    if (data.success) {
                      toast(`${assignment.type === 'lab' ? '实验' : '项目'}「${assignment.title}」已创建，AI 正在生成内容`);
                      // Navigate to labs/projects tab — don't pass itemId so user sees the list
                      onNavigate?.(assignment.type === 'lab' ? 'labs' : 'projects');
                    } else {
                      toast('创建失败，请稍后重试', 'error');
                    }
                  } catch {
                    toast('网络错误，请检查连接', 'error');
                  }
                }}
                className="flex-1 px-4 py-2.5 bg-white text-black text-[13px] font-medium rounded-xl hover:bg-white/90 transition-all shadow-[0_0_20px_rgba(255,255,255,0.06)]"
              >
                确认创建
              </button>
              <button
                onClick={() => setConfirmPopover(null)}
                className="px-4 py-2.5 bg-white/5 border border-border-default text-white/60 text-[13px] font-medium rounded-xl hover:bg-white/10 hover:text-white/80 transition-all"
              >
                取消
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
