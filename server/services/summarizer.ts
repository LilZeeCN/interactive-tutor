import { dbGet } from '../db-types.js';
import { getDb } from '../db.js';
import { generateText } from './ai.js';
import { truncateTextToTokens } from './tokens.js';
import {
  SUMMARY_MAX_DROPPED_MESSAGES,
  SUMMARY_PER_MESSAGE_CHARS,
  SUMMARY_OUTPUT_TOKENS,
} from './tokenBudgets.js';

// In-memory lock to prevent concurrent summarization for the same topic
const summarizationLocks = new Set<string>();

export function buildSummaryPrompt(params: {
  topicTitle: string;
  courseTitle: string;
  droppedMessages: Array<{ role: string; content: string }>;
  existingSummary?: string;
}): string {
  const historyText = params.droppedMessages
    .slice(0, SUMMARY_MAX_DROPPED_MESSAGES)
    .map((m) => {
      const prefix = m.role === 'user' ? '学生' : '导师';
      const content = m.content.length > SUMMARY_PER_MESSAGE_CHARS
        ? truncateTextToTokens(m.content, Math.floor(SUMMARY_PER_MESSAGE_CHARS * 0.6), '...(已截断)')
        : m.content;
      return `${prefix}: ${content}`;
    })
    .join('\n\n');

  const existingSection = params.existingSummary
    ? `\n\n## 已有摘要（请与新内容合并）\n${params.existingSummary}`
    : '';

  return `你是一位课程助手。请将以下对话片段压缩为一段简洁的中文摘要（200-300字）。

课程：${params.courseTitle}
话题：${params.topicTitle}

## 对话片段
${historyText}
${existingSection}

摘要应包含：
1. 讨论的核心概念和学生的理解程度
2. 学生提出的关键问题及其是否已解决
3. 学生感到困难或感兴趣的领域
4. 导师给出的重要例子、类比或解释
5. 当前学习状态：学生似乎已掌握的内容与仍需努力的内容

请直接输出摘要文本，不要使用 JSON 或 markdown 代码块。`;
}

export async function summarizeDroppedMessages(params: {
  topicId: string;
  topicTitle: string;
  courseTitle: string;
  droppedMessages: Array<{ role: string; content: string }>;
  existingSummary?: string;
}): Promise<void> {
  if (params.droppedMessages.length === 0) return;

  // Skip if summarization is already in progress for this topic
  if (summarizationLocks.has(params.topicId)) return;
  summarizationLocks.add(params.topicId);

  try {
    // Re-read latest summary to avoid overwriting a concurrent write
    const currentTopic = dbGet<{ summary: string }>('SELECT summary FROM topics WHERE id = ?', params.topicId);
    const latestSummary = currentTopic?.summary || undefined;

    const prompt = buildSummaryPrompt({ ...params, existingSummary: latestSummary });
    const summary = await generateText(
      '你是一个对话摘要工具。请按要求生成简洁的中文摘要。',
      prompt,
      SUMMARY_OUTPUT_TOKENS
    );

    if (summary) {
      const now = new Date().toISOString();
      getDb().prepare('UPDATE topics SET summary = ?, updated_at = ? WHERE id = ?').run(
        summary.trim(),
        now,
        params.topicId
      );
      console.log(`[summarizer] Updated summary for topic ${params.topicId} (${summary.length} chars)`);
    }
  } catch (err) {
    console.error('[summarizer] Background summarization failed:', err);
  } finally {
    summarizationLocks.delete(params.topicId);
  }
}
