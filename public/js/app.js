class TaskApp {
  constructor() {
    this.currentFilter = 'all';
    this.form = document.getElementById('create-task-form');
    this.tasksContainer = document.getElementById('tasks-list');
    this.errorBanner = document.getElementById('error-banner');
    this.filterButtons = document.querySelectorAll('.filter-btn');

    this.init();
  }

  init() {
    this.form.addEventListener('submit', (e) => this.handleCreateTask(e));
    this.filterButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => this.handleFilterChange(e));
    });

    this.fetchTasks();
  }

  showError(message) {
    this.errorBanner.textContent = message;
    this.errorBanner.classList.remove('hidden');
    setTimeout(() => {
      this.errorBanner.classList.add('hidden');
    }, 5000);
  }

  async fetchTasks() {
    try {
      const response = await fetch(`/api/tasks?status=${this.currentFilter}`);
      const result = await response.json();

      if (!response.ok) throw new Error(result.message || 'Ошибка загрузки данных');

      this.renderTasks(result.data);
    } catch (err) {
      this.showError(err.message);
    }
  }

  async handleCreateTask(e) {
    e.preventDefault();
    const formData = new FormData(this.form);

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        const errorText = result.errors ? result.errors.join(', ') : result.message;
        throw new Error(errorText || 'Не удалось создать задачу');
      }

      this.form.reset();
      this.fetchTasks();
    } catch (err) {
      this.showError(err.message);
    }
  }

  async toggleTaskStatus(id) {
    try {
      const response = await fetch(`/api/tasks/${id}/toggle`, {
        method: 'PATCH'
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Не удалось обновить статус');

      this.fetchTasks();
    } catch (err) {
      this.showError(err.message);
    }
  }

  async deleteTask(id) {
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Не удалось удалить задачу');

      this.fetchTasks();
    } catch (err) {
      this.showError(err.message);
    }
  }

  handleFilterChange(e) {
    this.filterButtons.forEach((btn) => btn.classList.remove('active'));
    e.target.classList.add('active');
    this.currentFilter = e.target.dataset.status;
    this.fetchTasks();
  }

  renderTasks(tasks) {
    if (tasks.length === 0) {
      this.tasksContainer.innerHTML = '<p style="text-align: center; color: #64748b;">Задачи не найдены.</p>';
      return;
    }

    this.tasksContainer.innerHTML = tasks
      .map(
        (task) => `
      <div class="task-item ${task.status === 'completed' ? 'completed' : ''}">
        <div>
          <div class="title"><strong>${this.escapeHtml(task.title)}</strong></div>${task.description ? `<div style="font-size: 0.9em; color: #475569;">${this.escapeHtml(task.description)}</div>` : ''}
          <div style="font-size: 0.8em; color: #64748b; margin-top: 0.2rem;">
            Срок: ${task.dueDate} \vert{} Статус: ${task.status === 'completed' ? 'Завершено' : 'В процессе'}
          </div>
          ${
            task.file
              ? `<div style="margin-top: 0.3rem; font-size: 0.85em;">
                  📎 <a href="/uploads/${task.file.filename}" download="${task.file.originalName}">${this.escapeHtml(task.file.originalName)}</a>
                 </div>`
              : ''
          }
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-success btn-toggle" data-id="${task.id}">
            ${task.status === 'completed' ? 'Вернуть' : 'Завершить'}
          </button>
          <button class="btn btn-danger btn-delete" data-id="${task.id}">Удалить</button>
        </div>
      </div>
    `
      )
      .join('');

    // Навешивание обработчиков событий
    this.tasksContainer.querySelectorAll('.btn-toggle').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleTaskStatus(btn.dataset.id));
    });

    this.tasksContainer.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteTask(btn.dataset.id));
    });
  }

  escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TaskApp();
});