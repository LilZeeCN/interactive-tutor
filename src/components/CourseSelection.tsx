import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, BookOpen, Trash2, X, Sparkles, ArrowRight, Settings, Loader2 } from 'lucide-react';
import { Course } from '../types';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';

interface CourseSelectionProps {
  courses: Course[];
  onSelectCourse: (course: Course) => void;
  onCreateCourse: (course: Omit<Course, 'id' | 'createdAt'>) => Promise<string | null>;
  onDeleteCourse: (id: string) => void;
  onOpenSettings: () => void;
}

export function CourseSelection({ courses, onSelectCourse, onCreateCourse, onDeleteCourse, onOpenSettings }: CourseSelectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCourse, setNewCourse] = useState({
    title: '',
    description: '',
    content: '',
    requirements: '',
    lectureStyle: 'khanmigo' as 'khanmigo' | 'chatgpt-learn' | 'feynman' | 'socratic' | 'first-principles' | 'harvard-tutor',
    lectureFormat: 'markdown' as 'markdown' | 'html'
  });
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const generatingRef = useRef<Set<string>>(new Set());

  // Keep ref in sync
  useEffect(() => { generatingRef.current = generatingIds; }, [generatingIds]);

  // On mount: check ALL existing courses to see which ones are still generating
  useEffect(() => {
    if (courses.length === 0) return;
    let cancelled = false;
    const checkAll = async () => {
      const stillGenerating = new Set<string>();
      const results = await Promise.allSettled(
        courses.map(c => apiFetch<{ done: boolean }>(`/api/courses/${c.id}/generation-status`))
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && !(r as PromiseFulfilledResult<{ done: boolean }>).value.done) {
          stillGenerating.add(courses[i].id);
        }
      }
      if (!cancelled) setGeneratingIds(stillGenerating);
    };
    checkAll();
    return () => { cancelled = true; };
  }, [courses]);

  // Poll generating courses every 3s
  useEffect(() => {
    if (generatingIds.size === 0) return;
    const timer = setInterval(async () => {
      // Use ref to avoid stale closure
      const currentIds = generatingRef.current;
      if (currentIds.size === 0) return;
      const ids = [...currentIds];
      const results = await Promise.allSettled(
        ids.map(id => apiFetch<{ done: boolean }>(`/api/courses/${id}/generation-status`))
      );
      const toRemove: string[] = [];
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<{ done: boolean }>).value.done) {
          toRemove.push(ids[i]);
        }
      }
      if (toRemove.length > 0) {
        setGeneratingIds(prev => {
          const next = new Set(prev);
          for (const id of toRemove) next.delete(id);
          return next;
        });
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [generatingIds]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourse.title.trim()) return;

    const newId = await onCreateCourse(newCourse);
    setIsModalOpen(false);
    setNewCourse({ title: '', description: '', content: '', requirements: '', lectureStyle: 'khanmigo' as const, lectureFormat: 'markdown' as const });

    if (newId) {
      setGeneratingIds((prev) => new Set([...prev, newId]));
    }
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-primary p-8 md:p-16 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="mb-16 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight mb-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-black" />
              </div>
              TUTOR.AI
            </h1>
            <p className="text-white/50 text-lg">选择或创建一个新的课程，开始你的学习之旅。</p>
          </div>
          <div className="flex items-center gap-3">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white/70 font-medium hover:bg-white/10 transition-all"
          >
            <Settings className="w-5 h-5" />
            设置
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-black font-medium hover:bg-white/90 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            <Plus className="w-5 h-5" />
            新建课程
          </button>
          </div>
        </header>

        {courses.length === 0 ? (
          <div className="text-center py-32 border border-white/10 rounded-3xl bg-white/[0.02] border-dashed">
            <BookOpen className="w-16 h-16 mx-auto text-white/20 mb-6" />
            <h2 className="text-2xl font-medium mb-2">暂无课程</h2>
            <p className="text-white/50 mb-8 max-w-md mx-auto">你还没有创建任何课程。点击上方按钮，输入你想学习的内容和要求，让 AI 为你定制专属课程。</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/20 transition-all"
            >
              <Plus className="w-5 h-5" />
              立即创建
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => {
              const isGenerating = generatingIds.has(course.id);
              return (
              <motion.div
                key={course.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "group relative bg-bg-surface border border-white/10 rounded-3xl p-6 transition-all flex flex-col h-[280px]",
                  isGenerating ? "border-amber-500/20 pointer-events-none opacity-70" : "hover:border-white/30 cursor-pointer"
                )}
                onClick={() => !isGenerating && onSelectCourse(course)}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-transform", isGenerating ? "bg-amber-500/10" : "bg-white/5 group-hover:scale-110")}>
                    {isGenerating
                      ? <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                      : <BookOpen className="w-6 h-6 text-white/80" />
                    }
                  </div>
                  {!isGenerating && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCourse(course.id);
                      }}
                      className="p-2 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="删除课程"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <h3 className="text-xl font-semibold mb-2 line-clamp-1">{course.title}</h3>
                <p className="text-sm text-white/50 line-clamp-2 mb-6 flex-1">
                  {course.description || course.content}
                </p>

                <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-white/30">{course.createdAt ? new Date(course.createdAt).toLocaleDateString() : ''}</span>
                    {isGenerating && (
                      <span className="text-xs text-amber-400 font-medium">AI 生成中...</span>
                    )}
                  </div>
                  {!isGenerating && (
                    <div className="flex items-center gap-1 text-sm font-medium text-white/70 group-hover:text-white transition-colors">
                      进入学习 <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  )}
                </div>
              </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Course Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-bg-surface border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-white/10">
                <h2 className="text-xl font-semibold">新建专属课程</h2>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"
                  aria-label="关闭"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">课程名称</label>
                  <input
                    type="text"
                    required
                    value={newCourse.title}
                    onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })}
                    placeholder="例如：高级前端架构设计"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">课程简介 (可选)</label>
                  <input
                    type="text"
                    value={newCourse.description}
                    onChange={(e) => setNewCourse({ ...newCourse, description: e.target.value })}
                    placeholder="一句话描述这个课程的目标"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">学习内容</label>
                  <textarea
                    required
                    value={newCourse.content}
                    onChange={(e) => setNewCourse({ ...newCourse, content: e.target.value })}
                    placeholder="你想学习哪些具体知识点？例如：React 性能优化、微前端架构、SSR 原理..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all min-h-[100px] resize-y"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">课程要求 / 偏好</label>
                  <textarea
                    value={newCourse.requirements}
                    onChange={(e) => setNewCourse({ ...newCourse, requirements: e.target.value })}
                    placeholder="你希望 AI 怎么教你？例如：多提供实战代码，少讲理论；每周学习 5 小时..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all min-h-[100px] resize-y"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-3">讲义讲解风格</label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { id: 'khanmigo' as const, icon: '👨‍🏫', name: 'Khanmigo 导师', desc: '亲切导师坐你旁边，先建立直觉再给定义，穿插思考题' },
                      { id: 'chatgpt-learn' as const, icon: '🤝', name: 'ChatGPT 学习伙伴', desc: '一起探索知识，找 Bug、角色扮演、教你学过的内容' },
                      { id: 'feynman' as const, icon: '🗣️', name: '费曼学习法', desc: '以教代学，用自己的话解释给别人听，发现知识盲区' },
                      { id: 'socratic' as const, icon: '💡', name: '苏格拉底提问', desc: '层层追问引导思考，假设质疑、视角切换、后果推演' },
                      { id: 'first-principles' as const, icon: '🧅', name: '第一性原理', desc: '剥洋葱式拆解到本质，挑战假设，从零重构理解' },
                      { id: 'harvard-tutor' as const, icon: '📊', name: '哈佛高效导师', desc: '即时反馈 + 间隔重复 + 自适应难度，高效掌握知识' },
                    ] as const).map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => setNewCourse({ ...newCourse, lectureStyle: style.id })}
                        className={cn(
                          "relative p-4 rounded-xl border text-left transition-all",
                          newCourse.lectureStyle === style.id
                            ? "border-white/40 bg-white/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        )}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{style.icon}</span>
                          <span className="font-medium text-sm">{style.name}</span>
                        </div>
                        <p className="text-xs text-white/50 leading-relaxed">
                          {style.desc}
                        </p>
                        {newCourse.lectureStyle === style.id && (
                          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-black" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-3">讲义格式</label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { id: 'markdown' as const, icon: '📝', name: 'Markdown', desc: '传统文本格式，稳定可靠，适合所有课程' },
                      { id: 'html' as const, icon: '🎨', name: '交互式 HTML', desc: '带动画、测验、代码编辑器的交互式页面（需 AI 支持 HTML）' },
                    ] as const).map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setNewCourse({ ...newCourse, lectureFormat: fmt.id })}
                        className={cn(
                          "relative p-4 rounded-xl border text-left transition-all",
                          newCourse.lectureFormat === fmt.id
                            ? "border-white/40 bg-white/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        )}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span>{fmt.icon}</span>
                          <span className="font-medium text-sm">{fmt.name}</span>
                        </div>
                        <p className="text-xs text-white/50 leading-relaxed">
                          {fmt.desc}
                        </p>
                        {newCourse.lectureFormat === fmt.id && (
                          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-black" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

              </form>

              <div className="flex justify-end gap-3 p-6 border-t border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-3 rounded-xl font-medium text-white/70 hover:bg-white/10 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => { const form = document.querySelector('form'); if (form) form.requestSubmit(); }}
                  className="px-6 py-3 rounded-xl bg-white text-black font-medium hover:bg-white/90 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)]"
                >
                  生成课程
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
