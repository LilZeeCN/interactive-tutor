export function buildSyllabusPrompt(course: {
  title: string;
  description: string;
  content: string;
  requirements: string;
}): string {
  return `你是一位资深的课程设计专家。根据以下课程信息，生成完整的教学大纲。

课程标题：${course.title}
课程描述：${course.description}
学习内容：${course.content}
学习要求：${course.requirements}

请生成 8-12 周的课程大纲，每周包含：
- 周次 (week): 数字
- 主题 (topic): 该周的学习主题
- 推荐阅读 (readings): 数组，每项包含 title 和 url（如果知道的话使用真实 URL，否则使用 "#")
- 作业 (assignments): 数组，每项包含 title, type（"lab" 或 "project"）, status（固定为 "pending"）

设计原则：
1. **难度递进**：前几周打基础（概念、原理），中间周逐步增加实践（小项目、综合练习），后几周挑战性项目
2. **知识连贯**：每周主题应建立在之前周的内容之上，避免知识断层
3. **实践平衡**：确保有足够的 lab（5-8 个随堂实验）和至少 2-3 个 project（综合项目）
4. **合理分布**：lab 分散在各周，project 安排在知识积累足够的中后期

严格按以下 JSON 数组格式输出，不要输出任何其他内容（不要 markdown 代码块标记）：
[{"week":1,"topic":"...","readings":[{"title":"...","url":"..."}],"assignments":[{"title":"...","type":"lab","status":"pending"}],"status":"pending"}]`;
}
