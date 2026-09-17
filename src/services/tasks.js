import { taskRepository } from '../repositories/tasks.js';

export class TaskService {
  static getTasks(filterStatus = 'all') {
    const tasks = taskRepository.findAll();

    if (filterStatus === 'pending' || filterStatus === 'completed') {
      return tasks.filter((task) => task.status === filterStatus);
    }

    return tasks;
  }

  static createTask({ title, description, dueDate, file }) {
    if (!title || !dueDate) {
      throw new Error('Название задачи и дата завершения обязательны.');
    }

    const fileData = file
      ? {
          filename: file.filename,
          originalName: file.originalname,
          path: file.path
        }
      : null;

    return taskRepository.create({ title, description, dueDate, file: fileData });
  }

  static toggleTaskStatus(id) {
    const task = taskRepository.findById(id);
    if (!task) {
      throw new Error('Задача не найдена.');
    }

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    return taskRepository.updateStatus(id, newStatus);
  }

  static deleteTask(id) {
    return taskRepository.delete(id);
  }
}