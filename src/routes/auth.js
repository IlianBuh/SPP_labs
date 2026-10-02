import { Router } from 'express';
import { AuthController } from '../controllers/auth.js';
import { authenticate } from '../middlewares/auth.js';
import { ipLimiter, loginPairLimiter } from '../middlewares/rateLimit.js';

const router = Router();

router.post('/register', ipLimiter, AuthController.register);
router.post('/login', ipLimiter, loginPairLimiter, AuthController.login);
router.post('/logout', authenticate, AuthController.logout);
router.get('/sessions', authenticate, AuthController.listSessions);
router.delete('/sessions/:id', authenticate, AuthController.revokeSession);
router.post('/forgot-password', ipLimiter, AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);
router.get('/me', authenticate, AuthController.me);

export default router;