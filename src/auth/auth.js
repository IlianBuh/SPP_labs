import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { pool } from "../database/pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { authenticate, setAuthCookie, clearAuthCookie } from "./middleware.js";

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    score: row.score,
    totalPaints: row.total_paints,
    bestScore: row.best_score,
  };
}

async function createSession(user) {
  const jti = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlHours * 3600_000);
  await pool.query(
    "INSERT INTO sessions (jti, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [jti, user.id, now.toISOString(), expiresAt.toISOString()]
  );
  const token = jwt.sign(
    { id: user.id, username: user.username, jti },
    config.jwtSecret,
    { expiresIn: `${config.sessionTtlHours}h` }
  );
  return token;
}

export function createAuthRouter({ onUserCreated = () => {} } = {}) {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== "string" || !USERNAME_RE.test(username)) {
        return res.status(400).json({
          success: false,
          message: "Логин: 3–24 символа (латиница, цифры, подчёркивание)",
        });
      }
      if (typeof password !== "string" || password.length < 6 || password.length > 72) {
        return res.status(400).json({
          success: false,
          message: "Пароль: от 6 до 72 символов",
        });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      let row;
      try {
        const { rows } = await pool.query(
          `INSERT INTO users (username, password_hash)
           VALUES ($1, $2)
           RETURNING id, username, score, total_paints, best_score`,
          [username, passwordHash]
        );
        row = rows[0];
      } catch (err) {
        if (err.code === "23505") {
          return res.status(409).json({ success: false, message: "Логин уже занят" });
        }
        throw err;
      }
      const token = await createSession(row);
      onUserCreated(row);
      setAuthCookie(res, token);
      logger.info("user registered", { userId: row.id, username: row.username });
      res.status(201).json({ success: true, data: { user: publicUser(row) } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== "string" || typeof password !== "string") {
        return res.status(400).json({ success: false, message: "Неверные данные" });
      }
      const { rows } = await pool.query(
        "SELECT id, username, password_hash, score, total_paints, best_score FROM users WHERE username = $1",
        [username]
      );
      const row = rows[0];
      const ok = row ? await bcrypt.compare(password, row.password_hash) : false;
      if (!ok) {
        return res.status(401).json({ success: false, message: "Неверный логин или пароль" });
      }
      const token = await createSession(row);
      setAuthCookie(res, token);
      logger.info("user logged in", { userId: row.id, username: row.username });
      res.json({ success: true, data: { user: publicUser(row) } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", authenticate, async (req, res, next) => {
    try {
      await pool.query("UPDATE sessions SET revoked_at = now() WHERE jti = $1", [
        req.session.jti,
      ]);
      clearAuthCookie(res);
      logger.info("user logged out", { userId: req.user.id });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", authenticate, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        "SELECT id, username, score, total_paints, best_score FROM users WHERE id = $1",
        [req.user.id]
      );
      if (!rows[0]) {
        return res.status(401).json({ success: false, message: "Не авторизован" });
      }
      res.json({ success: true, data: { user: publicUser(rows[0]) } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}