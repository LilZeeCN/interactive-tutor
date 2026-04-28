export type ViewMode = 'chat' | 'syllabus' | 'lectures' | 'notes' | 'labs' | 'projects';
export type TopicType = 'lecture' | 'lab' | 'project' | 'general';

export interface Course {
  id: string;
  title: string;
  description: string;
  content: string;
  requirements: string;
  lectureStyle?: 'khanmigo' | 'chatgpt-learn' | 'feynman' | 'socratic' | 'first-principles' | 'harvard-tutor';
  lectureFormat?: 'markdown' | 'html';
  createdAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'tutor' | 'system';
  content: string;
  reasoningContent?: string;
  timestamp: Date | string;
}

export interface SyllabusRow {
  id: string;
  week: number;
  topic: string;
  readings: { title: string; url: string }[];
  assignments: { title: string; type: 'lab' | 'project'; status: 'pending' | 'in-progress' | 'completed'; id?: string; description?: string }[];
  status: 'pending' | 'in-progress' | 'completed';
}

export interface Topic {
  id: string;
  title: string;
  type: TopicType;
  course_id: string;
  created_at: string;
}

export interface Lab {
  id: string;
  course_id: string;
  title: string;
  topic: string;
  status: 'pending' | 'in-progress' | 'completed';
  time: string;
  week?: number;
  instructions: string;
  starter_code: Record<string, string>;
  test_cases: { name: string; description: string; command: string; expected: string }[];
  created_at: string;
}

export interface Project {
  id: string;
  course_id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed';
  progress: number;
  tags: string[];
  milestones: Milestone[];
  starter_code: Record<string, string>;
  created_at: string;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  acceptance: string;
  status: 'pending' | 'in-progress' | 'completed';
}

export interface LectureSection {
  id: string;
  course_id: string;
  chapter_num: number;
  section_num: string;
  title: string;
  content: string;
  content_type?: 'markdown' | 'html';
  content_summary?: string;
  status: string;
  sort_order: number;
  created_at: string;
  validation_status?: string;
}

export interface TopicWithIcon extends Omit<Topic, 'course_id' | 'created_at'> {
  course_id?: string;
  created_at?: string;
  icon: React.ElementType;
}
