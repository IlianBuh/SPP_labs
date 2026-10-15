const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

const SENSITIVE_KEYS = ["password", "token", "authorization", "cookie", "secret", "hash"];

function sanitize(value, key) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
      return "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitize(v, k);
  return out;
}

function write(level, message, fields) {
  if (LEVELS[level] < currentLevel) return;
  const entry = { ts: new Date().toISOString(), level, msg: message, ...sanitize(fields || {}, "") };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message, fields) => write("debug", message, fields),
  info: (message, fields) => write("info", message, fields),
  warn: (message, fields) => write("warn", message, fields),
  error: (message, fields) => write("error", message, fields),
};