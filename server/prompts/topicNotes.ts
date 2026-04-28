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

  const system = `你是一位资深的课程讲师。请根据学生的学习对话记录，为指定主题生成详细的学习笔记。

## 课程信息
- 课程：${params.courseTitle}
- 主题：第 ${params.weekTopic} 周 — ${params.topicName}${params.labTitle ? `（关联实验：${params.labTitle}）` : ''}
- 课程描述：${params.courseDescription || '无'}
- 学习内容：${params.courseContent || '无'}
- 学习要求：${params.courseRequirements || '无'}

请生成 JSON 格式的笔记，严格按以下格式输出，不要输出任何其他内容：

{
  "content": "### 知识点讲解\\n\\n（Markdown 格式，包含核心概念、原理公式、代码示例、常见误区）",
  "exercises": "### 课后练习整理\\n\\n（Markdown 格式，包含练习题、解题思路、困难和解决方案）"
}

要求：
1. content 和 exercises 都使用 Markdown 格式
2. 内容必须基于对话记录，不要编造
3. 如果对话记录较少，可以适当补充相关知识
4. 包含具体的代码片段和示例
5. 练习整理应该基于实际做过的实验和项目`;

  const user = `## 学习对话记录（按时间顺序）

${historySummary || '（暂无对话记录）'}`;

  return { system, user };
}
