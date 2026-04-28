/**
 * Persistent memory system — per-course student profile + learning summary.
 * Inspired by DeepTutor's two-file memory (PROFILE.md + SUMMARY.md).
 *
 * - getCourseMemory: read memory for a course
 * - upsertCourseMemory: write memory
 * - injectMemorySection: format memory as system-prompt section
 * - updateMemoryInBackground: async LLM-based memory update after each chat exchange
 */

import { getDb } from '../db.js';
import { dbGet } from '../db-types.js';
import { generateText } from './ai.js';
import { trackTask } from '../helpers/taskTracker.js';

interface CourseMemory {
  course_id: string;
  user_profile: string;
  learning_summary: string;
  updated_at: string;
}

// Per-course lock to prevent concurrent memory updates
const memoryLocks = new Set<string>();

export function getCourseMemory(courseId: string): CourseMemory | undefined {
  return dbGet<CourseMemory>(
    'SELECT * FROM course_memory WHERE course_id = ?',
    courseId
  );
}

export function upsertCourseMemory(courseId: string, profile: string, summary: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO course_memory (course_id, user_profile, learning_summary, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(course_id) DO UPDATE SET
      user_profile = excluded.user_profile,
      learning_summary = excluded.learning_summary,
      updated_at = excluded.updated_at
  `).run(courseId, profile, summary, now);
}

/**
 * Format memory as a system-prompt section (≤ ~1000 tokens / ~2000 chars of Chinese).
 */
export function injectMemorySection(memory: CourseMemory | undefined): string {
  if (!memory) return '';
  const hasProfile = memory.user_profile && memory.user_profile.trim().length > 0;
  const hasSummary = memory.learning_summary && memory.learning_summary.trim().length > 0;
  if (!hasProfile && !hasSummary) return '';

  // Cap each section to ~1000 chars (≈500 tokens) to stay within budget
  const cap = (s: string, limit = 1000) =>
    s.length > limit ? s.slice(0, limit) + '...(已截断)' : s;

  let section = '\n\n## 学习记忆（AI 对这名学生的长期了解）';
  if (hasProfile) {
    section += `\n### 学生画像\n${cap(memory.user_profile)}`;
  }
  if (hasSummary) {
    section += `\n### 学习状态\n${cap(memory.learning_summary)}`;
  }
  section += '\n请根据以上记忆了解学生的水平和需求，在回答中适当个性化。';
  return section;
}

/**
 * Fire-and-forget: update memory in background after each chat exchange.
 * Uses per-course lock to prevent concurrent LLM calls.
 */
export function updateMemoryInBackground(params: {
  courseId: string;
  courseTitle: string;
  userMessage: string;
  tutorResponse: string;
  existingProfile: string;
  existingSummary: string;
}): void {
  const { courseId } = params;

  // Skip if already updating for this course
  if (memoryLocks.has(courseId)) return;

  memoryLocks.add(courseId);

  const task = (async () => {
    try {
      const prompt = buildMemoryUpdatePrompt(params);
      const result = await generateText(
        '你是一位学习分析助手。请根据师生对话内容更新学生的学习档案。',
        prompt,
        800
      );

      if (!result || !result.trim()) return;

      // Parse JSON response
      let parsed: { profile?: string; summary?: string };
      try {
        // Handle markdown code blocks
        const jsonStr = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch {
        console.warn('[memory] Failed to parse LLM update response, skipping');
        return;
      }

      const newProfile = parsed.profile === 'NO_CHANGE' ? params.existingProfile : (parsed.profile || params.existingProfile);
      const newSummary = parsed.summary === 'NO_CHANGE' ? params.existingSummary : (parsed.summary || params.existingSummary);

      // Cap field lengths to prevent unbounded growth
      const MAX_FIELD_LEN = 2000;
      const cappedProfile = newProfile.length > MAX_FIELD_LEN ? newProfile.slice(0, MAX_FIELD_LEN) + '...(已截断)' : newProfile;
      const cappedSummary = newSummary.length > MAX_FIELD_LEN ? newSummary.slice(0, MAX_FIELD_LEN) + '...(已截断)' : newSummary;

      upsertCourseMemory(courseId, cappedProfile, cappedSummary);
      console.log(`[memory] Updated memory for course ${courseId}`);
    } catch (err) {
      console.error('[memory] Background update failed:', err);
    } finally {
      memoryLocks.delete(courseId);
    }
  })();

  trackTask(task, `memory-update-${courseId}`).catch(() => {});
}

function buildMemoryUpdatePrompt(params: {
  courseTitle: string;
  userMessage: string;
  tutorResponse: string;
  existingProfile: string;
  existingSummary: string;
}): string {
  const { courseTitle, userMessage, tutorResponse, existingProfile, existingSummary } = params;

  // Truncate long messages to keep the prompt focused
  const capMsg = (s: string, limit = 1500) =>
    s.length > limit ? s.slice(0, limit) + '...(已截断)' : s;

  return `课程：${courseTitle}

## 最新师生对话
学生：${capMsg(userMessage)}
导师：${capMsg(tutorResponse)}

## 现有学生画像
${existingProfile || '（暂无）'}

## 现有学习状态摘要
${existingSummary || '（暂无）'}

请根据以上对话，更新学生的学习档案。严格按以下 JSON 格式输出，不要包含任何其他文字：
{
  "profile": "更新后的学生画像（或 NO_CHANGE）",
  "summary": "更新后的学习状态摘要（或 NO_CHANGE）"
}

学生画像应记录：学习偏好（喜欢什么讲解方式）、理解能力评估、知识薄弱点、学习节奏。每项 1-2 句话，总字数控制在 300 字以内。
学习状态应记录：当前学习焦点、已掌握的核心概念、仍需加强的领域、待解决的疑问。每项 1-2 句话，总字数控制在 300 字以内。

如果没有新的信息需要更新，对应字段输出 NO_CHANGE。`;
}
