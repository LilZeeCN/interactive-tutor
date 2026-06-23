export function buildLabListPrompt(course: {
  title: string;
  syllabus: string;
}): string {
  return `你是一位资深的课程设计专家。请根据课程大纲设计 5-8 个随堂练习实验。

课程标题：${course.title}

课程大纲：
${course.syllabus}

为每个实验生成以下信息：
- id: 使用 "lab" + 序号（如 lab1, lab2）
- title: 实验标题
- topic: 关联的大纲主题
- week: 关联的大纲周次（数字）
- status: 固定为 "pending"
- time: 预计耗时（如 "2小时"）

严格按以下 JSON 数组格式输出，不要输出任何其他内容：
[{"id":"lab1","title":"...","topic":"...","week":1,"status":"pending","time":"2小时"}]`;
}

export function buildLabDetailPrompt(params: {
  course: { title: string; description: string; content: string };
  labTitle: string;
  labTopic: string;
  weekNumber?: number;
  totalWeeks?: number;
  syllabusTopics?: string;
  previousLabs?: string;
}): string {
  const { course, labTitle, labTopic, weekNumber, totalWeeks, syllabusTopics, previousLabs } = params;

  const weekContext = weekNumber && totalWeeks
    ? `\n\n当前进度：这是第 ${weekNumber} 周（共 ${totalWeeks} 周）。学生已完成前 ${weekNumber - 1} 周的学习。请确保实验难度循序渐进。`
    : '';

  const syllabusSection = syllabusTopics
    ? `\n\n## 课程大纲\n${syllabusTopics}`
    : '';

  const labsSection = previousLabs
    ? `\n\n## 已完成的实验\n${previousLabs}\n\n请避免与已有实验内容重复，可以适当引用学生已掌握的知识。`
    : '';

  return `你是一位资深的课程讲师和编程教育专家。请为以下实验设计详细的教学内容。

## 课程信息
- 课程名称：${course.title}
- 课程描述：${course.description || '无'}
- 学习内容：${course.content || '无'}

## 实验信息
- 实验标题：${labTitle}
- 关联主题：${labTopic}
${weekContext}
${syllabusSection}
${labsSection}

请生成以下内容，严格按 JSON 格式输出，不要输出任何其他内容：

{
  "instructions": "实验说明（Markdown 格式，包含实验目标、背景介绍、实现步骤、注意事项）",
  "starter_code": {
    "文件名1.扩展名": "入门代码内容"
  },
  "test_cases": [
    {
      "name": "测试用例名称",
      "description": "测试描述",
      "command": "运行命令（如 python -m pytest tests/ 或 npm test）",
      "expected": "预期输出"
    }
  ]
}

关键要求：
1. **教学导向（核心）**：
   - \`starter_code\` 中的业务逻辑主文件**不能是已经写完的完整代码**！
   - 必须在关键实现处留空，并使用明确的注释指示学生补全，例如 \`// TODO: 请在此处实现核心逻辑\` 或 \`# TODO: 请在此处补全逻辑\`。
   - 初始状态下运行测试用例应该能够执行，但测试结果应当是**失败（Failed）**的。学生的目标是通过补全代码使所有测试用例通过（绿灯）。
2. **精简合理的文件规模（防止 JSON 截断）**：
   - 控制项目文件在 **3-5 个** 之间即可（不要过多，防止模型输出过长被截断）：
     - \`README.md\`（实验任务指导与要求）
     - 项目依赖配置（如 \`package.json\` 或 \`requirements.txt\` 等）
     - 待补充核心逻辑的源代码文件（如 \`src/solution.py\`）
     - 验收测试文件（如 \`tests/test_solution.py\`）
3. \`starter_code\` 的 key 支持路径格式（如 "src/solution.py", "tests/test_solution.py"）。
4. \`test_cases\` 至少包含 3 个测试用例，且 \`command\` 必须安全、通用，能在项目根目录下直接无污染运行。
5. \`instructions\` 以清晰的 Markdown 描述实验的目标、背景、核心原理以及提示步骤。
6. 代码中需要有必要的中文注释，引导学生思考。`;
}
