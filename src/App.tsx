import { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { DocumentView } from './components/DocumentView';
import { CourseSelection } from './components/course/CourseSelection';
import { SettingsModal } from './components/settings/SettingsModal';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { useToast } from './components/ui/Toast';
import { ViewMode, Course } from './types';
import { apiFetch, setAuthToken } from './lib/api';
import { LoginPage } from './components/ui/LoginPage';
import { LoadingScreen } from './components/layout/LoadingScreen';

// Lazy-loaded heavy components (React.lazy with named-export adapters)
const LazyLectureView = lazy(() =>
  import('./components/lecture/LectureView').then(m => ({ default: m.LectureView }))
);
const LazyChatView = lazy(() =>
  import('./components/chat/ChatView').then(m => ({ default: m.ChatView }))
);

// Shared Suspense fallback
function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-bg-base">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/[0.06] animate-pulse" />
        <div className="text-white/30 text-sm font-mono">Loading...</div>
      </div>
    </div>
  );
}

const STORAGE_KEY = 'tutor-nav';

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

/** Top-level: auth gate + course fetching + routing */
function AppContent() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [authState, setAuthState] = useState<'loading' | 'login' | 'authenticated'>('loading');
  const [authConfigured, setAuthConfigured] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(true);

  // Check auth status on mount
  useEffect(() => {
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setAuthConfigured(data.configured);
        setAuthState('login');
        setLoadingCourses(false);
      })
      .catch(() => {
        setAuthState('login');
        setLoadingCourses(false);
      });
  }, []);

  // Load courses after authentication
  useEffect(() => {
    if (authState !== 'authenticated') return;
    apiFetch('/api/courses')
      .then(data => {
        setCourses(data);
        setLoadingCourses(false);
      })
      .catch(() => setLoadingCourses(false));
  }, [authState]);

  const handleAuth = (token: string) => {
    setAuthToken(token);
    setAuthState('authenticated');
  };

  const handleCreateCourse = async (
    newCourseData: Omit<Course, 'id' | 'createdAt'>
  ): Promise<string | null> => {
    try {
      const newCourse = await apiFetch<Course>('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCourseData),
      });
      setCourses(prev => [newCourse, ...prev]);
      toast('课程创建成功，AI 正在生成大纲');
      // Don't navigate — stay on course list until syllabus is ready
      return newCourse.id;
    } catch {
      toast('课程创建失败，请检查网络连接', 'error');
      return null;
    }
  };

  const handleCourseReady = (courseId: string) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ courseId }));
    } catch { /* ignore */ }
    navigate(`/courses/${courseId}/lectures`);
  };

  const handleDeleteCourse = async (id: string) => {
    try {
      await apiFetch(`/api/courses/${id}`, { method: 'DELETE' });
      setCourses(prev => prev.filter(c => c.id !== id));
      toast('课程已删除');
    } catch {
      toast('删除失败，请重试', 'error');
    }
  };

  const handleSelectCourse = (course: Course) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ courseId: course.id }));
    } catch { /* ignore */ }
    navigate(`/courses/${course.id}/lectures`);
  };

  // Auth loading state
  if (authState === 'loading' || (authState === 'authenticated' && loadingCourses)) {
    return <LoadingScreen />;
  }

  // Login gate
  if (authState === 'login') {
    return <LoginPage configured={authConfigured} onAuth={handleAuth} />;
  }

  return (
    <>
      <Routes>
        <Route
          path="/courses"
          element={
            <CourseSelection
              courses={courses}
              onSelectCourse={handleSelectCourse}
              onCreateCourse={handleCreateCourse}
              onDeleteCourse={handleDeleteCourse}
              onOpenSettings={() => setShowSettings(true)}
              onCourseReady={handleCourseReady}
            />
          }
        />
        <Route
          path="/courses/:courseId/*"
          element={
            <CourseLayout
              courses={courses}
              onDeleteCourse={handleDeleteCourse}
              onOpenSettings={() => setShowSettings(true)}
            />
          }
        />
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}

/** Layout wrapper for course detail views — sidebar + nested routes */
function CourseLayout({
  courses,
  onDeleteCourse: _onDeleteCourse,
  onOpenSettings,
}: {
  courses: Course[];
  onDeleteCourse: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const course = courses.find(c => c.id === courseId);

  // Derive active tab from URL path
  const currentView: ViewMode = (() => {
    const path = location.pathname;
    if (path.endsWith('/chat')) return 'chat';
    if (path.endsWith('/syllabus')) return 'syllabus';
    if (path.endsWith('/notes')) return 'notes';
    if (path.endsWith('/labs')) return 'labs';
    if (path.endsWith('/projects')) return 'projects';
    return 'lectures';
  })();

  // Persist courseId to sessionStorage so returning users land back here
  useEffect(() => {
    if (courseId) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ courseId }));
      } catch { /* ignore */ }
    }
  }, [courseId]);

  if (!course) {
    return <Navigate to="/courses" replace />;
  }

  const handleViewChange = (view: ViewMode) => {
    setSidebarOpen(false);
    navigate(`/courses/${courseId}/${view}`);
  };

  const handleBackToCourses = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    navigate('/courses');
  };

  /** Cross-view navigation (e.g. syllabus → labs) — also stashes item id in sessionStorage */
  const handleNavigate = (type: ViewMode, itemId?: string) => {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
      if (itemId) {
        if (type === 'labs') s.labId = itemId;
        else if (type === 'projects') s.projectId = itemId;
      } else {
        // Clear any previously stashed item id so tab shows list, not auto-opens a specific item
        delete s.labId;
        delete s.projectId;
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch { /* ignore */ }
    navigate(`/courses/${courseId}/${type}`);
  };

  return (
    <div className="flex h-screen w-full bg-bg-base text-text-primary overflow-hidden font-sans selection:bg-white/20">
      <ErrorBoundary>
        <Sidebar
          currentView={currentView}
          onViewChange={handleViewChange}
          onBackToCourses={handleBackToCourses}
          courseTitle={course.title}
          onOpenSettings={onOpenSettings}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(prev => !prev)}
        />
      </ErrorBoundary>
      <main className="flex-1 relative z-10 flex flex-col min-w-0 overflow-hidden">
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* /courses/:courseId → redirect to lectures */}
              <Route index element={<Navigate to="lectures" replace />} />
              <Route path="lectures" element={<LazyLectureView courseId={courseId!} />} />
              <Route path="chat" element={<LazyChatView courseId={courseId!} />} />
              <Route
                path="syllabus"
                element={
                  <DocumentView
                    key="syllabus"
                    title="课程大纲 (Syllabus)"
                    type="syllabus"
                    courseId={courseId!}
                    onNavigate={handleNavigate}
                  />
                }
              />
              <Route
                path="notes"
                element={<DocumentView key="notes" title="课后笔记 (Notes)" type="notes" courseId={courseId!} />}
              />
              <Route
                path="labs"
                element={<DocumentView key="labs" title="随堂练习 (Labs)" type="labs" courseId={courseId!} />}
              />
              <Route
                path="projects"
                element={<DocumentView key="projects" title="综合项目 (Projects)" type="projects" courseId={courseId!} />}
              />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
