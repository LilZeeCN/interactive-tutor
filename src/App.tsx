import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { DocumentView } from './components/DocumentView';
import { LectureView } from './components/LectureView';
import { CourseSelection } from './components/CourseSelection';
import { SettingsModal } from './components/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useToast } from './components/Toast';
import { ViewMode, Course } from './types';
import { apiFetch } from './lib/api';

const STORAGE_KEY = 'tutor-nav';

function loadNavState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveNavState(state: { courseId?: string; view?: ViewMode; labId?: string; projectId?: string }) {
  try {
    const prev = loadNavState() || {};
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...state }));
  } catch {}
}

export default function App() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentCourse, setCurrentCourse] = useState<Course | null>(null);
  const [currentView, setCurrentView] = useState<ViewMode>('lectures');
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingLabId, setPendingLabId] = useState<string | null>(null);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const restoredRef = useRef(false);

  // Load courses from backend on mount
  useEffect(() => {
    apiFetch('/api/courses')
      .then(data => {
        setCourses(data);

        // Restore navigation state from sessionStorage
        const saved = loadNavState();
        if (saved?.courseId && !restoredRef.current) {
          restoredRef.current = true;
          const course = data.find((c: Course) => c.id === saved.courseId);
          if (course) {
            setCurrentCourse(course);
            if (saved.view) setCurrentView(saved.view);
            if (saved.labId || saved.projectId) {
              if (saved.labId) setPendingLabId(saved.labId);
              if (saved.projectId) setPendingProjectId(saved.projectId);
            }
          }
        }

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Persist courseId and view on change
  useEffect(() => {
    if (currentCourse) {
      saveNavState({ courseId: currentCourse.id, view: currentView });
    }
  }, [currentCourse, currentView]);

  const handleCreateCourse = async (newCourseData: Omit<Course, 'id' | 'createdAt'>): Promise<string | null> => {
    try {
      const newCourse = await apiFetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCourseData),
      });
      setCourses(prev => [newCourse, ...prev]);
      toast('课程创建成功，AI 正在生成大纲');
      return newCourse.id;
    } catch {
      toast('课程创建失败，请检查网络连接', 'error');
      return null;
    }
  };

  const handleDeleteCourse = async (id: string) => {
    try {
      await apiFetch(`/api/courses/${id}`, { method: 'DELETE' });
      setCourses(prev => prev.filter(c => c.id !== id));
      if (currentCourse?.id === id) {
        setCurrentCourse(null);
        sessionStorage.removeItem(STORAGE_KEY);
      }
      toast('课程已删除');
    } catch {
      toast('删除失败，请重试', 'error');
    }
  };

  const handleBackToCourses = () => {
    setCurrentCourse(null);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full bg-bg-base text-text-primary items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/[0.06] animate-pulse" />
          <div className="text-white/30 text-sm font-mono">Loading...</div>
        </div>
      </div>
    );
  }

  if (!currentCourse) {
    return (
      <>
        <CourseSelection
          courses={courses}
          onSelectCourse={(course) => {
            setCurrentCourse(course);
            setCurrentView('lectures');
          }}
          onCreateCourse={handleCreateCourse}
          onDeleteCourse={handleDeleteCourse}
          onOpenSettings={() => setShowSettings(true)}
        />
        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </>
    );
  }

  const handleNavigate = (type: ViewMode, itemId?: string) => {
    setCurrentView(type);
    // Clear both pending IDs on any navigation, set the relevant one
    setPendingLabId(null);
    setPendingProjectId(null);
    if (itemId) {
      if (type === 'labs') setPendingLabId(itemId);
      else if (type === 'projects') setPendingProjectId(itemId);
    }
  };

  const renderContent = () => {
    switch (currentView) {
      case 'chat':
        return <ChatView key="chat" courseId={currentCourse.id} />;
      case 'lectures':
        return <LectureView key="lectures" courseId={currentCourse.id} />;
      case 'syllabus':
        return <DocumentView key="syllabus" title="课程大纲 (Syllabus)" type="syllabus" courseId={currentCourse.id} onNavigate={handleNavigate} />;
      case 'notes':
        return <DocumentView key="notes" title="课后笔记 (Notes)" type="notes" courseId={currentCourse.id} />;
      case 'labs':
        return <DocumentView key="labs" title="随堂练习 (Labs)" type="labs" courseId={currentCourse.id} pendingNavId={pendingLabId} />;
      case 'projects':
        return <DocumentView key="projects" title="综合项目 (Projects)" type="projects" courseId={currentCourse.id} pendingNavId={pendingProjectId} />;
      default:
        return <ChatView key="chat-default" courseId={currentCourse.id} />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-bg-base text-text-primary overflow-hidden font-sans selection:bg-white/20">
      <ErrorBoundary>
        <Sidebar
          currentView={currentView}
          onViewChange={(v) => { setCurrentView(v); setSidebarOpen(false); }}
          onBackToCourses={handleBackToCourses}
          courseTitle={currentCourse.title}
          onOpenSettings={() => setShowSettings(true)}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(prev => !prev)}
        />
      </ErrorBoundary>
      <main className="flex-1 relative z-10 flex flex-col min-w-0 overflow-hidden">
        <ErrorBoundary>
          {renderContent()}
        </ErrorBoundary>
      </main>
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
