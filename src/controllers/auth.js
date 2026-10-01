import { AuthService, ValidationError, ConflictError } from '../services/auth.js';
import { logger } from '../logger.js';

const FORGOT_MESSAGE = 'Если пользователь с таким email существует, ссылка для сброса отправлена';

export class AuthController {
  static register(req, res) {
    try {
      const { email, login, password } = req.body;
      const data = AuthService.register({
        email,
        login,
        password,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || null
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ success: false, message: 'Ошибка валидации данных', errors: [error.message] });
      }
      if (error instanceof ConflictError) {
        return res.status(409).json({ success: false, message: error.message });
      }
      logger.error('Ошибка при регистрации', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации' });
    }
  }

  static login(req, res) {
    try {
      const { login, password } = req.body;
      const data = AuthService.login({
        login,
        password,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || null
      });
      if (!data) {
        return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
      }
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ success: false, message: 'Ошибка валидации данных', errors: [error.message] });
      }
      logger.error('Ошибка при входе', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при входе' });
    }
  }

  static logout(req, res) {
    try {
      AuthService.logout(req.sessionId);
      res.status(200).json({ success: true, data: null });
    } catch (error) {
      logger.error('Ошибка при выходе', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при выходе' });
    }
  }

  static listSessions(req, res) {
    try {
      const sessions = AuthService.listSessions(req.user.id, req.sessionId);
      res.status(200).json({ success: true, data: sessions });
    } catch (error) {
      logger.error('Ошибка при получении сессий', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при получении сессий' });
    }
  }

  static revokeSession(req, res) {
    try {
      const revoked = AuthService.revokeSession(req.user.id, req.params.id);
      if (!revoked) {
        return res.status(404).json({ success: false, message: 'Сессия не найдена' });
      }
      res.status(200).json({ success: true, data: null });
    } catch (error) {
      logger.error('Ошибка при завершении сессии', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при завершении сессии' });
    }
  }

  static async forgotPassword(req, res) {
    try {
      const { email } = req.body || {};
      await AuthService.forgotPassword({ email, ip: req.ip });
      res.status(200).json({ success: true, message: FORGOT_MESSAGE, data: null });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ success: false, message: 'Ошибка валидации данных', errors: [error.message] });
      }
      logger.error('Ошибка при запросе сброса пароля', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при запросе сброса пароля' });
    }
  }

  static resetPassword(req, res) {
    try {
      const { token, password } = req.body || {};
      AuthService.resetPassword({ token, password });
      res.status(200).json({ success: true, message: 'Пароль успешно изменён. Войдите с новым паролем.', data: null });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ success: false, message: 'Ошибка валидации данных', errors: [error.message] });
      }
      logger.error('Ошибка при сбросе пароля', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при сбросе пароля' });
    }
  }

  static me(req, res) {
    const user = AuthService.getUserById(req.user.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Пользователь не найден' });
    }
    res.status(200).json({ success: true, data: user });
  }
}