import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'tutor.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = initDb();
  }
  return db;
}

function initDb(): Database.Database {
  const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;
  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  database.exec(schema);

  // Migration: fix topic_notes FK — topic_id references syllabus rows, not topics rows
  // Recreate table without the incorrect FK constraint (SQLite can't ALTER FK)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS topic_notes_v2 (
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
      INSERT OR IGNORE INTO topic_notes_v2 SELECT * FROM topic_notes;
      DROP TABLE topic_notes;
      ALTER TABLE topic_notes_v2 RENAME TO topic_notes;
    `);
    console.log('Migration applied: topic_notes FK fix');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.log('Migration skipped: topic_notes already migrated');
    } else {
      throw err;
    }
  }

  // Migration: add course_memory table
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS course_memory (
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        user_profile TEXT NOT NULL DEFAULT '',
        learning_summary TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (course_id)
      )
    `);
    console.log('Migration applied: course_memory');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.log('Migration skipped: course_memory already exists');
    } else {
      throw err;
    }
  }

  // Migration: add content_type and content_summary to lectures
  try {
    database.exec(`ALTER TABLE lectures ADD COLUMN content_type TEXT NOT NULL DEFAULT 'markdown';`);
    console.log('Migration applied: lectures.content_type');
  } catch (err: any) {
    if (err?.message?.includes('duplicate column') || err?.message?.includes('already exists')) {
      console.log('Migration skipped: lectures.content_type already exists');
    } else {
      throw err;
    }
  }
  try {
    database.exec(`ALTER TABLE lectures ADD COLUMN content_summary TEXT NOT NULL DEFAULT '';`);
    console.log('Migration applied: lectures.content_summary');
  } catch (err: any) {
    if (err?.message?.includes('duplicate column') || err?.message?.includes('already exists')) {
      console.log('Migration skipped: lectures.content_summary already exists');
    } else {
      throw err;
    }
  }

  // Migration: add lecture_format to courses
  try {
    database.exec(`ALTER TABLE courses ADD COLUMN lecture_format TEXT NOT NULL DEFAULT 'markdown';`);
    console.log('Migration applied: courses.lecture_format');
  } catch (err: any) {
    if (err?.message?.includes('duplicate column') || err?.message?.includes('already exists')) {
      console.log('Migration skipped: courses.lecture_format already exists');
    } else {
      throw err;
    }
  }

  // Migration: add generation_error to courses
  try {
    database.exec(`ALTER TABLE courses ADD COLUMN generation_error TEXT;`);
    console.log('Migration applied: courses.generation_error');
  } catch (err: any) {
    if (err?.message?.includes('duplicate column') || err?.message?.includes('already exists')) {
      console.log('Migration skipped: courses.generation_error already exists');
    } else {
      throw err;
    }
  }

  // Re-create indexes
  database.exec('CREATE INDEX IF NOT EXISTS idx_topic_notes_course_id ON topic_notes(course_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_topic_notes_topic_id ON topic_notes(topic_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_topic_notes_course_topic ON topic_notes(course_id, topic_id)');

  return database;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined as unknown as Database.Database;
  }
}
