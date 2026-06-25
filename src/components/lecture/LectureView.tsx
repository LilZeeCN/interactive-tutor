import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, Loader2, MessageSquare,
  ArrowUp, Sparkles, User, X, Brain, CheckCircle2,
  History, Download, RotateCcw, Square
} from 'lucide-react';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';
import { SkeletonArticle } from '../layout/Skeleton';
import { fetchSSEWithRetry } from '../../hooks/useStreamFetch';
import { ReconnectingIndicator } from '../layout/ReconnectingIndicator';
import { cn } from '../../lib/utils';
import { apiFetch, authFetchInit } from '../../lib/api';
import { Message, LectureSection } from '../../types';

interface LectureViewProps {
  courseId: string;
}

// Group sections by chapter
function groupByChapter(sections: LectureSection[]) {
  const chapters: Record<number, {
    chapterNum: number;
    chapterTitle: string;
    sections: LectureSection[];
  }> = {};

  for (const s of sections) {
    if (!chapters[s.chapter_num]) {
      const parts = s.title.split(' / ');
      chapters[s.chapter_num] = {
        chapterNum: s.chapter_num,
        chapterTitle: parts[0] || `第${s.chapter_num}章`,
        sections: [],
      };
    }
    chapters[s.chapter_num].sections.push(s);
  }

  return Object.values(chapters).sort((a, b) => a.chapterNum - b.chapterNum);
}

