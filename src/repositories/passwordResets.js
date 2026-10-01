import db from '../database/db.js';

export class PasswordResetRepository {
  static create({ userId, tokenHash, ip, expiresAt }) {
    db.prepare(`
      INSERT INTO password_resets (user_id, token_hash, expires_at, used_at, created_at, ip)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).run(userId, tokenHash, expiresAt, new Date().toISOString(), ip);
  }

  static findByTokenHash(tokenHash) {
    return db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(tokenHash) || null;
  }

  static consume(id, now) {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now, id);
  }

  static consumeAllUnusedByUser(userId) {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
      new Date().toISOString(),
      userId
    );
  }
}