export function buildNotesPrompt(course: {
  title: string;
  description: string;
  content: string;
  syllabus: string;
}): string {
  return `你是一位资深的课程讲师。请根据以下课程信息，生成完整的课堂笔记。

课程标题：${course.title}
课程描述：${course.description}
学习内容：${course.content}

课程大纲（已生成的）：
${course.syllabus}

要求：
1. 使用 Markdown 格式
2. 包含多级标题（##, ###）
3. 包含代码示例（使用合适的语言标注）
4. 包含重要概念的表格总结
5. 包含数学公式（使用 LaTeX 语法，如 $E=mc^2$ 或 $$\\sum_{i=1}^{n}$$）
6. 包含关键知识点的加粗标注
7. 包含学习提示和注意事项（使用引用块 > ）
8. 包含任务列表（- [ ] 未完成, - [x] 已完成）

请直接输出 Markdown 内容，不要使用代码块包裹。`;
}
