import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../database/db.js';
import { UserRepository } from '../repositories/users.js';
import { SessionRepository } from '../repositories/sessions.js';
import { LoginAttemptRepository } from '../repositories/loginAttempts.js';
import { PasswordResetRepository } from '../repositories/passwordResets.js';
import { SessionService } from './sessions.js';
import { sendPasswordReset } from './mailer.js';
import { logger } from '../logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const LOGIN_LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = Number(process.env.RESET_TOKEN_TTL_MS) || 60 * 60 * 1000;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export class AuthService {
  static register({ email, login, password, ip, userAgent }) {
    if (typeof email !== 'string' || typeof login !== 'string' || typeof password !== 'string') {
      throw new ValidationError('Email, логин и пароль должны быть строками.');
    }
    email = email.trim().toLowerCase();
    login = login.trim();
    password = password;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError('Некорректный формат email.');
    }
    if (!login || login.length < 3) {
      throw new ValidationError('Логин должен содержать минимум 3 символа.');
    }
    if (!password || password.length < 6) {
      throw new ValidationError('Пароль должен содержать минимум 6 символов.');
    }

    if (UserRepository.findByEmail(email)) {
      throw new ConflictError('Пользователь с таким email уже существует.');
    }
    if (UserRepository.findByLogin(login)) {
      throw new ConflictError('Пользователь с таким логином уже существует.');
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const user = UserRepository.create({ email, login, passwordHash, role: 'reader' });

    return this._issueSession(user, { ip, userAgent });
  }

  static login({ login, password, ip, userAgent }) {
    if (typeof login !== 'string' || typeof password !== 'string') {
      throw new ValidationError('Логин и пароль должны быть строками.');
    }
    login = login.trim();
    password = password;

    const user = UserRepository.findByLogin(login);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      LoginAttemptRepository.recordFailure(login, ip, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS);
      logger.warn('Неудачная попытка входа', { login, ip });
      return null;
    }

    LoginAttemptRepository.reset(login, ip);
    return this._issueSession(user, { ip, userAgent });
  }

  static logout(sessionId) {
    SessionRepository.revoke(sessionId);
  }

  static listSessions(userId, currentSessionId) {
    return SessionRepository.listActiveByUser(userId).map((session) => ({
      id: session.id,
      ip: session.ip,
      userAgent: session.user_agent,
      createdAt: session.created_at,
      lastSeenAt: session.last_seen_at,
      expiresAt: session.expires_at,
      isCurrent: session.id === currentSessionId
    }));
  }

  static revokeSession(userId, sessionId) {
    const session = SessionRepository.findById(sessionId);
    if (!session || session.user_id !== userId) {
      return false;
    }
    return SessionRepository.revoke(sessionId);
  }

  static listAllSessions() {
    return SessionRepository.listActiveWithUsers().map((session) => ({
      id: session.id,
      userId: session.user_id,
      login: session.login,
      email: session.email,
      ip: session.ip,
      userAgent: session.user_agent,
      createdAt: session.created_at,
      lastSeenAt: session.last_seen_at,
      expiresAt: session.expires_at
    }));
  }

  static async forgotPassword({ email, ip }) {
    if (typeof email !== 'string' || !email.trim()) {
      throw new ValidationError('Укажите email.');
    }
    const normalized = email.trim().toLowerCase();
    const user = UserRepository.findByEmail(normalized);

    if (!user) {
      return false;
    }

    PasswordResetRepository.consumeAllUnusedByUser(user.id);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    PasswordResetRepository.create({ userId: user.id, tokenHash, ip, expiresAt });

    const resetUrl = `${APP_BASE_URL}/reset-password?token=${token}`;
    await sendPasswordReset({ to: user.email, resetUrl });
    return true;
  }

  static resetPassword({ token, password }) {
    if (typeof token !== 'string' || !token) {
      throw new ValidationError('Недействительный или истёкший токен сброса пароля.');
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new ValidationError('Пароль должен содержать минимум 6 символов.');
    }

    const tokenHash = sha256(token);
    const reset = PasswordResetRepository.findByTokenHash(tokenHash);
    const now = new Date().toISOString();
    if (!reset || reset.used_at || reset.expires_at < now) {
      throw new ValidationError('Недействительный или истёкший токен сброса пароля.');
    }

    const user = UserRepository.findById(reset.user_id);
    if (!user) {
      throw new ValidationError('Недействительный или истёкший токен сброса пароля.');
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    db.transaction(() => {
      UserRepository.updatePassword(user.id, passwordHash);
      SessionRepository.revokeAllByUser(user.id);
      PasswordResetRepository.consume(reset.id, now);
    })();

    return true;
  }

  static getUserById(id) {
    const user = UserRepository.findById(id);
    return user ? this._mapUserToDTO(user) : null;
  }

  static listUsers() {
    return UserRepository.findAll().map((user) => this._mapUserToDTO(user));
  }

  static updateRole(id, role) {
    if (!['reader', 'editor', 'admin'].includes(role)) {
      throw new ValidationError('Некорректная роль. Допустимые роли: reader, editor, admin.');
    }
    const user = UserRepository.updateRole(id, role);
    return user ? this._mapUserToDTO(user) : null;
  }

  static generateToken(user, jti) {
    return jwt.sign(
      { id: user.id, role: user.role, login: user.login, jti },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  static verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
  }

  static _issueSession(user, { ip, userAgent }) {
    const jti = SessionService.createSession(user, { ip, userAgent });
    return {
      token: this.generateToken(user, jti),
      user: this._mapUserToDTO(user),
      sessionId: jti
    };
  }

  static _mapUserToDTO(user) {
    return {
      id: user.id,
      email: user.email,
      login: user.login,
      role: user.role,
      createdAt: user.created_at
    };
  }
}

export class ValidationError extends Error {}
export class ConflictError extends Error {}