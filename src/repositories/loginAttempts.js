import db from '../database/db.js';

export class LoginAttemptRepository {
  static get(login, ip) {
    return db.prepare('SELECT * FROM login_attempts WHERE login = ? AND ip = ?').get(login, ip) || null;
  }

  static recordFailure(login, ip, lockAfter, lockMs) {
    const now = new Date().toISOString();
    const existing = this.get(login, ip);
    if (existing && existing.locked_until && existing.locked_until > now) {
      return existing;
    }

    const nextCount = (existing ? existing.failed_count : 0) + 1;
    const lockedUntil = nextCount >= lockAfter ? new Date(Date.now() + lockMs).toISOString() : null;
    const failedCount = lockedUntil ? 0 : nextCount;

    db.prepare(`
      INSERT INTO login_attempts (login, ip, failed_count, locked_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(login, ip) DO UPDATE SET
        failed_count = excluded.failed_count,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
    `).run(login, ip, failedCount, lockedUntil, now);

    return this.get(login, ip);
  }

  static reset(login, ip) {
    db.prepare('DELETE FROM login_attempts WHERE login = ? AND ip = ?').run(login, ip);
  }

  static prune(olderThan) {
    db.prepare('DELETE FROM login_attempts WHERE updated_at < ?').run(olderThan);
  }
}