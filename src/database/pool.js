import pg from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => logger.error("unexpected pg pool error", { error: err.message }));

export async function initDatabase() {
  if (!config.databaseUrl) {
    throw new Error(
      "DATABASE_URL не задан. Скопируйте .env.example в .env и запустите docker compose up -d"
    );
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      score INT NOT NULL DEFAULT 0,
      total_paints INT NOT NULL DEFAULT 0,
      best_score INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      jti TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS cells (
      x INT NOT NULL,
      y INT NOT NULL,
      color INT NOT NULL,
      version BIGINT NOT NULL,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      painted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (x, y)
    );
    DELETE FROM sessions WHERE expires_at < now();
  `);
  logger.info("database ready");
}