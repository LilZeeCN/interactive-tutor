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
      "command": "运行命令（如 python -m pytest tests/）",
      "expected": "预期输出"
    }
  ],
  "environment": {
    "language": "编程语言（如 python, java, javascript）",
    "version": "推荐版本（如 3.11）",
    "dependencies": ["依赖包1", "依赖包2"],
    "setupCommands": ["安装命令1", "安装命令2"]
  }
}

关键要求：
1. starter_code 必须包含完整的可运行项目文件，至少 5-8 个文件：
   - README.md（项目说明）
   - 配置文件（如 package.json, requirements.txt, pom.xml 等）
   - 主要源代码文件（可以有子目录如 src/）
   - 测试文件（如 tests/test_xxx.py）
   - 入口文件（如 main.py, index.js, Main.java）
   - 工具/辅助文件（如 utils.py, helpers.js）
2. starter_code 的 key 支持路径格式（如 "src/main.py", "tests/test_solution.py"）
3. test_cases 至少包含 3 个测试用例，command 必须能在项目根目录直接执行
4. instructions 应该详细但不冗长，重点是帮助学生理解要做什么
5. environment 字段必须填写，包含运行该实验所需的所有依赖和环境信息
6. **所有文件内容必须完整、可运行。绝对不允许使用 "// ..." 或 "# ..." 或 "... 省略" 等方式省略代码。每个文件都必须是完整的、可以直接运行的代码。**
7. 代码中要有充分的中文注释帮助学生理解`;
}
