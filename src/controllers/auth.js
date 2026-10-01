import { AuthService, ValidationError, ConflictError } from '../services/auth.js';
import { logger } from '../logger.js';

export class AuthController {
  static register(req, res) {
    try {
      const { email, login, password } = req.body;
      const data = AuthService.register({ email, login, password });
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
      const data = AuthService.login({ login, password });
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

  static me(req, res) {
    const user = AuthService.getUserById(req.user.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Пользователь не найден' });
    }
    res.status(200).json({ success: true, data: user });
  }
}