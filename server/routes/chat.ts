import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { sendChatMessage } from '../services/ai.js';
import { buildLabContext, buildProjectContext } from '../services/context.js';
import { setupSSERes } from '../helpers/sse.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { escapeLIKE } from '../helpers/sqlUtils.js';
import { estimateTokens, truncateMessages, truncateTextToTokens } from '../services/tokens.js';
import { summarizeDroppedMessages } from '../services/summarizer.js';
import { dbGet, dbAll } from '../db-types.js';
import { requireFields } from '../middleware/validate.js';
import {
  CHAT_HISTORY_BUDGET,
  CHAT_PER_MESSAGE_CAP,
  CHAT_MIN_HISTORY,
  CHAT_SYSTEM_PROMPT_CAP,
} from '../services/tokenBudgets.js';
import { getCourseMemory, injectMemorySection, updateMemoryInBackground, upsertCourseMemory } from '../services/memory.js';
import { deepSolve } from '../services/deepSolve.js';

export const chatRouter = Router();

// Track which topics have already triggered a notes suggestion this server session
// Bounded to prevent unbounded growth from deleted topics
const suggestedNotesTopics = new Set<string>();
const MAX_SUGGESTED_NOTES_TRACK = 500;

// Track topics currently generating AI responses (including background generation after client disconnect)
const generatingTopics = new Map<string, { startedAt: number }>();

/**
 * Smart check for whether to suggest generating notes.
 * Conditions: matches a syllabus row, no existing notes yet,
 * >= 4 substantive tutor replies (content > 80 chars), not already suggested.
 */
function shouldSuggestNotes(
  topicId: string,
  courseId: string,
  topicTitle: string
): { suggest: boolean; syllabusId?: string; syllabusTitle?: string } {
  if (suggestedNotesTopics.has(topicId)) {
    return { suggest: false };
  }

  // Find matching syllabus row — try exact match first, then substring
  let syllabusRow = dbGet<{ id: string; topic: string }>(
    'SELECT id, topic FROM syllabus WHERE course_id = ? AND topic = ?'
  , courseId, topicTitle);
  if (!syllabusRow) {
    syllabusRow = dbGet<{ id: string; topic: string }>(
      'SELECT id, topic FROM syllabus WHERE course_id = ? AND topic LIKE ? LIMIT 1'
    , courseId, `%${escapeLIKE(topicTitle)}%`);
  }
  if (!syllabusRow) return { suggest: false };

  // Check if notes already exist for this syllabus topic
  const existingNote = dbGet<{ id: string }>(
    'SELECT id FROM topic_notes WHERE topic_id = ? AND course_id = ?'
  , syllabusRow.id, courseId);
  if (existingNote) return { suggest: false };

  // Count substantive tutor messages (content > 80 chars indicates real explanations)
  const msgCount = dbGet<{ c: number }>(
    `SELECT COUNT(*) as c FROM messages
     WHERE topic_id = ? AND role = 'tutor' AND LENGTH(content) > 80`
  , topicId);
  if (!msgCount || msgCount.c < 4) return { suggest: false };

  suggestedNotesTopics.add(topicId);
  // Prune if set grows too large
  if (suggestedNotesTopics.size > MAX_SUGGESTED_NOTES_TRACK) {
    const it = suggestedNotesTopics.values();
    for (let i = 0; i < MAX_SUGGESTED_NOTES_TRACK / 2; i++) {
      suggestedNotesTopics.delete(it.next().value);
    }
  }
  return { suggest: true, syllabusId: syllabusRow.id, syllabusTitle: syllabusRow.topic };
}

