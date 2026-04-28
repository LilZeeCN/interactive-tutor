/**
 * Deep Solve 多步解题 Prompt
 * 三阶段管道：Planner → Solver → Writer
 */

/** Step 0: 判断问题是否需要多步解题 */
export function buildClassifyPrompt(question: string): string {
  return `你是一个问题分类器。判断以下学生问题是否需要"多步拆解"才能完整回答。

判断标准（同时满足任意 2 条即为"复杂"）：
1. 问题包含多个子问题（如"比较 A 和 B 的异同"）
2. 需要先建立概念再推导结论（如"为什么 X 能解决 Y 问题"）
3. 涉及 2 个以上独立知识点
4. 问题长度超过 30 个中文字符

简单问题（直接回答即可）：
- "什么是变量？"
- "Python 怎么安装？"
- "for 循环的基本语法是什么？"

复杂问题（需要多步拆解）：
- "比较 TCP 和 UDP 的异同，各自适用什么场景？"
- "为什么梯度消失会导致深度网络训练困难？如何解决？"
- "请解释操作系统中的死锁条件，并给出一个实际例子说明如何预防"

学生问题：${question}

只回答一个字：简 或 杂。不要解释。`;
}

/** Step 1: Planner — 拆解问题为子目标 */
export function buildPlannerPrompt(question: string, context: string): string {
  return `你是一个教学规划专家。学生提出了一个复杂问题，你需要将它拆解为 2-4 个子目标。

## 学生的问题
${question}

## 课程背景
${context}

## 拆解要求
1. 子目标之间有逻辑顺序（先理解概念 → 再分析原理 → 最后综合应用）
2. 每个子目标是可独立回答的
3. 子目标数量控制在 2-4 个（不要过度拆解）
4. 每个子目标用一句话描述

## 输出格式（严格 JSON）
返回一个 JSON 数组，每个元素包含：
- "title": 子目标标题（简短）
- "goal": 子目标描述（一句话）

示例：
[{"title": "理解基本概念", "goal": "解释 TCP 和 UDP 各自的定义和核心机制"}, ...]

只输出 JSON 数组，不要其他内容。`;
}

/** Step 2: Solver — 求解单个子目标 */
export function buildSolverPrompt(
  originalQuestion: string,
  subGoal: { title: string; goal: string },
  previousResults: { title: string; result: string }[],
  context: string,
  teachingStyle: string
): string {
  const previousContext = previousResults.length > 0
    ? `\n## 已完成的子目标\n${previousResults.map(r => `### ${r.title}\n${r.result}`).join('\n\n')}\n`
    : '';

  return `你是一个 ${teachingStyle} 风格的 AI 教师。你正在帮助学生逐步解决一个复杂问题。

## 原始问题
${originalQuestion}

## 当前需要解决的子目标
**${subGoal.title}**: ${subGoal.goal}
${previousContext}
## 课程背景
${context}

## 要求
1. 只回答当前子目标，不要涉及后续子目标
2. 如果前面有已完成的子目标，要在其基础上构建（不要重复）
3. 用通俗易懂的语言讲解
4. 适当使用类比和示例
5. 控制在 300-500 字

直接输出回答内容（Markdown 格式），不要加标题或前缀。`;
}

/** Step 3: Writer — 综合所有子目标的结果 */
export function buildWriterPrompt(
  originalQuestion: string,
  subGoals: { title: string; goal: string }[],
  results: { title: string; result: string }[],
  context: string,
  teachingStyle: string
): string {
  const allResults = subGoals.map((g, i) => ({
    ...g,
    result: results[i]?.result || '(无结果)'
  }));

  return `你是一个 ${teachingStyle} 风格的 AI 教师。你已经分步解决了一个复杂问题的各个子目标，现在需要将它们综合成一个连贯、完整的回答。

## 原始问题
${originalQuestion}

## 各子目标及解答
${allResults.map(r => `### ${r.title}\n${r.result}`).join('\n\n')}

## 课程背景
${context}

## 综合要求
1. 将各子目标的回答整合成一个**连贯**的完整回答
2. 添加开头概述（1-2 句话概括）和结尾总结
3. 用过渡句连接各部分，确保阅读流畅
4. 适当精简冗余内容（各子目标可能有重复）
5. 保持 ${teachingStyle} 的教学风格
6. 使用 Markdown 格式（标题、列表、代码块、加粗等）

直接输出完整的综合回答。`;
}
