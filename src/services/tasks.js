import fs from 'fs';
import path from 'path';
import { TaskRepository } from '../repositories/tasks.js';

export class TaskService {
  static getAllTasks(status) {
    const tasks = TaskRepository.findAll(status);
    return tasks.map(this._mapTaskToDTO);
  }

  static getTaskById(id) {
    const task = TaskRepository.findById(id);
    if (!task) return null;
    return this._mapTaskToDTO(task);
  }

  static createTask({ title, description, dueDate, file }) {
    const taskData = {
      id: Date.now().toString(),
      title: title.trim(),
      description: description ? description.trim() : '',
      dueDate,
      status: 'pending',
      file: file
        ? {
            filename: file.filename,
            originalName: file.originalname,
            path: file.path
          }
        : null,
      createdAt: new Date().toISOString()
    };

    const createdTask = TaskRepository.create(taskData);
    return this._mapTaskToDTO(createdTask);
  }

  static toggleTaskStatus(id) {
    const task = TaskRepository.findById(id);
    if (!task) return null;

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const updated = TaskRepository.updateStatus(id, newStatus);
    return this._mapTaskToDTO(updated);
  }

  static deleteTask(id) {
    const deletedTask = TaskRepository.delete(id);
    if (deletedTask && deletedTask.file_path) {
      fs.unlink(path.resolve(deletedTask.file_path), (err) => {
        if (err) console.error(`Ошибка удаления файла: ${err.message}`);
      });
    }
    return deletedTask;
  }

  static _mapTaskToDTO(task) {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.due_date,
      status: task.status,
      file: task.file_filename
        ? {
            filename: task.file_filename,
            originalName: task.file_original_name
          }
        : null,
      createdAt: task.created_at
    };
  }
}