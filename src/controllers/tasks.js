import { TaskService } from '../services/tasks.js';

export class TaskController {
  static getAll(req, res) {
    try {
      const { status } = req.query;
      const tasks = TaskService.getAllTasks(status);
      res.status(200).json({ success: true, data: tasks });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Ошибка сервера при получении задач' });
    }
  }

  static getById(req, res) {
    try {
      const task = TaskService.getTaskById(req.params.id);
      if (!task) {
        return res.status(404).json({ success: false, message: 'Задача не найдена' });
      }
      res.status(200).json({ success: true, data: task });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
  }

  static create(req, res) {
    try {
      const task = TaskService.createTask({
        title: req.body.title,
        description: req.body.description,
        dueDate: req.body.dueDate,
        file: req.file
      });
      res.status(201).json({ success: true, data: task });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Не удалось создать задачу' });
    }
  }

  static toggleStatus(req, res) {
    try {
      const updatedTask = TaskService.toggleTaskStatus(req.params.id);
      if (!updatedTask) {
        return res.status(404).json({ success: false, message: 'Задача не найдена' });
      }
      res.status(200).json({ success: true, data: updatedTask });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Ошибка обновления статуса' });
    }
  }

  static remove(req, res) {
    try {
      const deletedTask = TaskService.deleteTask(req.params.id);
      if (!deletedTask) {
        return res.status(404).json({ success: false, message: 'Задача не найдена' });
      }
      res.status(200).json({ success: true, message: 'Задача успешно удалена' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Ошибка при удалении задачи' });
    }
  }
}