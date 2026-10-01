import { Router } from 'express';
import { AdminController } from '../controllers/admin.js';
import { authenticate, authorize } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/users', AdminController.getUsers);
router.patch('/users/:id/role', AdminController.updateRole);
router.get('/sessions', AdminController.getSessions);
router.delete('/sessions/:id', AdminController.revokeSession);

export default router;