export function LectureView({ courseId }: LectureViewProps) {
  const [sections, setSections] = useState<LectureSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [generatingChapters, setGeneratingChapters] = useState<Set<number>>(new Set());
  const [pendingChapter, setPendingChapter] = useState<number | null>(null);
  const [chapterToCancel, setChapterToCancel] = useState<number | null>(null);

  // AI Chat state
  const [showChat, setShowChat] = useState(false);
  const [chatTopicId, setChatTopicId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  const activeSection = useMemo(() => sections.find(s => s.id === activeSectionId), [sections, activeSectionId]);
  const chapters = useMemo(() => groupByChapter(sections), [sections]);

  // A chapter counts as "generated" only when ALL its sections have content.
  // Using every() (not some()) ensures partially-generated chapters (e.g. some
  // sections are still pending/empty) still surface the generate entry, so users
  // can fill in the missing sections instead of getting stuck with no button.
  const isChapterGenerated = (chapterNum: number) => {
    const ch = chapters.find(c => c.chapterNum === chapterNum);
    if (!ch) return false;
    return ch.sections.every(s => s.content && s.content.length > 50);
  };

  const isChapterGenerating = (chapterNum: number) => {
    return generatingChapters.has(chapterNum) || sections.some(s => s.chapter_num === chapterNum && s.status === 'generating');
  };

  // Progress tracking
  const [progress, setProgress] = useState<Record<string, { status: string; time_spent_seconds: number }>>({});
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [showNavDrawer, setShowNavDrawer] = useState(false);

  // Load progress data
  const loadProgress = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>(`/api/courses/${courseId}/progress`);
      const map: Record<string, { status: string; time_spent_seconds: number }> = {};
      for (const row of data) {
        map[`${row.chapter_num}-${row.section_num}`] = { status: row.status, time_spent_seconds: row.time_spent_seconds };
      }
      setProgress(map);
    } catch { /* ignore */ }
  }, [courseId]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  // Heartbeat: report reading time every 30s
  useEffect(() => {
    if (!activeSection) {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      return;
    }
    heartbeatRef.current = setInterval(() => {
      apiFetch(`/api/courses/${courseId}/progress/heartbeat`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter_num: activeSection.chapter_num, section_num: activeSection.section_num }),
      }).catch(() => {});
    }, 30_000);
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [activeSection, courseId]);

  // Reset scroll position of content area when active section changes
  useEffect(() => {
    if (contentAreaRef.current) {
      contentAreaRef.current.scrollTop = 0;
    }
  }, [activeSectionId]);

  // Mark section as completed
  const markCompleted = async () => {
    if (!activeSection) return;
    await apiFetch(`/api/courses/${courseId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_num: activeSection.chapter_num, section_num: activeSection.section_num, status: 'completed' }),
    });
    loadProgress();
  };

  // Version history
  const loadVersions = async () => {
    if (!activeSection) return;
    const data = await apiFetch<any[]>(`/api/courses/${courseId}/lectures/${activeSection.id}/versions`);
    setVersions(data);
    setShowVersionHistory(true);
  };

  const restoreVersion = async (versionId: string) => {
    if (!activeSection) return;
    await apiFetch(`/api/courses/${courseId}/lectures/${activeSection.id}/versions/${versionId}/restore`, { method: 'POST' });
    setShowVersionHistory(false);
    // Reload section content
    const updated = await apiFetch<any>(`/api/courses/${courseId}/lectures/${activeSection.id}`);
    setSections(prev => prev.map(s => s.id === activeSection.id ? { ...s, content: updated.content } : s));
  };

  const saveVersion = async () => {
    if (!activeSection) return;
    const result = await apiFetch(`/api/courses/${courseId}/lectures/${activeSection.id}/versions/save`, { method: 'POST' });
    loadVersions();
  };

  // Export markdown
  const exportMarkdown = async (chapterNum?: number) => {
    const url = chapterNum
      ? `/api/courses/${courseId}/export/lectures?chapter=${chapterNum}`
      : `/api/courses/${courseId}/export/lectures?chapter=all`;
    try {
      const { headers } = await authFetchInit();
      headers.delete('Content-Type');
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = chapterNum ? `第${chapterNum}章讲义.md` : '课程讲义.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('[lectures] Export failed:', err);
    }
  };

  // Load sections
  const loadSections = useCallback(async () => {
    try {
      const data = await apiFetch<LectureSection[]>(`/api/courses/${courseId}/lectures`);
      setSections(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { loadSections(); }, [loadSections]);

  useEffect(() => {
    const generatingChapterNums = new Set(
      sections.filter(s => s.status === 'generating').map(s => s.chapter_num)
    );
    setGeneratingChapters(prev => {
      const next = new Set<number>();
      for (const chapterNum of prev) {
        if (generatingChapterNums.has(chapterNum)) next.add(chapterNum);
      }
      for (const chapterNum of generatingChapterNums) next.add(chapterNum);
      if (next.size === prev.size && [...next].every(chapterNum => prev.has(chapterNum))) return prev;
      return next;
    });
  }, [sections]);

  useEffect(() => {
    if (!sections.some(s => s.status === 'generating')) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadSections();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [sections, loadSections]);

  // Cleanup all pending poll timeouts on unmount
  useEffect(() => {
    return () => {
      for (const t of pollTimeoutsRef.current) clearTimeout(t);
      pollTimeoutsRef.current = [];
    };
  }, []);

  // Open a section for reading (no auto-generation)
  const openSection = (section: LectureSection) => {
    setActiveSectionId(section.id);
    setShowChat(false);
    setShowVersionHistory(false);
    setVersions([]);
  };

  // Generate all sections for a chapter
  const generateChapter = async (chapterNum: number) => {
    setGeneratingChapters(prev => new Set(prev).add(chapterNum));
    setSections(prev => prev.map(s =>
      s.chapter_num === chapterNum && !(s.content && s.content.length > 50)
        ? { ...s, status: 'generating' }
        : s
    ));

    try {
      await apiFetch(`/api/courses/${courseId}/lectures/generate-chapter/${chapterNum}`, { method: 'POST' });

      // Poll until all sections in chapter are done (exponential backoff)
      let attempts = 0;
      const poll = async () => {
        attempts++;
        try {
          const updated = await apiFetch<LectureSection[]>(`/api/courses/${courseId}/lectures`);
          setSections(updated);

          const chapterSections = updated.filter(s => s.chapter_num === chapterNum);
          const allDone = chapterSections.every(s => s.status === 'done');
          const anyError = chapterSections.some(s => s.status === 'error');
          const anyGenerating = chapterSections.some(s => s.status === 'generating');

          if (allDone || anyError) {
            setGeneratingChapters(prev => { const n = new Set(prev); n.delete(chapterNum); return n; });
          } else if (attempts < 60) {
            const delay = Math.min(3000 * Math.pow(1.3, attempts - 1), 15000);
            pollTimeoutsRef.current.push(setTimeout(poll, delay));
          } else {
            setGeneratingChapters(prev => { const n = new Set(prev); n.delete(chapterNum); return n; });
          }
        } catch {
          if (attempts < 60) {
            const delay = Math.min(3000 * Math.pow(1.3, attempts - 1), 15000);
            pollTimeoutsRef.current.push(setTimeout(poll, delay));
          }
        }
      };
      pollTimeoutsRef.current.push(setTimeout(poll, 3000));
    } catch {
      setGeneratingChapters(prev => { const n = new Set(prev); n.delete(chapterNum); return n; });
    }
  };

  const retrySection = async (section: LectureSection) => {
    setSections(prev => prev.map(s =>
      s.id === section.id ? { ...s, status: 'generating', content: '' } : s
    ));
    await generateChapter(section.chapter_num);
  };

  // Open AI chat for current section
  const openChat = async () => {
    if (!activeSection) return;

    // Show the chat panel immediately to provide instant visual feedback
    setShowChat(true);

    // Find or create a topic for this section
    try {
      const topics = await apiFetch<any[]>(`/api/chat/topics?courseId=${courseId}`);
      const sectionTitle = (activeSection.title.split('/').pop() || activeSection.title).trim();
      const targetTitleWithNum = `${activeSection.section_num} ${sectionTitle}`.trim();
      const existingTopic = topics.find((t: any) => {
        const tTitle = t.title.trim();
        return tTitle === sectionTitle || tTitle === targetTitleWithNum;
      });

      if (existingTopic) {
        setChatTopicId(existingTopic.id);
        try {
          const msgs = await apiFetch(`/api/chat/topics/${existingTopic.id}/messages?limit=50`);
          setChatMessages(msgs.messages || (Array.isArray(msgs) ? msgs : []));
        } catch (err) {
          console.error('Failed to fetch chat messages:', err);
          setChatMessages([]);
        }
      } else {
        try {
          const topic = await apiFetch('/api/chat/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              courseId,
              title: targetTitleWithNum,
              type: 'lecture',
            }),
          });
          setChatTopicId(topic.id);
          setChatMessages([]);
        } catch (err) {
          console.error('Failed to create chat topic:', err);
        }
      }
    } catch (err) {
      console.error('Failed in openChat:', err);
    }
  };

  // Send chat message
  const handleChatSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatInput.trim() || sendingRef.current || chatStreaming || !chatTopicId) return;
    sendingRef.current = true;

    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date(),
    };
    
    const streamMsgId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    setChatMessages(prev => [
      ...prev,
      userMsg,
      {
        id: streamMsgId,
        role: 'tutor',
        content: '',
        timestamp: new Date(),
      }
    ]);
    
    setChatInput('');
    setChatStreaming(true);

    try {
      abortRef.current = new AbortController();

      let fullContent = '';
      let fullReasoning = '';

      await fetchSSEWithRetry('/api/chat', { topicId: chatTopicId, message: userMsg.content }, {
        onEvent: (data) => {
          if (data.type === 'chunk') {
            const kind = data.kind || 'content';
            if (kind === 'reasoning') {
              fullReasoning += data.content;
            } else {
              fullContent += data.content;
            }
            const cc = fullContent;
            const cr = fullReasoning;
            setChatMessages(prev => prev.map(m =>
              m.id === streamMsgId ? { ...m, content: cc, reasoningContent: cr || undefined, deepSolvePhase: undefined } : m
            ));
          } else if (data.type === 'done') {
            setChatMessages(prev => prev.map(m =>
              m.id === streamMsgId ? { ...m, id: data.id } : m
            ));
          } else if (data.type === 'interrupted') {
            setChatMessages(prev => prev.map(m =>
              m.id === streamMsgId ? { ...m, id: data.id } : m
            ));
          } else if (data.type === 'deep_solve') {
            setChatMessages(prev => prev.map(m =>
              m.id === streamMsgId ? { ...m, deepSolvePhase: data.phase, deepSolveMessage: data.message, deepSolveData: data } : m
            ));
          }
        },
        onError: () => {
          setChatMessages(prev => {
            const streamMsg = prev.find(m => m.id === streamMsgId);
            if (streamMsg?.content) return prev;
            return prev.map(m =>
              m.id === streamMsgId ? { ...m, content: 'AI 服务暂时不可用，请稍后再试。' } : m
            );
          });
        },
        onReconnecting: () => { setReconnecting(true); },
      }, { signal: abortRef.current.signal });
    } catch {
      // ignore
    } finally {
      setChatStreaming(false);
      setReconnecting(false);
      sendingRef.current = false;
      abortRef.current = null;
    }
  };

  // Auto-scroll chat messages
  useEffect(() => {
    if (showChat && chatMessages.length > 0) {
      const el = chatMessagesContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [chatMessages, showChat, chatStreaming]);

  const toggleChapter = (chapterNum: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterNum)) next.delete(chapterNum);
      else next.add(chapterNum);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex h-full bg-bg-base">
        <div className="w-72 shrink-0 border-r border-white/10">
          <div className="h-16 border-b border-white/10 px-5 flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-4 w-20 bg-white/[0.06] rounded animate-pulse" />
          </div>
          <div className="p-3 space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i}>
                <div className="h-9 bg-white/[0.06] rounded-lg animate-pulse mb-1" />
                <div className="ml-5 space-y-1.5">
                  <div className="h-8 bg-white/[0.04] rounded animate-pulse" />
                  <div className="h-8 bg-white/[0.04] rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <SkeletonArticle />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-bg-base overflow-hidden">
      <ReconnectingIndicator show={reconnecting} />

      {/* Left: Chapter/Section Navigation */}
      <div className={cn(
        "md:flex w-72 shrink-0 border-r border-white/10 flex-col bg-bg-surface z-30",
        showNavDrawer ? "flex absolute inset-y-0 left-0" : "hidden"
      )}>
        <div className="h-16 flex items-center px-5 border-b border-white/10 shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span className="text-[13px] font-medium text-white/80 uppercase tracking-wider">课程讲义</span>
          </div>
          <button
            onClick={() => setShowNavDrawer(false)}
            className="p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors md:hidden"
            aria-label="关闭导航"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {chapters.length === 0 && (
            <div className="text-center text-white/30 text-xs py-8">
              讲义生成中，请稍候...
              <Loader2 className="w-4 h-4 animate-spin mx-auto mt-2" />
            </div>
          )}
          {chapters.map(ch => {
            const generated = isChapterGenerated(ch.chapterNum);
            const generating = isChapterGenerating(ch.chapterNum);
            return (
            <div key={ch.chapterNum} className="mb-1">
              {/* Chapter Header */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (generating) {
                      // Just toggle expand/collapse while generating
                      toggleChapter(ch.chapterNum);
                      setPendingChapter(null);
                    } else if (!generated) {
                      if (expandedChapters.has(ch.chapterNum)) {
                        toggleChapter(ch.chapterNum);
                        setPendingChapter(null);
                      } else {
                        toggleChapter(ch.chapterNum);
                        setPendingChapter(ch.chapterNum);
                      }
                    } else {
                      toggleChapter(ch.chapterNum);
                    }
                  }}
                  className={cn(
                    "flex-1 flex items-center gap-2 px-3 py-2.5 text-left rounded-lg transition-colors",
                    !generated && !generating ? "hover:bg-amber-500/5 cursor-pointer" : "hover:bg-white/5"
                  )}
                >
                  {expandedChapters.has(ch.chapterNum) ? (
                    <ChevronDown className="w-3.5 h-3.5 text-white/40 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-white/40 shrink-0" />
                  )}
                  <span className="text-[13px] font-medium text-white/70 truncate">
                    第{ch.chapterNum}章 · {ch.chapterTitle}
                  </span>
                </button>
                {generating && (
                  <div className="flex items-center gap-1 mr-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setChapterToCancel(ch.chapterNum);
                      }}
                      className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                      aria-label="取消生成"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Sections */}
              {expandedChapters.has(ch.chapterNum) && (
                <div className="ml-2 pl-3 border-l border-white/[0.06]">
                  {ch.sections.map(s => {
                    const isActive = activeSectionId === s.id;
                    const sectionTitle = s.title.split(' / ').pop() || s.title;
                    const hasContent = s.content && s.content.length > 50;
                    const isSectionGenerating = s.status === 'generating';
                    const isSectionError = s.status === 'error';
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "w-full rounded-lg text-[13px] transition-all flex items-center gap-1",
                          isActive && hasContent
                            ? "bg-emerald-500/10 text-emerald-400"
                            : hasContent
                              ? "text-white/50 hover:bg-white/5 hover:text-white/80"
                              : isSectionError
                                ? "text-red-300/70 bg-red-500/[0.04]"
                                : "text-white/25"
                        )}
                      >
                        <button
                          onClick={() => hasContent ? openSection(s) : undefined}
                          disabled={!hasContent}
                          className={cn(
                            "min-w-0 flex-1 text-left px-3 py-2 rounded-lg flex items-center gap-2",
                            hasContent ? "cursor-pointer" : "cursor-default"
                          )}
                        >
                          <span className="text-white/30 font-mono text-[11px] shrink-0">{s.section_num}</span>
                          <span className="truncate flex-1">{sectionTitle}</span>
                          {isSectionGenerating && <Loader2 className="w-3 h-3 animate-spin shrink-0 text-emerald-400" />}
                          {isSectionError && <span className="text-[11px] text-red-300/70 shrink-0">失败</span>}
                          {hasContent && progress[`${s.chapter_num}-${s.section_num}`]?.status === 'completed' && (
                            <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-400" />
                          )}
                        </button>
                        {isSectionError && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              retrySection(s).catch(() => {});
                            }}
                            className="mr-1.5 p-1.5 rounded-md text-red-300/70 hover:text-red-200 hover:bg-red-500/10 transition-colors"
                            aria-label="重新生成小节"
                            title="重新生成"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {/* Generate confirmation */}
                  {pendingChapter === ch.chapterNum && !generated && !generating && (
                    <div className="mt-1 mx-1 p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                      <p className="text-white/50 text-xs mb-2.5">
                        生成第{ch.chapterNum}章的讲义内容？（已完成的小节会自动跳过）
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { generateChapter(ch.chapterNum); setPendingChapter(null); }}
                          className="px-3 py-1.5 text-xs bg-emerald-500/15 text-emerald-400 rounded-md hover:bg-emerald-500/25 transition-colors"
                        >
                          开始生成
                        </button>
                        <button
                          onClick={() => setPendingChapter(null)}
                          className="px-3 py-1.5 text-xs text-white/40 rounded-md hover:bg-white/5 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Right: Section Content */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {!activeSection ? (
          <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
            <div className="text-center">
              <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>选择左侧章节开始学习</p>
            </div>
          </div>
        ) : showChat ? (
          /* AI Chat Panel */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Chat Header */}
            <div className="h-14 flex items-center justify-between px-6 border-b border-white/10 shrink-0 bg-bg-surface">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNavDrawer(true)}
                  className="md:hidden p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors"
                  aria-label="打开讲义导航"
                >
                  <BookOpen className="w-4 h-4" />
                </button>
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-white/70">
                  {activeSection.section_num} 讲义问答
                </span>
              </div>
              <button
                onClick={() => setShowChat(false)}
                className="p-2 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors"
                aria-label="关闭对话"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Chat Messages */}
            <div ref={chatMessagesContainerRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-32">
              <div className="max-w-3xl mx-auto space-y-8">
                {chatMessages.length === 0 && (
                  <div className="text-center py-16 text-white/30 text-sm">
                    关于本节讲义的任何疑问，都可以在这里提问
                  </div>
                )}
                {chatMessages.map((msg) => {
                  const isTutor = msg.role === 'tutor';
                  return (
                    <div key={msg.id} className={cn("flex gap-4", isTutor ? "flex-row" : "flex-row-reverse")}>
                      <div className="shrink-0 mt-1">
                        {isTutor ? (
                          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center">
                            <Sparkles className="w-3.5 h-3.5 text-black" />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-bg-muted border border-white/10 flex items-center justify-center">
                            <User className="w-3.5 h-3.5 text-white/60" />
                          </div>
                        )}
                      </div>
                      <div className={cn(
                        "max-w-[85%]",
                        isTutor ? "pt-1" : "bg-bg-raised border border-white/5 px-4 py-3 rounded-2xl rounded-tr-sm"
                      )}>
                        {isTutor ? (
                          <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-bg-surface prose-pre:border prose-pre:border-white/10 prose-headings:font-medium prose-blockquote:border-l-indigo-500 prose-blockquote:bg-indigo-500/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic">
                            {msg.reasoningContent && (
                              <div className="mb-2 not-prose">
                                {(() => {
                                  const isStreamingThis = chatStreaming && msg.content === '' && msg.id.startsWith('stream-');
                                  const isExpanded = isStreamingThis || expandedReasoning.has(msg.id);
                                  return (
                                    <div>
                                      <button
                                        onClick={() => !isStreamingThis && setExpandedReasoning(prev => {
                                          const n = new Set(prev);
                                          if (n.has(msg.id)) n.delete(msg.id); else n.add(msg.id);
                                          return n;
                                        })}
                                        className="flex items-center gap-2 text-xs text-cyan-400/70 hover:text-cyan-400 py-1"
                                      >
                                        <Brain className="w-3 h-3" />
                                        <span>
                                          {isStreamingThis ? '思考中...' : (isExpanded ? '收起思考' : '查看思考')}
                                        </span>
                                      </button>
                                      {isExpanded && (
                                        <div className="mt-1 p-2 rounded-lg bg-cyan-500/[0.04] border border-cyan-500/10 text-xs text-cyan-200/60 max-h-32 overflow-y-auto whitespace-pre-wrap">
                                          {msg.reasoningContent}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                            <MarkdownRenderer content={msg.content || ''} />
                            {chatStreaming && !msg.content && (msg as any).deepSolvePhase && (
                              <div className="flex items-center gap-2 text-amber-400/70 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>{(msg as any).deepSolveMessage || '多步解题中...'}</span>
                                {(msg as any).deepSolveData?.current && (
                                  <span className="text-white/30">
                                    ({(msg as any).deepSolveData.current}/{(msg as any).deepSolveData.total})
                                  </span>
                                )}
                              </div>
                            )}
                            {chatStreaming && !msg.content && !(msg as any).deepSolvePhase && !msg.reasoningContent && (
                              <div className="flex items-center gap-2 text-white/30 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                思考中...
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap text-sm text-white/90">{msg.content}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chat Input */}
            <div className="absolute bottom-0 w-full bg-gradient-to-t from-bg-base via-bg-base to-transparent pt-8 pb-5 px-4 z-20">
              <div className="max-w-3xl mx-auto relative">
                <div className="relative bg-bg-surface border border-white/10 rounded-xl focus-within:border-white/30 transition-colors">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                    placeholder="对本节内容提问..."
                    className="w-full bg-transparent text-white placeholder:text-white/30 pl-4 pr-12 py-3 focus:outline-none resize-none min-h-[48px] max-h-32 text-sm leading-relaxed"
                    rows={1}
                  />
                  <div className="absolute right-2.5 bottom-2.5 flex gap-1.5">
                    {chatStreaming && (
                      <button
                        onClick={() => abortRef.current?.abort()}
                        className="p-1.5 bg-red-500/80 text-white rounded-lg hover:bg-red-500 transition-all"
                        aria-label="停止生成"
                      >
                        <Square className="w-3.5 h-3.5" fill="currentColor" />
                      </button>
                    )}
                    <button
                      onClick={handleChatSend}
                      disabled={!chatInput.trim() || chatStreaming}
                      className="p-1.5 bg-white text-black rounded-lg hover:bg-white/90 disabled:opacity-20 transition-all"
                      aria-label="发送消息"
                    >
                      {chatStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" strokeWidth={3} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Lecture Content */
          <>
            {/* Content Header */}
            <div className="h-14 flex items-center justify-between px-6 border-b border-white/10 shrink-0 bg-bg-surface">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setShowNavDrawer(true)}
                  className="md:hidden p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors"
                  aria-label="打开讲义导航"
                >
                  <BookOpen className="w-4 h-4" />
                </button>
                <span className="text-emerald-400 font-mono text-sm shrink-0">{activeSection.section_num}</span>
                <span className="text-sm text-white/70 truncate">
                  {activeSection.title.split(' / ').pop()}
                </span>
                {progress[`${activeSection.chapter_num}-${activeSection.section_num}`]?.status === 'completed' && (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={loadVersions} title="版本历史" className="p-2 hover:bg-white/10 rounded-lg text-white/40 hover:text-white/70 transition-colors" aria-label="版本历史">
                  <History className="w-4 h-4" />
                </button>
                <button onClick={() => exportMarkdown(activeSection.chapter_num)} title="导出本章讲义" className="p-2 hover:bg-white/10 rounded-lg text-white/40 hover:text-white/70 transition-colors" aria-label="导出讲义">
                  <Download className="w-4 h-4" />
                </button>
                <button onClick={markCompleted} title="标记已完成" className={cn(
                  "p-2 rounded-lg transition-colors",
                  progress[`${activeSection.chapter_num}-${activeSection.section_num}`]?.status === 'completed'
                    ? "text-emerald-400 bg-emerald-500/10" : "text-white/40 hover:bg-white/10 hover:text-white/70"
                )} aria-label="标记已完成">
                  <CheckCircle2 className="w-4 h-4" />
                </button>
                <button
                  onClick={openChat}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-sm transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">AI 问答</span>
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div ref={contentAreaRef} id="lecture-scroll-container" className="flex-1 overflow-y-auto">
              {activeSection.content ? (
                <div className="max-w-3xl mx-auto px-6 py-8 pb-20">
                  <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-bg-surface prose-pre:border prose-pre:border-white/10 prose-headings:font-medium prose-headings:tracking-tight prose-td:border prose-td:border-white/10 prose-td:px-4 prose-td:py-2 prose-th:border prose-th:border-white/10 prose-th:bg-white/5 prose-th:px-4 prose-th:py-2 prose-blockquote:border-l-indigo-500 prose-blockquote:bg-indigo-500/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-a:text-indigo-400 prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-4">
                    <MarkdownRenderer content={activeSection.content} />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-white/40 text-sm">
                  {activeSection.status === 'generating' ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      正在生成讲义内容...
                    </div>
                  ) : (
                    '请先生成此章节的讲义内容'
                  )}
                </div>
              )}
            </div>
            {/* Version History Panel */}
            {showVersionHistory && (
              <div className="absolute top-14 right-0 w-80 h-[calc(100%-3.5rem)] bg-bg-surface border-l border-white/10 z-30 flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
                  <span className="text-sm font-medium text-white/80">版本历史</span>
                  <div className="flex items-center gap-1">
                    <button onClick={saveVersion} className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-emerald-400 transition-colors" aria-label="保存当前版本" title="保存当前版本">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setShowVersionHistory(false)} className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors" aria-label="关闭">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {versions.length === 0 && (
                    <p className="text-white/30 text-xs text-center py-8">暂无历史版本</p>
                  )}
                  {versions.map((v: any) => (
                    <div key={v.id} className="p-3 bg-white/[0.03] border border-white/[0.06] rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] text-white/40">
                          {new Date(v.created_at).toLocaleString('zh-CN')}
                        </span>
                        <button
                          onClick={() => restoreVersion(v.id)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] text-amber-400 hover:bg-amber-500/10 rounded transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                          恢复
                        </button>
                      </div>
                      <p className="text-xs text-white/50 line-clamp-3">{v.content?.slice(0, 200)}...</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Floating Chat Button */}
            <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-3">
              <button
                onClick={() => exportMarkdown()}
                className="w-10 h-10 bg-white/10 hover:bg-white/20 text-white/60 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
                aria-label="导出全部讲义"
                title="导出全部讲义为 Markdown"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={openChat}
                className="w-12 h-12 bg-emerald-500 hover:bg-emerald-400 text-black rounded-full shadow-lg shadow-emerald-500/20 flex items-center justify-center transition-all hover:scale-105"
                aria-label="AI 问答"
              >
                <MessageSquare className="w-5 h-5" />
              </button>
            </div>
          </>
        )}

        {/* Cancel Confirmation Modal */}
        {chapterToCancel !== null && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-raised border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
              <h3 className="text-lg font-medium text-white mb-2">确认取消生成？</h3>
              <p className="text-white/60 text-sm mb-6 leading-relaxed">
                取消后将立即断开与 AI 的连接，当前章节未生成完成的进度将被放弃。
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setChapterToCancel(null)}
                  className="px-4 py-2 text-sm text-white/70 hover:text-white transition-colors"
                >
                  继续生成
                </button>
                <button
                  onClick={() => {
                    const currentChapter = chapterToCancel;
                    if (currentChapter === null) return;

                    // Optimistically update UI to stop spinner immediately
                    setGeneratingChapters(prev => { const n = new Set(prev); n.delete(currentChapter); return n; });
                    setSections(prev => prev.map(s => 
                      s.chapter_num === currentChapter && s.status === 'generating' 
                        ? { ...s, status: 'pending' } 
                        : s
                    ));

                    // Clear any ongoing polls to prevent them from overwriting with stale data
                    for (const t of pollTimeoutsRef.current) clearTimeout(t);
                    pollTimeoutsRef.current = [];

                    apiFetch(`/api/courses/${courseId}/lectures/cancel-chapter/${currentChapter}`, { method: 'POST' })
                      .then(() => {
                        loadSections();
                      })
                      .catch(() => {
                        loadSections(); // revert on failure
                      });
                    setChapterToCancel(null);
                  }}
                  className="px-4 py-2 text-sm bg-red-500/80 hover:bg-red-500 text-white rounded-lg transition-colors"
                >
                  确认取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
