import { generateText } from './ai.js';
import { dbAll, dbGet } from '../db-types.js';
import { getDb } from '../db.js';
import { parseJSON } from './parseJSON.js';

interface ReviewItem {
  ease_factor: number;
  interval_days: number;
  review_count: number;
}

/**
 * SM-2 algorithm implementation
 * quality: 0-5 rating of recall quality
 *   0 - complete failure
 *   1 - incorrect, but remembered upon seeing answer
 *   2 - incorrect, but answer seemed easy to recall
 *   3 - correct with serious difficulty
 *   4 - correct after hesitation
 *   5 - perfect recall
 */
export function sm2(
  item: ReviewItem,
  quality: number
): { ease_factor: number; interval_days: number; next_review_at: string; review_count: number } {
  // Clamp quality to 0-5
  const q = Math.max(0, Math.min(5, quality));

  let { ease_factor, interval_days, review_count } = item;

  if (q >= 3) {
    // Correct response
    if (review_count === 0) {
      interval_days = 1;
    } else if (review_count === 1) {
      interval_days = 6;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    review_count += 1;
  } else {
    // Incorrect response — reset
    review_count = 0;
    interval_days = 1;
  }

  // Update ease factor
  ease_factor = Math.max(1.3, ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  // Calculate next review date
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval_days);
  const next_review_at = nextReview.toISOString();

  return { ease_factor, interval_days, next_review_at, review_count };
}

/**
 * Generate review items for a specific chapter using AI
 */
export async function generateReviewItems(courseId: string, chapterNum: number): Promise<void> {
  const db = getDb();

  // Get lecture content for the chapter
  const lectures = dbAll<{ title: string; content: string; section_num: string }>(
    'SELECT * FROM lectures WHERE course_id = ? AND chapter_num = ? AND status = ? ORDER BY sort_order ASC',
    courseId, chapterNum, 'done'
  );

  if (lectures.length === 0) {
    console.log(`[spaced-rep] No completed lectures for chapter ${chapterNum} in course ${courseId}`);
    return;
  }

  // Build context from lecture content
  const contextParts = lectures.map(l => {
    const parts = l.title.split(' / ');
    const sectionTitle = parts[1] || l.title;
    const contentSnippet = l.content ? l.content.slice(0, 800) : '';
    return `## ${sectionTitle}\n${contentSnippet}`;
  });

  const context = contextParts.join('\n\n---\n\n');

  const prompt = `请根据以下课程内容，生成5-10道复习问题和答案对（Q&A格式）。
要求：
1. 问题应该覆盖关键概念和知识点
2. 答案要简洁准确
3. 难度从易到难排列
4. 严格以 JSON 数组格式输出，每个元素包含 question 和 answer 字段

课程内容：
${context}`;

  try {
    const responseText = await generateText(
      '你是一位资深的课程讲师。请严格按照要求的 JSON 数组格式输出复习问题和答案，不要包含 markdown 代码块标记。',
      prompt,
      4096
    );

    const items = parseJSON(responseText) as any[];
    if (!Array.isArray(items) || items.length === 0) {
      console.warn(`[spaced-rep] Failed to parse review items for chapter ${chapterNum}`);
      return;
    }

    const now = new Date().toISOString();
    const insert = db.prepare(
      'INSERT INTO review_items (id, course_id, chapter_num, section_num, question, answer, interval_days, ease_factor, next_review_at, review_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    db.transaction(() => {
      // Clear existing items for this chapter
      db.prepare('DELETE FROM review_items WHERE course_id = ? AND chapter_num = ?').run(courseId, chapterNum);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.question || !item.answer) continue;
        insert.run(
          crypto.randomUUID(),
          courseId,
          chapterNum,
          lectures[i % lectures.length]?.section_num || String(i + 1),
          item.question,
          item.answer,
          1.0,
          2.5,
          now,
          0,
          now
        );
      }
    })();

    console.log(`[spaced-rep] Generated ${items.length} review items for chapter ${chapterNum}`);
  } catch (err) {
    console.error(`[spaced-rep] Generation failed for chapter ${chapterNum}:`, err);
  }
}
