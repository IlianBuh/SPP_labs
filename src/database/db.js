import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'tasks.db'));

// Включение WAL режима для высокой производительности
db.pragma('journal_mode = WAL');

// Инициализация таблицы задач
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'completed')),
    file_filename TEXT,
    file_original_name TEXT,
    file_path TEXT,
    created_at TEXT NOT NULL
  )
`);

export default db;