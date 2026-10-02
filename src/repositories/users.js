import db from '../database/db.js';

export class UserRepository {
  static findByLogin(login) {
    const stmt = db.prepare('SELECT * FROM users WHERE login = ?');
    return stmt.get(login) || null;
  }

  static findByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email) || null;
  }

  static findById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id) || null;
  }

  static findAll() {
    const stmt = db.prepare('SELECT * FROM users ORDER BY created_at ASC');
    return stmt.all();
  }

  static create(userData) {
    const stmt = db.prepare(`
      INSERT INTO users (email, login, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      userData.email,
      userData.login,
      userData.passwordHash,
      userData.role || 'reader',
      new Date().toISOString()
    );
    return this.findById(result.lastInsertRowid);
  }

  static updateRole(id, role) {
    const stmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    const result = stmt.run(role, id);
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  static updatePassword(id, passwordHash) {
    const stmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    return stmt.run(passwordHash, id).changes > 0;
  }
}