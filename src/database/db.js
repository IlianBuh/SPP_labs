import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { logger } from '../logger.js';

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

// Инициализация таблицы пользователей
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    login TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reader'
      CHECK(role IN ('reader', 'editor', 'admin')),
    created_at TEXT NOT NULL
  )
`);

// Сид первого админа из env-переменных (idempotent)
const { ADMIN_EMAIL, ADMIN_LOGIN, ADMIN_PASSWORD } = process.env;
if (ADMIN_EMAIL && ADMIN_LOGIN && ADMIN_PASSWORD) {
  const existing = db
    .prepare('SELECT id FROM users WHERE email = ? OR login = ?')
    .get(ADMIN_EMAIL, ADMIN_LOGIN);

  if (!existing) {
    db.prepare(`
      INSERT INTO users (email, login, password_hash, role, created_at)
      VALUES (?, ?, ?, 'admin', ?)
    `).run(ADMIN_EMAIL.trim(), ADMIN_LOGIN.trim(), bcrypt.hashSync(ADMIN_PASSWORD, 10), new Date().toISOString());
    logger.info('Создан администратор', { login: ADMIN_LOGIN });
  }
}

export default db;