/**
 * Deep Solve 多步解题 Prompt
 * 三阶段管道：Planner → Solver → Writer
 * （问题复杂度分类已改为启发式规则，见 services/deepSolve.ts 的 classifyQuestion）
 */

/** Step 1: Planner — 拆解问题为子目标 */
export function buildPlannerPrompt(question: string, context: string): string {
  return `你是一个软件工程与计算机教学规划专家。学生提出了一个复杂的编程或理论问题，你需要将其拆解为 2-4 个递进的子目标（Sub-goals）。

## 学生的问题
${question}

## 课程与代码上下文
${context}

## 拆解原则
1. **递进性**：子目标必须存在逻辑递进关系。
   - 如果是**代码调试与排错**：子目标 1 应当为「定位与分析报错原因（Root Cause）」；子目标 2 应当为「调试修复路径及代码改写」；子目标 3 应当为「原理总结与防御性编程避坑」。
   - 如果是**理论问答**：先建立直观概念，再拆解内部机制，最后分析实际应用场景。
2. **适度性**：子目标控制在 2-4 个，切勿过度拆解，保证每个子目标都是有信息量和深度的主题。
3. **清晰性**：每个子目标只用一句话阐述。

请输出合法的 JSON 数组，可以直接以 [ 开头，] 结尾，或者使用 \`\`\`json ... \`\`\` Markdown 块包裹。不要在 JSON 外附加任何多余的日常问候、解释或旁白文字：

[
  {
    "title": "子目标简短标题（例如：定位报错根因）",
    "goal": "子目标的具体讲解要求与目标描述"
  }
]`;
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
    ? `\n## 已完成的子目标（请以此为基础，严禁重复讲解这些内容）\n${previousResults.map(r => `### ${r.title}\n${r.result}`).join('\n\n')}\n`
    : '';

  return `你是一个教学风格为【${teachingStyle}】的资深 AI 导师。你正在帮助学生逐步解答一个复杂的编程或理论问题。

## 原始核心问题
${originalQuestion}

## 当前需要攻克的子目标
**${subGoal.title}**
${subGoal.goal}
${previousContext}
## 课程与代码上下文
${context}

## 写作与讲解要求
1. **精准定位**：**只针对当前子目标进行深度作答**，绝对不要预先透露或抢答后续子目标的内容。
2. **承上启下**：如果存在已完成的子目标，必须自然承接先前的推导逻辑，杜绝与前序内容发生重复讲解。
3. **生动易懂**：结合当前 ${teachingStyle} 的教学语调，多用精妙的类比、图形化的文字表格、以及包含详细中文注释的代码片段。
4. **长度适中**：控制在 300-500 字之间，保证内容干货满满、重点突出。

直接输出 Markdown 格式的解答内容，不要输出任何前导或后随的客套话。`;
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

  return `你是一个风格为【${teachingStyle}】的顶尖 AI 编程导师。你之前已经分步解构并回答了学生问题的各个子目标，现在需要将这些分步解答合成为一篇结构完整、论述连贯、极富教学价值的最终解答。

## 原始问题
${originalQuestion}

## 各阶段子目标的分布解答
${allResults.map(r => `### ${r.title}\n${r.result}`).join('\n\n')}

## 课程背景与上下文
${context}

## 综合修润要求
1. **完美流畅度**：不要简单把各个部分粗暴拼接，必须使用优雅的逻辑过渡词、递进句连接各部分。
2. **结构完整**：
   - 增加一个亲切且提纲挈领的**开头引入（1-2句概括解题关键）**。
   - 增加一个帮助沉淀所学知识的**结尾总结/避坑建议**。
3. **消除冗余**：审查并精简合并各个子目标回答中可能出现的重复表达、名词解释或冗余代码。
4. **视觉层次清晰**：保持 Markdown 格式输出（利用加粗、有序列表、精致的代码高亮块）。
5. **统一教学风格**：确保全文始终契合【${teachingStyle}】教学风格的语气和温度。

直接输出最终的综合精修回答。`;
}