// POST /api/chat - send message and get streaming AI reply
chatRouter.post('/', requireFields('topicId', 'message'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDb();
  const { topicId, message } = req.body;

  if (!topicId || !message?.trim()) {
    res.status(400).json({ error: '缺少 topicId 或 message 参数' });
    return;
  }

  // Verify topic exists
  const topic = dbGet<{ id: string; title: string; type: string; summary?: string; course_id: string }>('SELECT * FROM topics WHERE id = ?', topicId);
  if (!topic) {
    res.status(404).json({ error: '话题不存在' });
    return;
  }

  // Prevent concurrent chat streams on the same topic
  if (generatingTopics.has(topicId)) {
    res.status(429).json({ error: '请等待当前回复完成' });
    return;
  }
  generatingTopics.set(topicId, { startedAt: Date.now() });

  // Save user message
  const userMsgId = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO messages (id, topic_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)'
  ).run(userMsgId, topicId, 'user', message, now);

  // Set up SSE with heartbeat
  const sse = setupSSERes(res, req);
  const abortCtrl = new AbortController();
  const disconnectPoll = setInterval(() => {
    if (sse.isDisconnected() && !abortCtrl.signal.aborted) abortCtrl.abort();
  }, 1000);

  // Send user message confirmation
  sse.sendEvent({ type: 'user_ack', id: userMsgId });

  let fullContent = '';
  let fullReasoning = '';

  try {
    // Build conversation history for context
    const history = dbAll<{ role: string; content: string }>(
      'SELECT role, content FROM messages WHERE topic_id = ? ORDER BY timestamp ASC'
    , topicId);

    // Load course context
    const course = dbGet<{ id?: string; title: string; description?: string; content?: string; requirements?: string }>('SELECT * FROM courses WHERE id = ?', topic.course_id);
    const syllabus = dbAll<{ week: number; topic: string; status: string }>(
      'SELECT week, topic, status FROM syllabus WHERE course_id = ? ORDER BY week ASC'
    , topic.course_id);

    // Pre-compute progress from already-fetched syllabus (avoids redundant queries in buildSystemPrompt)
    const progressContext = buildProgressFromSyllabus(syllabus);

    // Build system prompt with full course context
    let systemPrompt = await buildSystemPrompt(course, syllabus, topic, progressContext);

    // Enforce system prompt cap to protect history budget
    const systemTokens = estimateTokens(systemPrompt);
    if (systemTokens > CHAT_SYSTEM_PROMPT_CAP) {
      systemPrompt = truncateTextToTokens(systemPrompt, CHAT_SYSTEM_PROMPT_CAP, '\n\n...(系统提示已截断)');
    }

    // Token budget: truncate history to fit within budget
    const actualSystemTokens = estimateTokens(systemPrompt);
    const historyBudget = Math.max(
      CHAT_MIN_HISTORY,
      CHAT_HISTORY_BUDGET - actualSystemTokens
    );
    const truncatedHistory = truncateMessages(history, historyBudget, CHAT_PER_MESSAGE_CAP);

    // Trigger background summarization for dropped messages
    const droppedCount = history.length - truncatedHistory.length;
    if (droppedCount > 0) {
      const droppedMessages = history.slice(0, droppedCount);
      summarizeDroppedMessages({
        topicId,
        topicTitle: topic.title,
        courseTitle: course?.title || '',
        droppedMessages,
        existingSummary: topic.summary || undefined,
      }).catch(err => {
        console.error('[chat] Background summarization failed:', err);
      });
    }

    // --- Deep Solve: try multi-step for complex questions ---
    const lastUserMsg = history.filter(m => m.role === 'user').pop()?.content || '';
    const deepSolveResult = await deepSolve(lastUserMsg, {
      title: course?.title,
      syllabus: syllabus.map(s => s.topic).join(', '),
      content: course?.content,
      lectureStyle: (course as any)?.lecture_style,
    }, {
      sendEvent: (e) => { if (!sse.isDisconnected()) sse.sendEvent(e); },
      isDisconnected: () => sse.isDisconnected(),
      abortSignal: abortCtrl.signal,
    });

    if (deepSolveResult) {
      // Complex question — Deep Solve succeeded, send result + save to DB
      console.log('[chat] Deep Solve completed, streaming result');
      fullContent = deepSolveResult;
      if (!sse.isDisconnected()) {
        sse.sendEvent({ type: 'chunk', content: deepSolveResult, kind: 'content' });
      }

      // Always save tutor message to DB
      const dsTutorMsgId = uuidv4();
      const dsTutorTimestamp = new Date().toISOString();
      db.prepare(
        'INSERT INTO messages (id, topic_id, role, content, reasoning_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(dsTutorMsgId, topicId, 'tutor', fullContent, '', dsTutorTimestamp);

      db.prepare('UPDATE topics SET updated_at = ? WHERE id = ?').run(dsTutorTimestamp, topicId);

      // Update course memory in background
      if (topic.course_id) {
        const existingMemory = getCourseMemory(topic.course_id);
        updateMemoryInBackground({
          courseId: topic.course_id,
          courseTitle: course?.title || '',
          userMessage: message,
          tutorResponse: fullContent,
          existingProfile: existingMemory?.user_profile || '',
          existingSummary: existingMemory?.learning_summary || '',
        });
      }

      if (!sse.isDisconnected()) {
        sse.sendEvent({ type: 'done', id: dsTutorMsgId });
      }
      sse.cleanup();
    } else {
      // Simple question or classification failed — normal streaming
    console.log('[chat] Calling AI stream...');
    await sendChatMessage(
      { systemPrompt, messages: truncatedHistory, topicTitle: topic.title },
      (chunk, kind) => {
        // Always accumulate content (even if client disconnected — we'll save to DB)
        if (kind === 'reasoning') {
          fullReasoning += chunk;
        } else {
          fullContent += chunk;
        }
        // Only forward to SSE if client is still connected
        if (!sse.isDisconnected()) {
          sse.sendEvent({ type: 'chunk', content: chunk, kind });
        }
      },
      (full) => {
        // Always save tutor message to DB (even if client disconnected)
        const isDisconnected = sse.isDisconnected();
        const tutorMsgId = uuidv4();
        const tutorTimestamp = new Date().toISOString();
        db.prepare(
          'INSERT INTO messages (id, topic_id, role, content, reasoning_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(tutorMsgId, topicId, 'tutor', fullContent, fullReasoning, tutorTimestamp);

        // Update topic's updated_at timestamp
        db.prepare('UPDATE topics SET updated_at = ? WHERE id = ?').run(tutorTimestamp, topicId);

        // Smart notes suggestion check (skip if client gone)
        if (!isDisconnected) {
          const noteCheck = shouldSuggestNotes(topicId, topic.course_id, topic.title);
          if (noteCheck.suggest && noteCheck.syllabusId) {
            sse.sendEvent({ type: 'suggest_notes', topicId: noteCheck.syllabusId, topicTitle: noteCheck.syllabusTitle });
          }
        }

        // Update course memory in background (fire-and-forget)
        if (topic.course_id) {
          const existingMemory = getCourseMemory(topic.course_id);
          updateMemoryInBackground({
            courseId: topic.course_id,
            courseTitle: course?.title || '',
            userMessage: message,
            tutorResponse: fullContent,
            existingProfile: existingMemory?.user_profile || '',
            existingSummary: existingMemory?.learning_summary || '',
          });
        }

        // Send done event to client if still connected
        if (!isDisconnected) {
          sse.sendEvent({ type: 'done', id: tutorMsgId });
        }
        sse.cleanup();
      },
      abortCtrl.signal
    );
    } // end of else (normal streaming)
  } catch (err: any) {
    // Save partial content on any error
    if (fullContent || fullReasoning) {
      const tutorMsgId = uuidv4();
      const tutorTimestamp = new Date().toISOString();
      db.prepare(
        'INSERT INTO messages (id, topic_id, role, content, reasoning_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(tutorMsgId, topicId, 'tutor', fullContent, fullReasoning, tutorTimestamp);
      db.prepare('UPDATE topics SET updated_at = ? WHERE id = ?').run(tutorTimestamp, topicId);
      if (!sse.isDisconnected()) {
        sse.sendEvent({ type: 'interrupted', id: tutorMsgId, content: fullContent, reasoning: fullReasoning });
      }
      sse.cleanup();
      return;
    }

    if (!sse.isDisconnected()) {
      const errorMsg = err?.message || 'AI 服务暂时不可用';
      sse.sendEvent({ type: 'error', error: errorMsg });
    }
    sse.cleanup();
  } finally {
    clearInterval(disconnectPoll);
    // Always release the lock, even if generation completed in background
    generatingTopics.delete(topicId);
  }
}));

// GET /api/chat/topics?courseId=xxx
chatRouter.get('/topics', (req: Request, res: Response) => {
  const db = getDb();
  const { courseId } = req.query;

  if (!courseId) {
    res.status(400).json({ error: '缺少 courseId 参数' });
    return;
  }

  let topics = dbAll<Record<string, unknown>>(
    'SELECT * FROM topics WHERE course_id = ? ORDER BY created_at ASC'
  , courseId as string);

  // 如果没有话题，自动根据课程大纲生成默认话题
  if (topics.length === 0) {
    const autoCreate = db.transaction(() => {
      // Re-check inside transaction to avoid TOCTOU race
      const existing = dbGet<{ id: string }>('SELECT id FROM topics WHERE course_id = ? LIMIT 1', courseId as string);
      if (existing) return;

      const course = dbGet('SELECT * FROM courses WHERE id = ?', courseId as string);
      const syllabus = dbAll<{ week: number; topic: string }>('SELECT week, topic FROM syllabus WHERE course_id = ? ORDER BY week ASC', courseId as string);

      const insert = db.prepare(
        'INSERT INTO topics (id, course_id, title, type, created_at) VALUES (?, ?, ?, ?, ?)'
      );

      for (const s of syllabus) {
        insert.run(uuidv4(), courseId, `第 ${s.week} 周：${s.topic}`, 'lecture', new Date().toISOString());
      }
      insert.run(uuidv4(), courseId, '通用问答', 'general', new Date().toISOString());
    });

    try { autoCreate(); } catch { /* concurrent create, ignore */ }

    topics = dbAll<Record<string, unknown>>(
      'SELECT * FROM topics WHERE course_id = ? ORDER BY created_at ASC'
    , courseId as string);
  }

  res.json(topics);
});

// DELETE /api/chat/topics/:topicId
chatRouter.delete('/topics/:topicId', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM topics WHERE id = ?').run(req.params.topicId);
  suggestedNotesTopics.delete(req.params.topicId);
  if (result.changes === 0) {
    res.status(404).json({ error: '话题不存在' });
    return;
  }
  res.json({ success: true });
});

