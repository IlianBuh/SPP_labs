import { AuthService } from '../services/auth.js';
import { UserRepository } from '../repositories/users.js';

export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }

  try {
    const payload = AuthService.verifyToken(token);
    const user = UserRepository.findById(payload.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Пользователь не найден' });
    }
    req.user = {
      id: user.id,
      role: user.role,
      login: user.login,
      email: user.email
    };
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Недействительный или просроченный токен' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Недостаточно прав для выполнения операции' });
    }
    next();
  };
};