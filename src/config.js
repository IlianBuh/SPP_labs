import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnvFile(path.join(rootDir, ".env"));

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : fallback;
}

export const config = {
  rootDir,
  port: int(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 24),
  cooldownMs: int(process.env.COOLDOWN_MS, 2000),
  gridSize: int(process.env.GRID_SIZE, 100),
  paletteSize: int(process.env.PALETTE, 16),
  opLogSize: int(process.env.OP_LOG_SIZE, 5000),
  persistFlushMs: int(process.env.PERSIST_FLUSH_MS, 100),
  heartbeatIntervalMs: int(process.env.HEARTBEAT_INTERVAL_MS, 30000),
  heartbeatTimeoutMs: int(process.env.HEARTBEAT_TIMEOUT_MS, 10000),
  maxMessageSize: 64 * 1024,
  logLevel: process.env.LOG_LEVEL || "info",
  isProduction: process.env.NODE_ENV === "production",
};