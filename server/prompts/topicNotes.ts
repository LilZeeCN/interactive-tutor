import { estimateTokens, truncateTextToTokens } from '../services/tokens.js';
import { NOTES_PER_MSG_TOKEN_CAP } from '../services/tokenBudgets.js';

export function buildTopicNotePrompt(params: {
  courseTitle: string;
  weekTopic: string;
  topicName: string;
  labTitle?: string;
  chatHistory: { role: string; content: string }[];
  courseContent: string;
  courseDescription: string;
  courseRequirements: string;
}): { system: string; user: string } {
  const historySummary = params.chatHistory
    .filter(m => m.role === 'user' || m.role === 'tutor')
    .map(m => {
      const prefix = m.role === 'user' ? '学生' : '导师';
      const content = estimateTokens(m.content) > NOTES_PER_MSG_TOKEN_CAP
        ? truncateTextToTokens(m.content, NOTES_PER_MSG_TOKEN_CAP, '\n...(已截断)')
        : m.content;
      return `${prefix}: ${content}`;
    })
    .join('\n\n');

  const system = `你是一位教学经验丰富的金牌讲师。请为指定学习主题生成一份精美、详尽且易懂的学习笔记。

## 课程与主题上下文
- 课程名称：${params.courseTitle}
- 学习主题：第 ${params.weekTopic} 周 — ${params.topicName}${params.labTitle ? `（关联实验：${params.labTitle}）` : ''}
- 课程描述：${params.courseDescription || '无'}
- 核心要求：${params.courseRequirements || '无'}

请生成 JSON 格式的笔记，严格按以下 JSON 结构输出，不要包含 markdown 代码块包裹标记，不要输出任何其他解释文字：

{
  "content": "### 知识点讲解\\n\\n（Markdown 格式。必须包含：1. 核心概念与原理的通俗解释；2. 核心公式或架构图说明（若有）；3. 典型的代码示例；4. 易错点与避坑指南）",
  "exercises": "### 自测与挑战\\n\\n（Markdown 格式。必须包含：1. 3道核心概念的选择或简答题，附简要解析；2. 1道动手编程小挑战，并给出解题思路提示）"
}

关键生成要求：
1. **系统性与冷启动支持**：
   - 即使没有任何对话记录，你也必须基于课程上下文和主题，生成一套完整、高质量、可直接阅读的体系化学习笔记。
   - 如果提供了对话记录，请将对话中学生表现出的薄弱点、踩过的坑以及你的解答，特别融入到笔记的“易错点”或“讲解”中，实现“因材施教”的个性化定制。
2. **严格的 JSON 转义安全**：
   - 必须确保输出是完全合法的单行或格式化 JSON 字符串。
   - 特别注意：Markdown 文本（尤其是代码块）中如果包含双引号 \`"\`，必须将其转义为 \`\\"\`；换行符必须替换为 \`\\n\`。
3. **教学风格**：
   - 语言亲切、专业，代码示例要有充分的中文注释。`;

  const user = `## 学生的学习对话记录（若为空，请生成该主题的系统通识笔记）
${historySummary ? `【历史对话】：\n${historySummary}` : '（暂无历史对话记录，请直接生成该知识点系统笔记）'}`;

  return { system, user };
}
