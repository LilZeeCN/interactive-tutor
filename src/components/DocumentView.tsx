import { useState, useEffect } from 'react';
import { BookOpen, FileText, Code, FolderGit2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { SyllabusRow, Lab, Project } from '../types';
import { cn } from '../lib/utils';
import { SkeletonText } from './layout/Skeleton';
import { SyllabusTab } from './course/SyllabusTab';
import { LabsTab } from './course/LabsTab';
import { ProjectsTab } from './course/ProjectsTab';
import { NotesTab } from './course/NotesTab';

interface TopicNote {
  id: string;
  topic_id: string;
  course_id: string;
  week: number;
  topic: string;
  content: string;
  exercises: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DocumentViewProps {
  title: string;
  type: 'syllabus' | 'notes' | 'labs' | 'projects';
  courseId: string;
  onNavigate?: (type: 'syllabus' | 'notes' | 'labs' | 'projects', itemId?: string) => void;
  pendingNavId?: string | null;
}

export function DocumentView({ title, type, courseId, onNavigate, pendingNavId }: DocumentViewProps) {
  const [syllabus, setSyllabus] = useState<SyllabusRow[]>([]);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [topicNotes, setTopicNotes] = useState<TopicNote[]>([]);
  const [loading, setLoading] = useState(true);

  const getIcon = () => {
    switch (type) {
      case 'syllabus': return <BookOpen className="w-5 h-5" />;
      case 'notes': return <FileText className="w-5 h-5" />;
      case 'labs': return <Code className="w-5 h-5" />;
      case 'projects': return <FolderGit2 className="w-5 h-5" />;
    }
  };

  // Load data based on type
  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/courses/${courseId}/syllabus`).catch((e) => { console.error('[DocumentView] syllabus fetch failed:', e); return []; }),
      apiFetch(`/api/courses/${courseId}/labs`).catch((e) => { console.error('[DocumentView] labs fetch failed:', e); return []; }),
      apiFetch(`/api/courses/${courseId}/projects`).catch((e) => { console.error('[DocumentView] projects fetch failed:', e); return []; }),
      apiFetch(`/api/courses/${courseId}/topic-notes`).catch((e) => { console.error('[DocumentView] topic-notes fetch failed:', e); return []; }),
    ]).then(([s, l, p, tn]) => {
      console.log('[DocumentView] loaded:', { syllabus: s.length, labs: l.length, projects: p.length, notes: tn.length });
      setSyllabus(s);
      setLabs(l);
      setProjects(p);
      setTopicNotes(tn);
      setLoading(false);
    });
  }, [courseId]);

  if (loading) return (
    <div className="flex flex-col h-full bg-bg-base">
      <div className="shrink-0 h-16 border-b border-white/10 px-8 py-6 flex items-center gap-4">
        <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl animate-pulse" />
        <div className="h-5 w-40 bg-white/[0.06] rounded animate-pulse" />
      </div>
      <div className="flex-1 p-6 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <SkeletonText lines={5} />
          <div className="h-40 bg-white/[0.06] rounded-xl animate-pulse" />
          <SkeletonText lines={3} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-bg-base overflow-hidden">
      <header className="shrink-0 sticky top-0 z-10 bg-bg-base/80 backdrop-blur-xl border-b border-white/10 px-8 py-6">
        <div className={cn("mx-auto flex items-center gap-4", type === 'labs' ? "max-w-[1600px]" : "max-w-5xl")}>
          <div className="p-2.5 bg-white/5 border border-white/10 text-white rounded-xl">
            {getIcon()}
          </div>
          <h1 className="text-xl font-medium text-white tracking-tight">{title}</h1>
        </div>
      </header>

      <div className={cn(
        "flex-1 min-h-0",
        type === 'labs' || type === 'projects'
          ? "overflow-hidden flex flex-col"
          : "overflow-y-auto p-6 md:p-8"
      )}>
        <div className={cn(
          "mx-auto w-full",
          type === 'labs' || type === 'projects'
            ? "max-w-full h-full flex-1 flex flex-col min-h-0"
            : "max-w-5xl"
        )}>
          {type === 'syllabus' && (
            <SyllabusTab
              courseId={courseId}
              syllabus={syllabus}
              onNavigate={onNavigate}
              onSyllabusChange={setSyllabus}
            />
          )}
          {type === 'labs' && (
            <LabsTab
              courseId={courseId}
              labs={labs}
              onLabsChange={setLabs}
            />
          )}
          {type === 'projects' && (
            <ProjectsTab
              courseId={courseId}
              projects={projects}
              onProjectsChange={setProjects}
            />
          )}
          {type === 'notes' && (
            <NotesTab
              courseId={courseId}
              syllabus={syllabus}
              topicNotes={topicNotes}
              onTopicNotesChange={setTopicNotes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
