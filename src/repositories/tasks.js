import fs from 'fs';
import path from 'path';

class TaskRepository {
  constructor() {
    this.tasks = [];
  }

  findAll() {
    return [...this.tasks];
  }

  findById(id) {
    return this.tasks.find((task) => task.id === id) || null;
  }

  create(taskData) {
    const task = {
      id: Date.now().toString(),
      title: taskData.title,
      description: taskData.description || '',
      dueDate: taskData.dueDate,
      status: 'pending',
      file: taskData.file || null,
      createdAt: new Date().toISOString()
    };
    this.tasks.push(task);
    return task;
  }

  updateStatus(id, status) {
    const task = this.findById(id);
    if (task) {
      task.status = status;
    }
    return task;
  }

  delete(id) {
    const index = this.tasks.findIndex((task) => task.id === id);
    if (index !== -1) {
      const [deletedTask] = this.tasks.splice(index, 1);
      if (deletedTask.file) {
        fs.unlink(path.resolve(deletedTask.file.path), () => {});
      }
      return true;
    }
    return false;
  }
}

export const taskRepository = new TaskRepository();