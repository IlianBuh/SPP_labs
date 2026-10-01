import { Router } from 'express';
import { TaskController } from '../controllers/tasks.js';
import { validateCreateTask } from '../middlewares/validateTask.js';
import { upload } from '../middlewares/upload.js';
import { authenticate, authorize } from '../middlewares/auth.js';

const router = Router();

router.get('/', authenticate, TaskController.getAll);
router.get('/:id', authenticate, TaskController.getById);
router.post('/', authenticate, authorize('editor', 'admin'), upload.single('attachment'), validateCreateTask, TaskController.create);
router.patch('/:id/toggle', authenticate, authorize('editor', 'admin'), TaskController.toggleStatus);
router.delete('/:id', authenticate, authorize('editor', 'admin'), TaskController.remove);

export default router;