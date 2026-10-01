const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'authorization',
  'cookie',
  'cookies'
]);

const isPlainObject = (value) => {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
};

export const sanitizeSensitive = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitive(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeSensitive(val);
    }
  }
  return result;
};

const toSafe = (value, seen) => {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object' && value !== null) {
    if (isPlainObject(value) || Array.isArray(value)) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    } else {
      return '[Unserializable]';
    }
  }
  return value;
};

const LEVELS = { info: 1, warn: 2, error: 3 };
const configLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const write = (level, msg, fields) => {
  if (LEVELS[level] < configLevel) {
    return;
  }
  const prepSeen = new WeakSet();
  const walkSeen = new WeakSet();
  const safeFields = {};
  for (const [key, value] of Object.entries(fields)) {
    safeFields[key] = toSafe(value, prepSeen);
  }
  const record = { level, time: new Date().toISOString(), msg, ...safeFields };
  const line = `${JSON.stringify(record, (key, value) => toSafe(value, walkSeen))}\n`;
  if (level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
};

export const logger = {
  info(msg, fields = {}) {
    write('info', msg, fields);
  },
  warn(msg, fields = {}) {
    write('warn', msg, fields);
  },
  error(msg, fields = {}) {
    write('error', msg, fields);
  }
};