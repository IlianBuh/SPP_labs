import jwt from "jsonwebtoken";
import { pool } from "../database/pool.js";
import { config } from "../config.js";

export const COOKIE_NAME = "token";

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: config.sessionTtlHours * 3600_000,
    path: "/",
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
  });
}

export function parseCookies(header) {
  const out = {};
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/**
 * Общая проверка авторизации для REST и WS-upgrade.
 * Возвращает { user, session } или null; вызывает БД для проверки живой сессии.
 */
export async function authenticateRequest(req) {
  const cookies = req.cookies || parseCookies(req.headers && req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
  if (!payload || !payload.jti) return null;
  const { rows } = await pool.query(
    "SELECT jti, user_id, expires_at, revoked_at FROM sessions WHERE jti = $1",
    [payload.jti]
  );
  const session = rows[0];
  if (!session || session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;
  const { rows: userRows } = await pool.query(
    "SELECT id, username, score, total_paints, best_score FROM users WHERE id = $1",
    [session.user_id]
  );
  if (!userRows[0]) return null;
  return { user: userRows[0], session, token };
}

export async function authenticate(req, res, next) {
  try {
    const ctx = await authenticateRequest(req);
    if (!ctx) {
      return res.status(401).json({ success: false, message: "Не авторизован" });
    }
    req.user = ctx.user;
    req.session = ctx.session;
    next();
  } catch (err) {
    next(err);
  }
}