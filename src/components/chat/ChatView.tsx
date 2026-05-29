import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, User, Sparkles, Activity, Plus, MessageSquare, BookOpen, Code, Terminal, Hash, Loader2, Trash2, ChevronDown, ChevronRight, Brain, X, Square } from 'lucide-react';
import { fetchSSEWithRetry } from '../../hooks/useStreamFetch';
import { ReconnectingIndicator } from '../layout/ReconnectingIndicator';
import { Message, TopicType, TopicWithIcon } from '../../types';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../lib/api';
import { motion, AnimatePresence } from 'motion/react';

interface ChatViewProps {
  courseId: string;
}

const TOPIC_ICONS: Record<TopicType, React.ElementType> = {
  lecture: BookOpen,
  lab: Terminal,
  project: Code,
  general: Hash,
};

export function ChatView({ courseId }: ChatViewProps) {
  const [topics, setTopics] = useState<TopicWithIcon[]>([]);
  const [activeTopicId, setActiveTopicId] = useState<string>('');
  const [messagesByTopic, setMessagesByTopic] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [backgroundGenerating, setBackgroundGenerating] = useState(false);
  const [showTopicsDrawer, setShowTopicsDrawer] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeMessages = useMemo(() => messagesByTopic[activeTopicId] || [], [messagesByTopic, activeTopicId]);
  const activeTopic = useMemo(() => topics.find(t => t.id === activeTopicId), [topics, activeTopicId]);

  // Load topics from backend
  useEffect(() => {
    apiFetch<any[]>(`/api/chat/topics?courseId=${courseId}`)
      .then((data) => {
        const loaded: TopicWithIcon[] = data.map(t => ({
          id: t.id,
          title: t.title,
          type: (t.type || 'general') as TopicType,
          icon: TOPIC_ICONS[(t.type || 'general') as TopicType] || Hash,
        }));
        setTopics(loaded);
        if (loaded.length > 0) {
          setActiveTopicId(loaded[0].id);
        }
      })
      .catch(() => {});
  }, [courseId]);

  // Load messages when active topic changes
  const loadMessages = useCallback(async (topicId: string) => {
    if (!topicId) return;
    try {
      const data = await apiFetch(`/api/chat/topics/${topicId}/messages?limit=50`);
      setMessagesByTopic(prev => ({
        ...prev,
        [topicId]: data.messages || data,
      }));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (activeTopicId) {
      loadMessages(activeTopicId);
    }
  }, [activeTopicId, loadMessages]);

  // Poll for background AI generation when returning to a topic
  const bgGenRef = useRef(false);
  useEffect(() => { bgGenRef.current = backgroundGenerating; }, [backgroundGenerating]);

  useEffect(() => {
    if (!activeTopicId) return;

    const pollGeneration = async () => {
      try {
        const data = await apiFetch(`/api/chat/topics/${activeTopicId}/generating`);
        if (data.generating) {
          setBackgroundGenerating(true);
          pollTimer = setTimeout(pollGeneration, 2000);
        } else {
          setBackgroundGenerating(false);
          // If we were polling and generation just finished, reload messages
          if (bgGenRef.current) {
            loadMessages(activeTopicId);
          }
        }
      } catch {
        setBackgroundGenerating(false);
      }
    };

    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    // Check immediately if the last message is from the user (no tutor response yet)
    const msgs = messagesByTopic[activeTopicId];
    if (msgs && msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
      pollGeneration();
    } else {
      setBackgroundGenerating(false);
    }

    return () => {
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [activeTopicId, messagesByTopic]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Throttled scroll during streaming to avoid jank
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleScroll = useCallback(() => {
    if (scrollTimerRef.current) return;
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      scrollToBottom();
    }, 100);
  }, [scrollToBottom]);

  useEffect(() => {
    if (streaming) {
      scheduleScroll();
    } else {
      scrollToBottom();
    }
  }, [activeMessages, activeTopicId, streaming, scheduleScroll, scrollToBottom]);

  // Abort in-flight stream on unmount or topic switch
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [activeTopicId]);

  // Guard against double-send with a ref (synchronous check, bypasses React batching)
  const sendingRef = useRef(false);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || sendingRef.current || streaming || backgroundGenerating || !activeTopicId) return;
    sendingRef.current = true;

    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessagesByTopic(prev => ({
      ...prev,
      [activeTopicId]: [...(prev[activeTopicId] || []), userMsg]
    }));
    setInput('');
    setStreaming(true);

    // Add placeholder for streaming reply
    const streamMsgId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessagesByTopic(prev => ({
      ...prev,
      [activeTopicId]: [...(prev[activeTopicId] || []), {
        id: streamMsgId,
        role: 'tutor',
        content: '',
        timestamp: new Date(),
      }]
    }));

    try {
      abortRef.current = new AbortController();

      let fullContent = '';
      let fullReasoning = '';

      await fetchSSEWithRetry('/api/chat', { topicId: activeTopicId, message: userMsg.content }, {
        onEvent: (data) => {
          if (data.type === 'chunk') {
            const kind = data.kind || 'content';
            if (kind === 'reasoning') {
              fullReasoning += data.content;
            } else {
              fullContent += data.content;
            }
            const currentContent = fullContent;
            const currentReasoning = fullReasoning;
            setMessagesByTopic(prev => ({
              ...prev,
              [activeTopicId]: (prev[activeTopicId] || []).map(m =>
                m.id === streamMsgId ? { ...m, content: currentContent, reasoningContent: currentReasoning || undefined } : m
              )
            }));
          } else if (data.type === 'done') {
            setMessagesByTopic(prev => ({
              ...prev,
              [activeTopicId]: (prev[activeTopicId] || []).map(m =>
                m.id === streamMsgId ? { ...m, id: data.id } : m
              )
            }));
          } else if (data.type === 'suggest_notes') {
            setMessagesByTopic(prev => ({
              ...prev,
              [activeTopicId]: [
                ...(prev[activeTopicId] || []),
                {
                  id: 'suggest-notes-' + Date.now(),
                  role: 'system' as const,
                  content: `💡 学习笔记提示：你已经和导师进行了多轮对话，可以前往「笔记」页面为「${data.topicTitle}」生成学习笔记。`,
                  timestamp: new Date().toISOString(),
                }
              ]
            }));
          } else if (data.type === 'interrupted') {
            // User aborted — update message with real ID, keep partial content
            setMessagesByTopic(prev => ({
              ...prev,
              [activeTopicId]: (prev[activeTopicId] || []).map(m =>
                m.id === streamMsgId ? { ...m, id: data.id } : m
              )
            }));
          } else if (data.type === 'deep_solve') {
            // Multi-step problem solving progress
            const phase = data.phase as string;
            const message = data.message as string;
            setMessagesByTopic(prev => ({
              ...prev,
              [activeTopicId]: (prev[activeTopicId] || []).map(m =>
                m.id === streamMsgId ? { ...m, deepSolvePhase: phase, deepSolveMessage: message, deepSolveData: data } : m
              )
            }));
          }
        },
        onError: (msg) => {
          // Only show error if there's no partial content (real errors, not aborts)
          setMessagesByTopic(prev => {
            const msgs = prev[activeTopicId] || [];
            const streamMsg = msgs.find(m => m.id === streamMsgId);
            if (streamMsg?.content) return prev; // Has partial content from abort — don't overwrite
            return {
              ...prev,
              [activeTopicId]: msgs.map(m =>
                m.id === streamMsgId ? { ...m, content: 'AI 服务暂时不可用，请稍后再试。' } : m
              )
            };
          });
        },
        onReconnecting: (attempt) => {
          setReconnecting(true);
        },
      }, { signal: abortRef.current.signal });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessagesByTopic(prev => {
          const msgs = prev[activeTopicId] || [];
          const streamMsg = msgs.find(m => m.id === streamMsgId);
          if (streamMsg?.content) return prev;
          return {
            ...prev,
            [activeTopicId]: msgs.map(m =>
              m.id === streamMsgId ? { ...m, content: 'AI 服务暂时不可用，请稍后再试。' } : m
            )
          };
        });
      }
    } finally {
      setStreaming(false);
      setReconnecting(false);
      sendingRef.current = false;
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const createNewTopic = async () => {
    try {
      const topic = await apiFetch('/api/chat/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, title: '新对话', type: 'general' }),
      });
      const newTopic: TopicWithIcon = {
        id: topic.id,
        title: topic.title,
        type: 'general',
        icon: MessageSquare
      };
      setTopics(prev => [newTopic, ...prev]);
      setMessagesByTopic(prev => ({
        ...prev,
        [topic.id]: []
      }));
      setActiveTopicId(topic.id);
    } catch {
      // ignore
    }
  };

  const handleDeleteTopic = async (topicId: string) => {
    try {
      await apiFetch(`/api/chat/topics/${topicId}`, { method: 'DELETE' });
      setTopics(prev => {
        const remaining = prev.filter(t => t.id !== topicId);
        if (activeTopicId === topicId) {
          setActiveTopicId(remaining.length > 0 ? remaining[0].id : '');
        }
        return remaining;
      });
      setMessagesByTopic(prev => {
        const next = { ...prev };
        delete next[topicId];
        return next;
      });
    } catch {
      // ignore
    }
  };

  // Track which historical reasoning sections are expanded
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());

  const toggleReasoning = (msgId: string) => {
    setExpandedReasoning(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  return (
    <div className="flex h-full bg-bg-base overflow-hidden">
      <ReconnectingIndicator show={reconnecting} />

      {/* Topics Sidebar */}
      <div className={cn(
        "md:flex w-64 shrink-0 border-r border-white/10 flex-col bg-bg-surface z-30",
        showTopicsDrawer ? "flex absolute inset-y-0 left-0" : "hidden"
      )}>
        <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
          <span className="text-[13px] font-medium text-white/80 uppercase tracking-wider">对话主题 (Topics)</span>
          <div className="flex items-center gap-1">
            <button
              onClick={createNewTopic}
              className="p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors"
              title="新建对话"
              aria-label="新建对话"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowTopicsDrawer(false)}
              className="p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors md:hidden"
              aria-label="关闭面板"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {topics.length === 0 && (
            <div className="text-center text-white/30 text-xs py-8">
              暂无对话主题<br/>点击上方 + 创建
            </div>
          )}
          {topics.map(topic => (
            <div
              key={topic.id}
              className={cn(
                "flex items-center rounded-xl transition-all duration-200 group",
                activeTopicId === topic.id
                  ? "bg-white/10"
                  : "hover:bg-white/5"
              )}
            >
              <button
                onClick={() => { setActiveTopicId(topic.id); setShowTopicsDrawer(false); }}
                className="flex-1 text-left px-3 py-2.5 flex items-center gap-3 min-w-0"
              >
                <topic.icon className={cn(
                  "w-4 h-4 shrink-0",
                  activeTopicId === topic.id ? "text-emerald-400" : "text-white/40 group-hover:text-white/60"
                )} />
                <span className={cn(
                  "truncate text-[13px] font-medium",
                  activeTopicId === topic.id ? "text-white" : "text-white/50 group-hover:text-white/80"
                )}>
                  {topic.title}
                </span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteTopic(topic.id); }}
                className="p-1.5 mr-1.5 rounded-lg text-white/0 group-hover:text-white/30 hover:!text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                title="删除对话"
                aria-label="删除对话"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Header */}
        <header className="absolute top-0 w-full h-16 bg-gradient-to-b from-bg-base to-transparent z-20 flex items-center justify-between px-8 pointer-events-none">
          <div className="flex items-center gap-3 pointer-events-auto">
            <button
              onClick={() => setShowTopicsDrawer(true)}
              className="md:hidden p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors"
              aria-label="打开对话主题列表"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-white/50 uppercase tracking-widest">会话进行中</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-white/40 uppercase tracking-widest pointer-events-auto border border-white/10 px-3 py-1.5 rounded-full bg-white/[0.02] backdrop-blur-md">
            <Activity className="w-3.5 h-3.5" />
            {activeTopic?.title || '未命名对话'}
          </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 pt-24 pb-32 scroll-smooth">
          <div className="max-w-4xl mx-auto space-y-10">
            {activeMessages.length === 0 && (
              <div className="text-center py-20 text-white/30 text-sm">
                开始新的对话吧
              </div>
            )}
            <AnimatePresence mode="popLayout">
              {activeMessages.map((msg) => {
                const isTutor = msg.role === 'tutor';
                const isSystem = msg.role === 'system';
                if (isSystem) {
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className="mx-auto max-w-lg my-2 px-4 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-center"
                    >
                      <p className="text-sm text-indigo-300">{msg.content}</p>
                    </motion.div>
                  );
                }
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    key={msg.id}
                    className={cn(
                      "flex gap-5",
                      isTutor ? "flex-row" : "flex-row-reverse"
                    )}
                  >
                    {/* Avatar */}
                    <div className="shrink-0 mt-1">
                      {isTutor ? (
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                          <Sparkles className="w-4 h-4 text-black" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-bg-muted border border-white/10 flex items-center justify-center">
                          <User className="w-4 h-4 text-white/60" />
                        </div>
                      )}
                    </div>

                    {/* Message Content */}
                    <div className={cn(
                      "max-w-[85%]",
                      isTutor ? "pt-1" : "bg-bg-raised border border-white/5 px-5 py-3.5 rounded-2xl rounded-tr-sm"
                    )}>
                      {isTutor ? (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-bg-surface prose-pre:border prose-pre:border-white/10 prose-headings:font-medium prose-headings:tracking-tight prose-td:border prose-td:border-white/10 prose-td:px-4 prose-td:py-2 prose-th:border prose-th:border-white/10 prose-th:bg-white/5 prose-th:px-4 prose-th:py-2 prose-blockquote:border-l-indigo-500 prose-blockquote:bg-indigo-500/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-a:text-indigo-400">
                          {/* Collapsible reasoning section */}
                          {msg.reasoningContent && (
                            <div className="mb-3 not-prose">
                              {(() => {
                                const isStreamingThis = streaming && msg.content === '' && msg.id.startsWith('stream-');
                                const isExpanded = isStreamingThis || expandedReasoning.has(msg.id);
                                return (
                                  <div>
                                    <button
                                      onClick={() => !isStreamingThis && toggleReasoning(msg.id)}
                                      className="flex items-center gap-2 text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors py-1.5 px-2 -mx-2 rounded-lg hover:bg-cyan-500/5"
                                    >
                                      <Brain className="w-3.5 h-3.5" />
                                      <span className="font-medium">
                                        {isStreamingThis ? '思考中...' : (isExpanded ? '收起思考过程' : '查看思考过程')}
                                      </span>
                                      {!isStreamingThis && (
                                        isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
                                      )}
                                      {isStreamingThis && <Loader2 className="w-3 h-3 animate-spin" />}
                                    </button>
                                    {isExpanded && msg.reasoningContent && (
                                      <div className="mt-1.5 p-3 rounded-lg bg-cyan-500/[0.04] border border-cyan-500/10 text-[13px] text-cyan-200/60 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                                        {msg.reasoningContent}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                          {/* Main content */}
                          <MarkdownRenderer content={msg.content || ''} />
                          {/* Deep Solve multi-step progress */}
                          {streaming && !msg.content && (msg as any).deepSolvePhase && (
                            <div className="flex items-center gap-2 text-amber-400/70 text-sm not-prose">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>{(msg as any).deepSolveMessage || '多步解题中...'}</span>
                              {(msg as any).deepSolveData?.current && (
                                <span className="text-white/30">
                                  ({(msg as any).deepSolveData.current}/{(msg as any).deepSolveData.total})
                                </span>
                              )}
                            </div>
                          )}
                          {/* Default thinking spinner */}
                          {streaming && !msg.content && !(msg as any).deepSolvePhase && !msg.reasoningContent && (
                            <div className="flex items-center gap-2 text-white/30 text-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              思考中...
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">
                          {msg.content}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {backgroundGenerating && (
              <div className="flex items-center gap-2 text-white/30 text-sm p-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                AI 正在回复...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 w-full bg-gradient-to-t from-bg-base via-bg-base to-transparent pt-10 pb-6 px-4 z-20">
          <div className="max-w-4xl mx-auto relative">
            <div className="relative bg-bg-surface border border-white/10 rounded-2xl shadow-2xl overflow-hidden focus-within:border-white/30 transition-colors duration-300">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`在 "${activeTopic?.title || '新对话'}" 中提问...`}
                className="w-full bg-transparent text-white placeholder:text-white/30 pl-5 pr-14 py-4 focus:outline-none resize-none min-h-[56px] max-h-40 text-[15px] leading-relaxed"
                rows={1}
              />
              <div className="absolute right-3 bottom-3 flex gap-2">
                {streaming && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="p-2 bg-red-500/80 text-white rounded-xl hover:bg-red-500 transition-all duration-200 flex items-center justify-center"
                    aria-label="停止生成"
                  >
                    <Square className="w-4 h-4" fill="currentColor" />
                  </button>
                )}
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || streaming || backgroundGenerating}
                  className="p-2 bg-white text-black rounded-xl hover:bg-white/90 disabled:opacity-20 disabled:hover:bg-white transition-all duration-200 flex items-center justify-center"
                  aria-label="发送消息"
                >
                  {streaming ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4" strokeWidth={3} />
                  )}
                </button>
              </div>
            </div>
            <div className="text-center mt-3 text-[11px] font-mono text-white/30 uppercase tracking-widest">
              AI 可能会犯错。请核实重要信息。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
