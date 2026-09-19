import db from '../database/db.js';

export class TaskRepository {
  static findAll(status = 'all') {
    if (status === 'pending' || status === 'completed') {
      const stmt = db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC');
      return stmt.all(status);
    }
    const stmt = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC');
    return stmt.all();
  }

  static findById(id) {
    const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id) || null;
  }

  static create(taskData) {
    const stmt = db.prepare(`
      INSERT INTO tasks (id, title, description, due_date, status, file_filename, file_original_name, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      taskData.id,
      taskData.title,
      taskData.description,
      taskData.dueDate,
      taskData.status,
      taskData.file ? taskData.file.filename : null,
      taskData.file ? taskData.file.originalName : null,
      taskData.file ? taskData.file.path : null,
      taskData.createdAt
    );

    return this.findById(taskData.id);
  }

  static updateStatus(id, status) {
    const stmt = db.prepare('UPDATE tasks SET status = ? WHERE id = ?');
    const result = stmt.run(status, id);
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  static delete(id) {
    const task = this.findById(id);
    if (!task) return null;

    const stmt = db.prepare('DELETE FROM tasks WHERE id = ?');
    stmt.run(id);
    return task;
  }
}