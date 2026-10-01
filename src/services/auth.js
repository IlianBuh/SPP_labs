import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserRepository } from '../repositories/users.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export class AuthService {
  static register({ email, login, password }) {
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

    return { token: this.generateToken(user), user: this._mapUserToDTO(user) };
  }

  static login({ login, password }) {
    if (typeof login !== 'string' || typeof password !== 'string') {
      throw new ValidationError('Логин и пароль должны быть строками.');
    }
    login = login.trim();
    password = password;

    const user = UserRepository.findByLogin(login);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return null;
    }

    return { token: this.generateToken(user), user: this._mapUserToDTO(user) };
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

  static generateToken(user) {
    return jwt.sign(
      { id: user.id, role: user.role, login: user.login },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  static verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
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