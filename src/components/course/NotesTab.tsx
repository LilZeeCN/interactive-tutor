import { useState, useEffect } from 'react';
import { FileText, CheckCircle2, Circle, Sparkles, Loader2 } from 'lucide-react';
import { fetchSSEWithRetry } from '../../hooks/useStreamFetch';
import { apiFetch } from '../../lib/api';
import { SyllabusRow } from '../../types';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';

interface NotesTabProps {
  courseId: string;
  syllabus: SyllabusRow[];
  topicNotes: any[];
  onTopicNotesChange?: (notes: any[]) => void;
}

export function NotesTab({ courseId, syllabus, topicNotes, onTopicNotesChange }: NotesTabProps) {
  const [activeTopicNoteId, setActiveTopicNoteId] = useState<string | null>(null);
  const [activeTopicNote, setActiveTopicNote] = useState<any>(null);
  const [generatingNote, setGeneratingNote] = useState(false);

  useEffect(() => {
    if (topicNotes.length > 0 && !activeTopicNoteId) {
      setActiveTopicNoteId(topicNotes[0].topic_id);
    } else if (syllabus.length > 0 && !activeTopicNoteId) {
      setActiveTopicNoteId(syllabus[0].id);
    }
  }, [topicNotes, syllabus, activeTopicNoteId]);

  useEffect(() => {
    if (activeTopicNoteId) {
      apiFetch(`/api/courses/${courseId}/topic-notes/${activeTopicNoteId}`)
        .then(setActiveTopicNote)
        .catch(() => setActiveTopicNote(null));
    } else {
      setActiveTopicNote(null);
    }
  }, [activeTopicNoteId, courseId]);

  const handleGenerateNote = async (topicId: string) => {
    setGeneratingNote(true);
    try {
      await fetchSSEWithRetry(`/api/courses/${courseId}/topic-notes/${topicId}/generate`, {}, {
        onEvent: (data) => {
          if (data.type === 'done') {
            const topic = syllabus.find(s => s.id === topicId);
            const updatedNote = {
              ...(activeTopicNote || {}),
              topic_id: topicId,
              course_id: courseId,
              week: topic?.week,
              topic: topic?.topic,
              content: data.content,
              exercises: data.exercises,
              status: 'generated',
            };
            setActiveTopicNote(updatedNote);
            const exists = topicNotes.some(n => n.topic_id === topicId);
            onTopicNotesChange?.(
              exists
                ? topicNotes.map(n => n.topic_id === topicId ? { ...n, ...updatedNote } : n)
                : [...topicNotes, updatedNote]
            );
          }
        }
      });
    } catch { /* ignore */ }
    setGeneratingNote(false);
  };

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
    <div className="flex gap-6 h-full">
      <div className="w-64 shrink-0 border-r border-white/10 pr-4 overflow-y-auto">
        <h3 className="text-sm font-medium text-white/50 mb-3">主题笔记</h3>
        <div className="space-y-1">
          {syllabus.map((s) => {
            const note = topicNotes.find(n => n.topic_id === s.id);
            const isActive = activeTopicNoteId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveTopicNoteId(s.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white/80"
                )}
              >
                <div className="flex items-center gap-2">
                  {note?.status === 'generated' || note?.status === 'edited' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-white/20 shrink-0" />
                  )}
                  <span className="truncate">第 {s.week} 周：{s.topic}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">
        {activeTopicNote ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleGenerateNote(activeTopicNoteId!)}
                disabled={generatingNote}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 rounded-lg border border-indigo-500/30 disabled:opacity-50 transition-colors"
              >
                {generatingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generatingNote ? '生成中...' : '重新生成'}
              </button>
            </div>
            {activeTopicNote.content && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="prose prose-invert max-w-none prose-headings:font-medium prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-pre:bg-[#0A0A0A] prose-pre:border prose-pre:border-white/10 prose-hr:border-white/10 prose-td:border prose-td:border-white/10 prose-td:px-4 prose-td:py-2 prose-th:border prose-th:border-white/10 prose-th:bg-white/5 prose-th:px-4 prose-th:py-2 prose-blockquote:border-l-indigo-500 prose-blockquote:bg-indigo-500/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-a:text-indigo-400"
              >
                <MarkdownRenderer content={activeTopicNote.content} />
              </motion.div>
            )}
            {activeTopicNote.exercises && (
              <div className="border-t border-white/10 pt-6">
                <h2 className="text-lg font-medium text-white mb-4">课后练习</h2>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="prose prose-invert max-w-none prose-headings:font-medium prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-pre:bg-[#0A0A0A] prose-pre:border prose-pre:border-white/10 prose-hr:border-white/10 prose-td:border prose-td:border-white/10 prose-td:px-4 prose-td:py-2 prose-th:border prose-th:border-white/10 prose-th:bg-white/5 prose-th:px-4 prose-th:py-2 prose-blockquote:border-l-indigo-500 prose-blockquote:bg-indigo-500/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-a:text-indigo-400"
                >
                  <MarkdownRenderer content={activeTopicNote.exercises} />
                </motion.div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Sparkles className="w-10 h-10 text-white/20 animate-pulse" />
            <div className="text-center">
              <p className="text-white/40 text-sm mb-2">该主题尚未生成笔记</p>
              <button
                onClick={() => handleGenerateNote(activeTopicNoteId!)}
                disabled={generatingNote}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 rounded-lg border border-indigo-500/30 disabled:opacity-50 transition-colors"
              >
                {generatingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generatingNote ? '生成中...' : 'AI 生成笔记'}
              </button>
            </div>
            <p className="text-white/20 text-xs">建议在学习 3+ 轮对话后生成，内容会更贴合你的学习情况</p>
          </div>
        )}
      </div>
    </div>
  );
}
