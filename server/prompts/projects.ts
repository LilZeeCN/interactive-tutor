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

  return `你是一位资深的计算机课程讲师和编程项目专家。请为以下综合大项目设计详细的脚手架与开发任务大纲。

## 课程信息
- 课程名称：${course.title}
- 课程描述：${course.description || '无'}
- 学习内容：${course.content || '无'}

## 项目大纲信息
- 项目标题：${projectTitle}
- 项目描述：${projectDesc}
${syllabusSection}
${labsSection}

请生成以下内容，严格按 JSON 格式输出，不要包含 markdown 代码块包裹标记，不要输出任何其他解释文字：

{
  "description": "详细的项目目标描述（3-5 句话，包含要达成的核心商业/技术目标和预期成果）",
  "milestones": [
    {
      "id": "m1",
      "title": "里程碑标题",
      "description": "里程碑描述（说明本阶段需要完成哪个模块的编码）",
      "acceptance": "具体的验收标准（说明需要通过哪些测试或达到什么功能）",
      "status": "pending"
    }
  ],
  "starter_code": {
    "文件名1.扩展名": "代码模板内容"
  }
}

关键要求：
1. **项目脚手架设计（核心）**：
   - \`starter_code\` 必须是该项目的**初始脚手架模板（Template Scaffold）**，而不是已经全部写完的成品代码！
   - 项目框架、配置文件、核心服务接口和路由骨架应该是配置完备的，但在具体业务逻辑和底层算法实现处，必须使用注释留白（如 \`// TODO: 实现用户鉴权逻辑\` 或 \`# TODO: 连接数据库并查询用户\`），供学生动手补充。
   - 必须提供基础的测试套件结构（如 \`tests/test_xxx.py\`），各阶段里程碑的测试用例在初始模板状态下运行应该是**失败（Failed）**的。
2. **精简合理的文件规模（防止 JSON 截断）**：
   - 限制初始项目文件在 **5-8 个** 之间（不要超出，防止模型输出字数过多导致 JSON 截断失效）：
     - \`README.md\`（说明该项目脚手架的使用、测试方法及各 Milestone 开发要求）
     - 依赖配置文件（如 \`package.json\`、\`requirements.txt\`、\`go.mod\` 等）
     - 基础配置文件或入口文件（如 \`src/index.js\`、\`config.py\` 等）
     - 1-2 个带有 \`TODO\` 的核心源码逻辑文件（如 \`src/controllers/userController.js\`）
     - 1-2 个对应的单元测试或集成测试文件（如 \`tests/user.test.js\`）
3. \`starter_code\` 的 key 支持路径格式（如 "src/models/user.py"）。
4. \`milestones\` 设计 3-4 个由浅入深的里程碑任务（如：M1：配置与数据模型开发，M2：核心接口逻辑补全，M3：中间件与安全性加固）。每个里程碑的验收标准必须清晰可度量。
5. 代码中需要有必要的中文注释，辅助学生理解系统架构。`;
}
