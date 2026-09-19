import { Router } from 'express';
import { TaskController } from '../controllers/tasks.js';
import { validateCreateTask } from '../middlewares/validateTask.js';
import { upload } from '../middlewares/upload.js';

const router = Router();

router.get('/', TaskController.getAll);
router.get('/:id', TaskController.getById);
router.post('/', upload.single('attachment'), validateCreateTask, TaskController.create);
router.patch('/:id/toggle', TaskController.toggleStatus);
router.delete('/:id', TaskController.remove);

export default router;