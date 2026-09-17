import { TaskService } from '../services/tasks.js';

export class TaskController {
  static renderTasksPage(req, res) {
    try {
      const currentFilter = req.query.status || 'all';
      const tasks = TaskService.getTasks(currentFilter);

      res.render('index', {
        tasks,
        currentFilter,
        error: null
      });
    } catch (error) {
      res.status(500).send('Ошибка сервера');
    }
  }

  static handleCreateTask(req, res) {
    try {
      const { title, description, dueDate } = req.body;
      const file = req.file;

      TaskService.createTask({ title, description, dueDate, file });
      res.redirect('/');
    } catch (error) {
      const tasks = TaskService.getTasks();
      res.status(400).render('index', {
        tasks,
        currentFilter: 'all',
        error: error.message
      });
    }
  }

  static handleToggleStatus(req, res) {
    try {
      const { id } = req.params;
      TaskService.toggleTaskStatus(id);
      res.redirect('back');
    } catch (error) {
      res.redirect('/');
    }
  }

  static handleDeleteTask(req, res) {
    try {
      const { id } = req.params;
      TaskService.deleteTask(id);
      res.redirect('back');
    } catch (error) {
      res.redirect('/');
    }
  }
}