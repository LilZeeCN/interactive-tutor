/**
 * Deep Solve 多步解题服务
 * 三阶段管道：Classify → Planner → Solver → Writer
 */
import { generateText } from './ai.js';
import {
  buildPlannerPrompt,
  buildSolverPrompt,
  buildWriterPrompt,
} from '../prompts/deepSolve.js';
import { parseJSON } from './parseJSON.js';

export interface DeepSolveCallbacks {
  /** Send an SSE event to the client */
  sendEvent: (event: Record<string, unknown>) => void;
  /** Check if client disconnected */
  isDisconnected: () => boolean;
  /** Abort signal */
  abortSignal?: AbortSignal;
}

interface SubGoal {
  title: string;
  goal: string;
}

interface SubResult {
  title: string;
  result: string;
}

/**
 * Rule-based classification: determine if a question needs multi-step solving.
 * Uses heuristics instead of an extra AI call (reasoning models may struggle
 * with very low max_tokens).
 */
function classifyQuestion(question: string): boolean {
  // Heuristic scoring
  let score = 0;

  // Length: longer questions tend to be more complex
  if (question.length > 30) score += 1;
  if (question.length > 60) score += 1;

  // Multi-part indicators
  const multiPartPatterns = [
    /比较.*和.*的异同/, /对比.*和/, /区别.*联系/,
    /为什么.*怎么/, /原因.*解决/, /分析.*应用/,
    /各自的/, /分别/, /各自适用/,
    /以及/, /并且/, /还有.*吗/,
    /A.*还是.*B/, /.*与.*的/,
  ];
  for (const p of multiPartPatterns) {
    if (p.test(question)) { score += 2; break; }
  }

  // Deep analysis indicators
  const deepPatterns = [
    /深入分析/, /详细解释.*原理/, /底层.*实现/,
    /本质区别/, /根本原因/, /性能对比/,
    /工作原理/, /运行机制/, /详细比较/,
    /请分析/, /请解释.*为什么/, /如何.*为什么/,
  ];
  for (const p of deepPatterns) {
    if (p.test(question)) { score += 2; break; }
  }

  // Multiple question marks
  const questionMarks = (question.match(/[？?]/g) || []).length;
  if (questionMarks >= 2) score += 1;

  // Simple question indicators (negative signals)
  const simplePatterns = [
    /^什么是/, /^怎么用/, /^如何安装/, /^什么是.{1,15}[？?]$/,
    /^怎么/, /^如何/, /^.*是什么[？?]$/,
  ];
  for (const p of simplePatterns) {
    if (p.test(question.trim())) { score -= 2; break; }
  }

  return score >= 3;
}

/** Plan: break the question into sub-goals */
async function planSubGoals(
  question: string,
  context: string,
): Promise<SubGoal[]> {
  const prompt = buildPlannerPrompt(question, context);
  const result = await generateText(
    '你是一个教学规划专家，输出严格的 JSON 数组。',
    prompt,
    4096,  // Reasoning models need more tokens for planning
  );

  const parsed = parseJSON(result);
  if (Array.isArray(parsed) && parsed.length >= 2) {
    return parsed.map((item: any) => ({
      title: String(item.title || ''),
      goal: String(item.goal || ''),
    })).filter((g: SubGoal) => g.title && g.goal);
  }

  // Fallback: treat as 2 sub-goals
  return [
    { title: '概念理解', goal: `理解"${question}"涉及的核心概念` },
    { title: '综合分析', goal: `针对"${question}"进行全面分析和总结` },
  ];
}

/** Solve one sub-goal */
async function solveSubGoal(
  originalQuestion: string,
  subGoal: SubGoal,
  previousResults: SubResult[],
  context: string,
  teachingStyle: string,
): Promise<string> {
  const prompt = buildSolverPrompt(
    originalQuestion,
    subGoal,
    previousResults,
    context,
    teachingStyle,
  );
  return generateText(
    `你是一个${teachingStyle}风格的AI教师。`,
    prompt,
    2048,
  );
}

