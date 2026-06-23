export function buildSyllabusPrompt(course: {
  title: string;
  description: string;
  content: string;
  requirements: string;
}): string {
  return `你是一位资深的计算机课程设计专家。根据以下课程信息，生成系统且科学的每周教学大纲（Syllabus）。

## 课程元数据
- 课程标题：${course.title}
- 课程描述：${course.description}
- 学习内容：${course.content}
- 学习要求：${course.requirements}

请生成 8-12 周的课程大纲。每周必须包含以下结构：
- week: 数字（第几周）
- topic: 该周的核心教学与实践主题
- readings: 数组，推荐的文献/技术文档阅读。每项必须包含：
  - title: 文章/文档标题
  - url: 真实可用的技术文档链接。**禁止使用 "#"**。优先使用官方权威文档链接（如 MDN 官方文档、Python 官方文档 docs.python.org、React 官方文档 react.dev、Go Dev、Stack Overflow 深度解析等）。
- assignments: 数组，该周安排的实践练习。每项必须包含：
  - title: **必须是具体且带有明确任务属性的标题**。禁止使用 "Lab 1"、"作业" 这样无实际教学描述的名称。必须写出具体的编码练习任务，例如：\`"实现二叉平衡树的旋转算法"\`、\`"编写具有速率限制的 Express 中间件"\`、\`"开发一个带断点续传功能的 HTTP 客户端"\`。
  - type: 实践类型，必须为 \`"lab"\`（随堂实验，耗时约1-2小时）或 \`"project"\`（综合大项目，跨越数周，耗时约5-10小时）。
  - status: 固定为 \`"pending"\`

大纲设计原则：
1. **难度递进与连贯**：前 1-3 周为基础铺垫，4-8 周为中级核心实践，最后几周为大型综合挑战项目。每周的内容必须对前一周的知识有延续和引用，杜绝知识断层。
2. **实践活动饱满**：总大纲中必须包含 5-8 个 \`lab\` 随堂实验（分散在各周中），以及至少 2-3 个 \`project\` 综合项目（通常安排在第 4 周及以后的阶段）。
3. **合理的任务分布**：同一周内通常安排最多 1 个 lab，project 应错开安排。

请输出合法的 JSON 数组，可以直接以 [ 开头，] 结尾，或者使用 \`\`\`json ... \`\`\` Markdown 块包裹。不要在 JSON 外附加任何多余的日常问候、解释或旁白文字：

[
  {
    "week": 1,
    "topic": "课程主题名称",
    "readings": [
      {
        "title": "阅读文献标题",
        "url": "https://..."
      }
    ],
    "assignments": [
      {
        "title": "具体的随堂实验编码任务标题",
        "type": "lab",
        "status": "pending"
      }
    ],
    "status": "pending"
  }
]`;
}