// POST /api/chat/topics - create new topic
chatRouter.post('/topics', (req: Request, res: Response) => {
  const db = getDb();
  const { courseId, title, type } = req.body;

  if (!courseId || !title?.trim()) {
    res.status(400).json({ error: '缺少 courseId 或 title 参数' });
    return;
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO topics (id, course_id, title, type, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, courseId, title.trim(), type || 'general', now);

  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
  res.status(201).json(topic);
});

// GET /api/chat/topics/:topicId/messages?limit=&before=
chatRouter.get('/topics/:topicId/messages', (req: Request, res: Response) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
  const before = req.query.before as string | undefined;

  let messages: Record<string, unknown>[];
  if (before) {
    // Load older messages before the given timestamp
    messages = dbAll<Record<string, unknown>>(
      'SELECT * FROM messages WHERE topic_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?'
    , req.params.topicId, before, limit)
      .reverse();
  } else {
    // Load latest messages
    messages = dbAll<Record<string, unknown>>(
      'SELECT * FROM (SELECT * FROM messages WHERE topic_id = ? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC'
    , req.params.topicId, limit);
  }

  // Total count for "has more" check
  const total = dbGet<{ c: number }>('SELECT COUNT(*) as c FROM messages WHERE topic_id = ?', req.params.topicId)?.c ?? 0;

  // Map snake_case reasoning_content to camelCase for frontend
  const mapped = messages.map((m: Record<string, unknown>) => ({
    ...m,
    reasoningContent: m.reasoning_content || undefined,
  }));

  res.json({ messages: mapped, hasMore: mapped.length < total });
});

