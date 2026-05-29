import { MessageSquare, BookOpen, FileText, Code, FolderGit2, Settings, Sparkles, ArrowLeft, GraduationCap, Menu, X } from 'lucide-react';
import { ViewMode } from '../../types';
import { cn } from '../../lib/utils';

interface SidebarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onBackToCourses: () => void;
  courseTitle: string;
  onOpenSettings: () => void;
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ currentView, onViewChange, onBackToCourses, courseTitle, onOpenSettings, open, onToggle }: SidebarProps) {
  const navItems = [
    { id: 'lectures', label: '课程讲义', icon: GraduationCap },
    { id: 'chat', label: 'AI 课堂', icon: MessageSquare },
    { id: 'syllabus', label: '课程大纲', icon: BookOpen },
    { id: 'notes', label: '课后笔记', icon: FileText },
    { id: 'labs', label: '随堂练习', icon: Code },
    { id: 'projects', label: '综合项目', icon: FolderGit2 },
  ] as const;

  const handleNav = (id: ViewMode) => {
    onViewChange(id);
    onToggle(); // close drawer on mobile
  };

  const sidebarContent = (
    <>
      <div className="p-4 md:p-6 flex flex-col gap-4 border-b border-border-default">
        <button
          onClick={onBackToCourses}
          className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm w-fit"
          aria-label="返回课程列表"
        >
          <ArrowLeft className="w-4 h-4" />
          返回课程列表
        </button>
        <div className="flex items-center gap-3 text-white font-medium text-sm tracking-wide">
          <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-black" />
          </div>
          <span className="line-clamp-1" title={courseTitle}>{courseTitle}</span>
        </div>
      </div>

      <div className="px-4 pb-2 mt-4">
        <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-3 px-2">
          学习模块
        </div>
        <nav className="space-y-0.5" role="navigation" aria-label="课程导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                  isActive
                    ? "bg-white/10 text-white font-medium"
                    : "text-white/60 hover:bg-white/[0.04] hover:text-white"
                )}
              >
                <Icon className="w-4 h-4 opacity-80" strokeWidth={isActive ? 2.5 : 2} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-border-default">
        <button onClick={onOpenSettings} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/[0.04] hover:text-white transition-all duration-200" aria-label="设置">
          <Settings className="w-4 h-4 opacity-80" />
          设置
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={onToggle}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-bg-surface border border-border-default text-white/70 hover:text-white md:hidden"
        aria-label="打开导航菜单"
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={onToggle} />
      )}

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-bg-surface flex flex-col h-full border-r border-border-default transform transition-transform duration-200 ease-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden md:flex w-[260px] bg-bg-surface flex-col h-full border-r border-border-default shrink-0">
        {sidebarContent}
      </div>
    </>
  );
}
