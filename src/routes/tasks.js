import { Router } from 'express';
import { TaskController } from '../controllers/tasks.js';
import { upload } from '../middlewares/upload.js';

const router = Router();

router.get('/', TaskController.renderTasksPage);
router.post('/tasks', upload.single('attachment'), TaskController.handleCreateTask);
router.post('/tasks/:id/toggle', TaskController.handleToggleStatus);
router.post('/tasks/:id/delete', TaskController.handleDeleteTask);

export default router;