import { describe, it, expect } from 'vitest';
import type {
  Course,
  Message,
  SyllabusRow,
  Topic,
  Lab,
  Project,
  Milestone,
  LectureSection,
  ViewMode,
  TopicType,
} from '../types';

describe('TypeScript types — structural conformance', () => {
  it('creates a valid Course object', () => {
    const course: Course = {
      id: 'course-1',
      title: 'Introduction to React',
      description: 'Learn the fundamentals of React including components, state, and hooks.',
      content: 'React is a JavaScript library for building user interfaces.',
      requirements: 'Basic JavaScript knowledge',
      lectureStyle: 'feynman',
      lectureFormat: 'markdown',
      createdAt: '2025-01-15T08:00:00.000Z',
    };

    expect(course.id).toBe('course-1');
    expect(course.title).toBe('Introduction to React');
    expect(course.lectureStyle).toBe('feynman');
    expect(course.lectureFormat).toBe('markdown');
  });

  it('creates a valid Message object', () => {
    const userMessage: Message = {
      id: 'msg-1',
      role: 'user',
      content: 'What is a closure in JavaScript?',
      timestamp: new Date('2025-01-15T08:05:00.000Z'),
    };

    const tutorMessage: Message = {
      id: 'msg-2',
      role: 'tutor',
      content: 'A closure is a function that remembers its lexical scope.',
      reasoningContent: 'The user is asking about closures — explain simply.',
      timestamp: '2025-01-15T08:05:30.000Z',
    };

    expect(userMessage.role).toBe('user');
    expect(userMessage.reasoningContent).toBeUndefined();
    expect(tutorMessage.reasoningContent).toBeDefined();
    expect(new Date(tutorMessage.timestamp)).toBeInstanceOf(Date);
  });

  it('creates a valid SyllabusRow object', () => {
    const row: SyllabusRow = {
      id: 'syllabus-1',
      week: 1,
      topic: 'JavaScript Fundamentals',
      readings: [
        { title: 'MDN JavaScript Guide', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide' },
      ],
      assignments: [
        {
          title: 'Build a Calculator',
          type: 'lab',
          status: 'pending',
          id: 'lab-1',
          description: 'Create a simple calculator using JavaScript functions.',
        },
        {
          title: 'Final Project',
          type: 'project',
          status: 'in-progress',
          id: 'project-1',
        },
      ],
      status: 'in-progress',
    };

    expect(row.week).toBe(1);
    expect(row.readings).toHaveLength(1);
    expect(row.assignments).toHaveLength(2);
    expect(row.assignments[0].type).toBe('lab');
    expect(row.assignments[1].type).toBe('project');
  });

  it('creates a valid Topic object', () => {
    const topic: Topic = {
      id: 'topic-1',
      title: 'React Hooks',
      type: 'lecture',
      course_id: 'course-1',
      created_at: '2025-01-15T08:00:00.000Z',
    };

    const topicType: TopicType = topic.type;
    expect(topicType).toBe('lecture');
    expect(topic.course_id).toBe('course-1');
  });

  it('creates a valid Lab object', () => {
    const lab: Lab = {
      id: 'lab-1',
      course_id: 'course-1',
      title: 'Build a Counter Component',
      topic: 'React State Management',
      status: 'pending',
      time: '45 minutes',
      week: 2,
      instructions: 'Create a counter component with increment and decrement buttons using useState.',
      starter_code: {
        'App.tsx': 'import React from "react";\n\nexport default function App() {\n  return <div>Hello</div>;\n}',
        'index.tsx': 'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\n\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
      },
      test_cases: [
        {
          name: 'renders initial count',
          description: 'The counter should display 0 on initial render',
          command: 'npm test',
          expected: '0',
        },
      ],
      created_at: '2025-01-15T08:00:00.000Z',
    };

    expect(lab.id).toBe('lab-1');
    expect(lab.starter_code).toHaveProperty('App.tsx');
    expect(lab.test_cases).toHaveLength(1);
    expect(lab.test_cases[0].name).toBe('renders initial count');
  });

  it('creates a valid Project object', () => {
    const milestone: Milestone = {
      id: 'milestone-1',
      title: 'Setup project structure',
      description: 'Initialize a Vite React project and set up routing.',
      acceptance: 'Project compiles and displays home page.',
      status: 'completed',
    };

    const project: Project = {
      id: 'project-1',
      course_id: 'course-1',
      title: 'Build a Task Manager App',
      description: 'Create a full CRUD task management application with React.',
      status: 'in-progress',
      progress: 60,
      tags: ['React', 'CRUD', 'Tailwind CSS'],
      milestones: [
        milestone,
        {
          id: 'milestone-2',
          title: 'Implement task CRUD',
          description: 'Add create, read, update, delete functionality.',
          acceptance: 'Users can manage tasks with all CRUD operations.',
          status: 'in-progress',
        },
      ],
      starter_code: {},
      created_at: '2025-01-15T08:00:00.000Z',
    };

    expect(project.milestones).toHaveLength(2);
    expect(project.tags).toContain('React');
    expect(project.progress).toBe(60);
    expect(project.milestones[0].status).toBe('completed');
  });

  it('creates a valid LectureSection object', () => {
    const section: LectureSection = {
      id: 'section-1',
      course_id: 'course-1',
      chapter_num: 1,
      section_num: '1.1',
      title: 'What is React?',
      content: 'React is a declarative, component-based library for building UIs.',
      content_type: 'markdown',
      content_summary: 'Introduction to React core concepts.',
      status: 'generated',
      sort_order: 1,
      created_at: '2025-01-15T08:00:00.000Z',
      validation_status: 'ok',
    };

    expect(section.chapter_num).toBe(1);
    expect(section.section_num).toBe('1.1');
    expect(section.content_type).toBe('markdown');
  });

  it('validates ViewMode discriminated union', () => {
    const views: ViewMode[] = ['chat', 'syllabus', 'lectures', 'notes', 'labs', 'projects'];
    expect(views).toHaveLength(6);
    views.forEach((view) => {
      expect(typeof view).toBe('string');
    });
  });

  it('validates TopicType discriminated union', () => {
    const types: TopicType[] = ['lecture', 'lab', 'project', 'general'];
    expect(types).toHaveLength(4);
  });
});