// GET /api/chat/topics/:topicId/generating — check if AI is still generating a response
chatRouter.get('/topics/:topicId/generating', (req: Request, res: Response) => {
  const entry = generatingTopics.get(req.params.topicId);
  if (entry) {
    res.json({ generating: true, startedAt: entry.startedAt });
  } else {
    res.json({ generating: false });
  }
});

function buildProgressFromSyllabus(
  syllabus: { week: number; topic: string; status: string }[]
): string {
  const totalWeeks = syllabus.length;
  const completedWeeks = syllabus.filter(s => s.status === 'completed').length;
  return `学习进度：
- 大纲进度：${completedWeeks}/${totalWeeks} 周已完成`;
}

async function buildSystemPrompt(
  course: { id?: string; title: string; description?: string; content?: string; requirements?: string } | null,
  syllabus: { week: number; topic: string; status: string }[],
  topic: { id: string; title: string; type: string; summary?: string; course_id: string },
  progressContext: string
): Promise<string> {
  const courseId = course?.id;

  const courseContext = course ? `## 课程信息
- 课程名称：${course.title}
- 课程描述：${course.description || '无'}
- 学习内容：${course.content || '无'}
- 学习要求：${course.requirements || '无'}

## 学习进度
${progressContext}` : '## 课程信息\n（未找到课程信息）';

  // 教学大纲（含每周完成状态）
  let syllabusContext = '';
  if (syllabus.length > 0) {
    syllabusContext = `\n## 教学大纲\n${syllabus.map(s => {
      const mark = s.status === 'completed' ? '✓' : '○';
      return `- [${mark}] 第 ${s.week} 周：${s.topic}`;
    }).join('\n')}`;
  }

  // 话题对话摘要
  let summarySection = '';
  if (topic.summary) {
    summarySection = `

## 之前的对话摘要
以下是与学生在本话题中的之前对话的压缩摘要。请参考此摘要了解学生之前的学习情况：
${topic.summary}

## 对话延续指导
- 基于之前的对话摘要，判断学生当前的理解程度
- 避免重复已经详细讲解过的内容，除非学生主动要求
- 如果之前的摘要显示学生在某些概念上有困难，可以主动检查理解`;
  }

  // P0-2: 注入当前话题相关的 topic_notes
  let notesSection = '';
  if (courseId) {
    const topicNote = dbGet<{ content: string }>(
      'SELECT content FROM topic_notes WHERE course_id = ? AND topic LIKE ?'
    , courseId, `%${escapeLIKE(topic.title)}%`);
    if (topicNote?.content) {
      notesSection = `

## 学生的学习笔记（AI 之前整理的）
${topicNote.content}`;
    }
  }

  // P0-1: 根据 topic type 注入 lab/project 上下文
  let labProjectContext = '';
  if (courseId && (topic.type === 'lab' || topic.type === 'project')) {
    const topicTitle = topic.title || '';
    if (topic.type === 'lab') {
      // 通过标题匹配查找关联的 lab — strip "第 X 周：" prefix for matching
      const plainTitle = topicTitle.replace(/^.*?[：:]\s*/, '');
      const lab = dbGet<{ id: string }>(
        'SELECT id FROM labs WHERE course_id = ? AND (title = ? OR title LIKE ?) LIMIT 1'
      , courseId, plainTitle, `%${escapeLIKE(plainTitle)}%`);
      if (lab) {
        const ctx = await buildLabContext(courseId, lab.id);
        if (ctx) {
          labProjectContext = `

## 当前实验上下文
${ctx}`;
        }
      }
    } else if (topic.type === 'project') {
      const plainTitle = topicTitle.replace(/^.*?[：:]\s*/, '');
      const proj = dbGet<{ id: string }>(
        'SELECT id FROM projects WHERE course_id = ? AND (title = ? OR title LIKE ?) LIMIT 1'
      , courseId, plainTitle, `%${escapeLIKE(plainTitle)}%`);
      if (proj) {
        const ctx = await buildProjectContext(courseId, proj.id);
        if (ctx) {
          labProjectContext = `

## 当前项目上下文
${ctx}`;
        }
      }
    }
  }

  // 注入课程记忆（学生画像 + 学习状态）
  const memory = courseId ? getCourseMemory(courseId) : undefined;
  const memorySection = injectMemorySection(memory);

  // 基础人设
  const base = `你是一位专业、耐心的 AI 辅导老师，负责教授以下课程：

${courseContext}
${syllabusContext}
${summarySection}${notesSection}${labProjectContext}${memorySection}

## 教学原则
- 你是这门课程的专属导师，你的所有回答都应该围绕课程内容展开
- 引导式教学：先判断学生当前的知识水平，然后逐步引导，不要直接给出全部答案
- 回答时结合课程大纲中的具体知识点，标注对应的大纲周次
- 如果学生的问题超出课程范围，可以适当延伸，但要拉回到课程核心内容
- 使用 Markdown 格式回复，可以包含代码块、数学公式（LaTeX $...$ / $$...$$）、表格等
- 请使用中文回复

## 复杂问题处理
当学生提出复杂问题（涉及多个概念、需要对比分析、或需要多步推理）时，请按以下策略处理：
1. **拆解问题**：先识别问题中涉及的子问题，用列表展示拆解结果
2. **逐步回答**：按逻辑顺序逐个解答子问题，每个子问题独立成段
3. **建立关联**：在子问题之间建立逻辑连接，说明它们如何组成完整答案
4. **最终总结**：所有子问题回答完后，给出一个简洁的综合总结
5. 何时拆解：当问题包含「比较」「分析」「为什么」「怎么做」且涉及多个方面时，应主动拆解`;

  // 话题类型指导
  let lectureContent = '';
  if (courseId && topic.type === 'lecture') {
    const plainTitle = topic.title.replace(/^.*?[：:]\s*/, '');
    const lec = dbGet<{ content: string; content_type: string; content_summary: string }>(
      'SELECT content, content_type, content_summary FROM lectures WHERE course_id = ? AND title LIKE ? LIMIT 1'
    , courseId, `%${escapeLIKE(plainTitle)}%`);
    if (lec) {
      lectureContent = lec.content ? lec.content.slice(0, 2000) : '';
      if (lectureContent) {
        lectureContent = `\n\n## 当前讲义内容\n${lectureContent}`;
      }
    }
  }

  const typeHints: Record<string, string> = {
    lecture: `\n\n当前对话场景：课堂讲解（${topic.title}）。请像教授授课一样，系统性地讲解这个知识点，包含：概念定义、核心原理、具体示例、常见误区、总结要点。${lectureContent}`,
    lab: `\n\n当前对话场景：实验辅导（${topic.title}）。请帮助学生理解实验要求，引导思考解决方案，而不是直接给出完整代码。当学生卡住时，给提示而不是答案。参考上面的实验上下文了解当前实验的具体要求。`,
    project: `\n\n当前对话场景：项目辅导（${topic.title}）。请帮助学生规划项目结构，解决技术难点，提供架构建议和最佳实践。参考上面的项目上下文了解当前项目的里程碑和进度。`,
    general: `\n\n当前对话场景：自由问答（${topic.title}）。请根据学生的提问，结合课程内容提供帮助。`,
  };

  return base + (typeHints[topic.type] || typeHints.general);
}

// GET /api/chat/memory?courseId=xxx — 获取课程记忆
chatRouter.get('/memory', (req: Request, res: Response) => {
  const { courseId } = req.query;
  if (!courseId || typeof courseId !== 'string') {
    res.status(400).json({ error: '缺少 courseId 参数' });
    return;
  }
  const memory = getCourseMemory(courseId);
  res.json(memory || { course_id: courseId, user_profile: '', learning_summary: '', updated_at: '' });
});

// PUT /api/chat/memory — 手动编辑课程记忆
chatRouter.put('/memory', (req: Request, res: Response) => {
  const { courseId, userProfile, learningSummary } = req.body;
  if (!courseId) {
    res.status(400).json({ error: '缺少 courseId 参数' });
    return;
  }
  upsertCourseMemory(courseId, userProfile || '', learningSummary || '');
  res.json({ success: true });
});
