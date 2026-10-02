import db from '../database/db.js';

export class IpAttemptRepository {
  static get(ip) {
    return db.prepare('SELECT * FROM ip_attempts WHERE ip = ?').get(ip) || null;
  }

  static record(ip, windowMs) {
    const now = new Date();
    const nowIso = now.toISOString();
    const threshold = new Date(now.getTime() - windowMs).toISOString();
    const existing = this.get(ip);

    if (existing && existing.window_start >= threshold) {
      const count = existing.attempt_count + 1;
      db.prepare('UPDATE ip_attempts SET attempt_count = ? WHERE ip = ?').run(count, ip);
      return { ...existing, attempt_count: count };
    }

    db.prepare(`
      INSERT INTO ip_attempts (ip, attempt_count, window_start)
      VALUES (?, 1, ?)
      ON CONFLICT(ip) DO UPDATE SET
        attempt_count = 1,
        window_start = excluded.window_start
    `).run(ip, nowIso);
    return this.get(ip);
  }

  static prune(olderThan) {
    db.prepare('DELETE FROM ip_attempts WHERE window_start < ?').run(olderThan);
  }
}