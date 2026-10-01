import { AuthService, ValidationError } from '../services/auth.js';
import { SessionRepository } from '../repositories/sessions.js';
import { logger } from '../logger.js';

export class AdminController {
  static getUsers(req, res) {
    try {
      const users = AuthService.listUsers();
      res.status(200).json({ success: true, data: users });
    } catch (error) {
      logger.error('Ошибка при получении пользователей', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при получении пользователей' });
    }
  }

  static updateRole(req, res) {
    try {
      const { id } = req.params;
      const { role } = req.body || {};

      if (Number(id) === Number(req.user.id)) {
        return res.status(400).json({ success: false, message: 'Нельзя изменить роль самому себе' });
      }

      const updatedUser = AuthService.updateRole(id, role);
      if (!updatedUser) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
      }
      res.status(200).json({ success: true, data: updatedUser });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ success: false, message: 'Ошибка валидации данных', errors: [error.message] });
      }
      logger.error('Ошибка при изменении роли', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при изменении роли' });
    }
  }

  static getSessions(req, res) {
    try {
      const sessions = AuthService.listAllSessions();
      res.status(200).json({ success: true, data: sessions });
    } catch (error) {
      logger.error('Ошибка при получении сессий', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при получении сессий' });
    }
  }

  static revokeSession(req, res) {
    try {
      const revoked = SessionRepository.revoke(req.params.id);
      if (!revoked) {
        return res.status(404).json({ success: false, message: 'Сессия не найдена' });
      }
      res.status(200).json({ success: true, data: null });
    } catch (error) {
      logger.error('Ошибка при завершении сессии', { err: error });
      res.status(500).json({ success: false, message: 'Ошибка сервера при завершении сессии' });
    }
  }
}