import crypto from 'crypto';
import db from '../database/db.js';
import { SessionRepository } from '../repositories/sessions.js';

const MAX_SESSIONS_PER_USER = Number(process.env.MAX_SESSIONS_PER_USER) || 5;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LAST_SEEN_THRESHOLD_MS = 60 * 1000;

export class SessionService {
  static createSession(user, { ip, userAgent }) {
    const jti = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

    db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso);
      if (SessionRepository.countActiveByUser(user.id) >= MAX_SESSIONS_PER_USER) {
        SessionRepository.revokeOldestByUser(user.id);
      }
      SessionRepository.create({
        id: jti,
        userId: user.id,
        ip,
        userAgent,
        now: nowIso,
        expiresAt
      });
    })();

    return jti;
  }

  static isActive(session) {
    if (!session || session.revoked_at) {
      return false;
    }
    return session.expires_at > new Date().toISOString();
  }

  static refreshLastSeen(session) {
    const threshold = new Date(Date.now() - LAST_SEEN_THRESHOLD_MS).toISOString();
    if (session.last_seen_at < threshold) {
      SessionRepository.updateLastSeen(session.id, new Date().toISOString());
    }
  }
}