/** Synthesize all sub-results into a final answer */
async function synthesizeAnswer(
  originalQuestion: string,
  subGoals: SubGoal[],
  results: SubResult[],
  context: string,
  teachingStyle: string,
): Promise<string> {
  const prompt = buildWriterPrompt(
    originalQuestion,
    subGoals,
    results,
    context,
    teachingStyle,
  );
  return generateText(
    `你是一个${teachingStyle}风格的AI教师。`,
    prompt,
    4096,
  );
}

/** Extract a brief context summary for Deep Solve prompts */
function buildContextSummary(courseInfo: {
  title?: string;
  syllabus?: string;
  content?: string;
}): string {
  const parts: string[] = [];
  if (courseInfo.title) parts.push(`课程: ${courseInfo.title}`);
  if (courseInfo.content) parts.push(`简介: ${courseInfo.content.slice(0, 200)}`);
  if (courseInfo.syllabus) parts.push(`大纲摘要: ${courseInfo.syllabus.slice(0, 500)}`);
  return parts.join('\n');
}

/** Get the teaching style name for prompts */
function getTeachingStyleName(style?: string): string {
  const styles: Record<string, string> = {
    khanmigo: 'Khanmigo 导师',
    'chatgpt-learn': 'ChatGPT 学习伙伴',
    feynman: '费曼学习法',
    socratic: '苏格拉底提问',
    'first-principles': '第一性原理',
    harvard: '哈佛高效导师',
  };
  return styles[style || 'khanmigo'] || 'Khanmigo 导师';
}

/**
 * Main entry: try Deep Solve for a complex question.
 * Returns the final answer string, or null if the question is simple
 * (caller should fall back to normal streaming).
 */
export async function deepSolve(
  question: string,
  courseInfo: {
    title?: string;
    syllabus?: string;
    content?: string;
    lectureStyle?: string;
  },
  callbacks: DeepSolveCallbacks,
): Promise<string | null> {
  const { sendEvent, isDisconnected, abortSignal } = callbacks;

  // Step 0: Classify
  sendEvent({ type: 'deep_solve', phase: 'classifying', message: '正在分析问题复杂度...' });

  const isComplex = classifyQuestion(question);
  if (abortSignal?.aborted || isDisconnected()) return null;

  if (!isComplex) {
    return null; // Simple question — caller should use normal streaming
  }

  const context = buildContextSummary(courseInfo);
  const style = getTeachingStyleName(courseInfo.lectureStyle);

  // Step 1: Plan
  sendEvent({ type: 'deep_solve', phase: 'planning', message: '问题较复杂，正在拆解为子目标...' });

  const subGoals = await planSubGoals(question, context);
  if (abortSignal?.aborted || isDisconnected()) return null;

  if (subGoals.length === 0) {
    return null; // Planning failed — fall back
  }

  sendEvent({
    type: 'deep_solve',
    phase: 'plan',
    subGoals: subGoals.map(g => g.title),
    message: `已拆解为 ${subGoals.length} 个子目标`,
  });

  // Step 2: Solve each sub-goal
  const results: SubResult[] = [];
  for (let i = 0; i < subGoals.length; i++) {
    if (abortSignal?.aborted || isDisconnected()) return null;

    const sg = subGoals[i];
    sendEvent({
      type: 'deep_solve',
      phase: 'solving',
      current: i + 1,
      total: subGoals.length,
      title: sg.title,
      message: `正在求解 ${i + 1}/${subGoals.length}: ${sg.title}`,
    });

    try {
      const result = await solveSubGoal(question, sg, results, context, style);
      results.push({ title: sg.title, result });
    } catch (err: any) {
      results.push({ title: sg.title, result: `(求解失败: ${err.message || '未知错误'})` });
    }
  }

  if (abortSignal?.aborted || isDisconnected()) return null;

  // Step 3: Synthesize
  sendEvent({ type: 'deep_solve', phase: 'synthesizing', message: '正在综合各步骤结果...' });

  const finalAnswer = await synthesizeAnswer(question, subGoals, results, context, style);

  if (abortSignal?.aborted || isDisconnected()) return null;

  sendEvent({ type: 'deep_solve', phase: 'done', message: '多步解题完成' });

  return finalAnswer;
}
