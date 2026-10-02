import db from '../database/db.js';

export class SessionRepository {
  static create({ id, userId, ip, userAgent, now, expiresAt }) {
    db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, now, expiresAt, now, ip, userAgent || null);
  }

  static findById(id) {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
  }

  static listActiveByUser(userId) {
    const now = new Date().toISOString();
    return db
      .prepare(`
        SELECT * FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC
      `)
      .all(userId, now);
  }

  static listActiveWithUsers() {
    const now = new Date().toISOString();
    return db
      .prepare(`
        SELECT s.*, u.login, u.email FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.revoked_at IS NULL AND s.expires_at > ?
        ORDER BY s.created_at DESC
      `)
      .all(now);
  }

  static countActiveByUser(userId) {
    const now = new Date().toISOString();
    const row = db
      .prepare(`
        SELECT COUNT(*) AS cnt FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      `)
      .get(userId, now);
    return row.cnt;
  }

  static revoke(id) {
    const result = db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  static revokeAllByUser(userId) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
      new Date().toISOString(),
      userId
    );
  }

  static revokeOldestByUser(userId) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE sessions SET revoked_at = ?
      WHERE id = (
        SELECT id FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at ASC
        LIMIT 1
      )
    `).run(now, userId, now);
  }

  static updateLastSeen(id, ts) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(ts, id);
  }
}