import { AuthService } from '../services/auth.js';
import { UserRepository } from '../repositories/users.js';
import { SessionRepository } from '../repositories/sessions.js';
import { SessionService } from '../services/sessions.js';

export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res
      .status(401)
      .set('WWW-Authenticate', 'Bearer realm="api"')
      .json({ success: false, message: 'Требуется авторизация' });
  }

  try {
    const payload = AuthService.verifyToken(token);
    if (!payload.jti) {
      throw new Error('token without jti');
    }

    const session = SessionRepository.findById(payload.jti);
    if (!SessionService.isActive(session)) {
      return res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="api", error="invalid_token"')
        .json({ success: false, message: 'Недействительный или просроченный токен' });
    }

    const user = UserRepository.findById(payload.id);
    if (!user) {
      return res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="api", error="invalid_token"')
        .json({ success: false, message: 'Пользователь не найден' });
    }
    req.user = {
      id: user.id,
      role: user.role,
      login: user.login,
      email: user.email
    };
    req.sessionId = payload.jti;
    SessionService.refreshLastSeen(session);
    next();
  } catch {
    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer realm="api", error="invalid_token"')
      .json({ success: false, message: 'Недействительный или просроченный токен' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .set('WWW-Authenticate', 'Bearer realm="api", error="insufficient_scope"')
        .json({ success: false, message: 'Недостаточно прав для выполнения операции' });
    }
    next();
  };
};