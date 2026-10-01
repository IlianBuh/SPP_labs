import { LoginAttemptRepository } from '../repositories/loginAttempts.js';
import { IpAttemptRepository } from '../repositories/ipAttempts.js';

const LOGIN_LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000;
const LOGIN_IP_MAX_ATTEMPTS = Number(process.env.LOGIN_IP_MAX_ATTEMPTS) || 20;
const LOGIN_IP_WINDOW_MS = Number(process.env.LOGIN_IP_WINDOW_MS) || 15 * 60 * 1000;

const TOO_MANY_MESSAGE = 'Слишком много попыток входа. Попробуйте позже';

const prune = () => {
  const threshold = new Date(Date.now() - Math.max(LOGIN_IP_WINDOW_MS, LOGIN_LOCKOUT_MS)).toISOString();
  LoginAttemptRepository.prune(threshold);
  IpAttemptRepository.prune(threshold);
};

// Блокировка пары (login + ip) на время локдауна
export const loginPairLimiter = (req, res, next) => {
  const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
  if (!login) {
    return next();
  }

  const attempt = LoginAttemptRepository.get(login, req.ip);
  if (attempt && attempt.locked_until && attempt.locked_until > new Date().toISOString()) {
    return res.status(429).json({ success: false, message: TOO_MANY_MESSAGE });
  }
  next();
};

// Общий лимит запросов с одного IP на auth-эндпоинты
export const ipLimiter = (req, res, next) => {
  const record = IpAttemptRepository.record(req.ip, LOGIN_IP_WINDOW_MS);
  if (record && record.attempt_count > LOGIN_IP_MAX_ATTEMPTS) {
    return res.status(429).json({ success: false, message: TOO_MANY_MESSAGE });
  }
  prune();
  next();
};