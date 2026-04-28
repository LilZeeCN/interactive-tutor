export function buildProjectListPrompt(course: {
  title: string;
  syllabus: string;
}): string {
  return `你是一位资深的课程设计专家。请根据课程大纲设计 3-4 个综合性项目。

课程标题：${course.title}

课程大纲：
${course.syllabus}

为每个项目生成以下信息：
- id: 使用 "proj" + 序号（如 proj1, proj2）
- title: 项目标题
- description: 项目描述（2-3 句话）
- status: 固定为 "pending"
- progress: 固定为 0
- tags: 相关技术标签（数组，3-5 个）

严格按以下 JSON 数组格式输出，不要输出任何其他内容：
[{"id":"proj1","title":"...","description":"...","status":"pending","progress":0,"tags":["tag1","tag2"]}]`;
}

export function buildProjectDetailPrompt(params: {
  course: { title: string; description: string; content: string };
  projectTitle: string;
  projectDesc: string;
  syllabusTopics?: string;
  completedLabs?: string;
}): string {
  const { course, projectTitle, projectDesc, syllabusTopics, completedLabs } = params;

  const syllabusSection = syllabusTopics
    ? `\n\n## 课程大纲\n${syllabusTopics}`
    : '';

  const labsSection = completedLabs
    ? `\n\n## 学生已完成的实验\n${completedLabs}\n\n项目应该综合运用学生已掌握的知识，难度要高于实验。`
    : '';

  return `你是一位资深的课程讲师和编程教育专家。请为以下综合项目设计详细内容。

## 课程信息
- 课程名称：${course.title}
- 课程描述：${course.description || '无'}
- 学习内容：${course.content || '无'}

## 项目信息
- 项目标题：${projectTitle}
- 项目描述：${projectDesc}
${syllabusSection}
${labsSection}

请生成以下内容，严格按 JSON 格式输出，不要输出任何其他内容：

{
  "description": "详细的项目目标描述（3-5 句话，包含要达成的目标和预期成果）",
  "milestones": [
    {
      "id": "m1",
      "title": "里程碑标题",
      "description": "里程碑描述",
      "acceptance": "验收标准",
      "status": "pending"
    }
  ],
  "starter_code": {
    "文件名1.扩展名": "完整代码内容"
  },
  "environment": {
    "language": "编程语言",
    "version": "推荐版本",
    "dependencies": ["依赖包"],
    "setupCommands": ["安装命令"]
  }
}

关键要求：
1. starter_code 必须包含完整的可运行项目结构，至少 8-12 个文件：
   - README.md（项目说明、运行方法）
   - 配置文件（package.json, requirements.txt, go.mod 等）
   - 源代码文件（按模块组织，如 src/models/, src/routes/, src/utils/）
   - 测试文件（tests/ 目录）
   - 入口文件
   - 示例/数据文件
   - 环境配置文件（.env.example, config/ 等）
   - 文档文件（docs/ 或内联注释）
2. starter_code 的 key 支持路径格式（如 "src/models/user.py"）
3. milestones 设计 3-5 个里程碑，循序渐进
4. 每个 milestone 的 acceptance 要具体可检查
5. environment 字段必须填写
6. **所有文件内容必须完整、可运行。绝对不允许使用 "// ..." 或 "# ..." 或 "... 省略" 等方式省略代码。每个文件都必须是完整的、可以直接运行的代码。**
7. 代码中要有充分的中文注释帮助学生理解`;
}
