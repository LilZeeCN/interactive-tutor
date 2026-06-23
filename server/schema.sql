-- TUTOR.AI Database Schema

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  content TEXT DEFAULT '',
  requirements TEXT DEFAULT '',
  lecture_style TEXT DEFAULT 'khanmigo',
  lecture_format TEXT DEFAULT 'markdown',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'tutor')),
  content TEXT NOT NULL,
  reasoning_content TEXT DEFAULT '',
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS syllabus (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  topic TEXT NOT NULL,
  readings TEXT NOT NULL DEFAULT '[]',
  assignments TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS labs (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  time TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  starter_code TEXT DEFAULT '',
  test_cases TEXT DEFAULT '[]',
  week INTEGER,
  environment TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  milestones TEXT DEFAULT '[]',
  starter_code TEXT DEFAULT '',
  environment TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_notes (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  topic TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  exercises TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_num INTEGER NOT NULL,
  section_num TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'markdown',
  content_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  validation_status TEXT DEFAULT 'pending',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lecture_progress (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_num INTEGER NOT NULL,
  section_num TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  quiz_scores TEXT DEFAULT '[]',
  last_visited_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (course_id, chapter_num, section_num)
);

CREATE TABLE IF NOT EXISTS lecture_versions (
  id TEXT PRIMARY KEY,
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_num INTEGER NOT NULL,
  section_num TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  interval_days REAL NOT NULL DEFAULT 1.0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  next_review_at TEXT NOT NULL DEFAULT '',
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Auth configuration (single-user password)
CREATE TABLE IF NOT EXISTS auth_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for foreign key columns
CREATE INDEX IF NOT EXISTS idx_topics_course_id ON topics(course_id);
CREATE INDEX IF NOT EXISTS idx_messages_topic_id ON messages(topic_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_course_id ON syllabus(course_id);
CREATE INDEX IF NOT EXISTS idx_labs_course_id ON labs(course_id);
CREATE INDEX IF NOT EXISTS idx_projects_course_id ON projects(course_id);
CREATE INDEX IF NOT EXISTS idx_topic_notes_course_id ON topic_notes(course_id);
CREATE INDEX IF NOT EXISTS idx_topic_notes_topic_id ON topic_notes(topic_id);

-- Composite indexes for hot query patterns
CREATE INDEX IF NOT EXISTS idx_messages_topic_id_role ON messages(topic_id, role);
CREATE INDEX IF NOT EXISTS idx_messages_topic_id_timestamp ON messages(topic_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_topic_notes_course_topic ON topic_notes(course_id, topic_id);

-- Indexes for lecture module
CREATE INDEX IF NOT EXISTS idx_lectures_course_id ON lectures(course_id);
CREATE INDEX IF NOT EXISTS idx_lecture_versions_lecture_id ON lecture_versions(lecture_id);
CREATE INDEX IF NOT EXISTS idx_review_items_course_id ON review_items(course_id);

-- Persistent memory per course (student profile + learning summary)
CREATE TABLE IF NOT EXISTS course_memory (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_profile TEXT NOT NULL DEFAULT '',
  learning_summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (course_id)
);
