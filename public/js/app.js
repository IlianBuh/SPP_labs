class TaskApp {
  constructor() {
    this.currentFilter = 'all';
    this.currentUser = null;
    this.token = localStorage.getItem('token');

    this.authScreen = document.getElementById('auth-screen');
    this.appScreen = document.getElementById('app-screen');
    this.loginForm = document.getElementById('login-form');
    this.registerForm = document.getElementById('register-form');
    this.forgotPasswordForm = document.getElementById('forgot-password-form');
    this.forgotPasswordLink = document.getElementById('forgot-password-link');
    this.backToLoginBtn = document.getElementById('back-to-login-btn');
    this.resetPasswordForm = document.getElementById('reset-password-form');
    this.resetBackToLoginBtn = document.getElementById('reset-back-to-login-btn');
    this.authTabs = document.querySelectorAll('.auth-tab');
    this.logoutBtn = document.getElementById('logout-btn');
    this.userInfo = document.getElementById('user-info');
    this.createTaskCard = document.getElementById('create-task-card');
    this.adminPanel = document.getElementById('admin-panel');
    this.usersContainer = document.getElementById('users-list');
    this.sessionsPanel = document.getElementById('sessions-panel');
    this.sessionsContainer = document.getElementById('sessions-list');
    this.adminSessionsBlock = document.getElementById('admin-sessions-block');
    this.adminSessionsContainer = document.getElementById('admin-sessions-list');
    this.form = document.getElementById('create-task-form');
    this.tasksContainer = document.getElementById('tasks-list');
    this.errorBanner = document.getElementById('error-banner');
    this.successBanner = document.getElementById('success-banner');
    this.filterButtons = document.querySelectorAll('.filter-btn');

    this.init();
  }

  init() {
    this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    this.registerForm.addEventListener('submit', (e) => this.handleRegister(e));
    this.forgotPasswordForm.addEventListener('submit', (e) => this.handleForgotPassword(e));
    this.resetPasswordForm.addEventListener('submit', (e) => this.handleResetPassword(e));
    this.forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.showForgotForm();
    });
    this.backToLoginBtn.addEventListener('click', () => this.showLoginForm());
    this.resetBackToLoginBtn.addEventListener('click', () => this.showLoginForm());
    this.logoutBtn.addEventListener('click', () => this.logout());
    this.form.addEventListener('submit', (e) => this.handleCreateTask(e));
    this.authTabs.forEach((tab) => {
      tab.addEventListener('click', (e) => this.switchAuthTab(e.target.dataset.tab));
    });
    this.filterButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => this.handleFilterChange(e));
    });

    const resetToken = new URLSearchParams(window.location.search).get('token');
    if (resetToken) {
      this.authTabs.forEach((tab) => tab.classList.add('hidden'));
      this.loginForm.classList.add('hidden');
      this.registerForm.classList.add('hidden');
      this.forgotPasswordForm.classList.add('hidden');
      this.resetPasswordForm.classList.remove('hidden');
      this.showAuthScreen();
    } else if (this.token) {
      this.restoreSession();
    } else {
      this.showAuthScreen();
    }
  }

  // ---------- Вспомогательные ----------

  showError(message) {
    this.errorBanner.textContent = message;
    this.errorBanner.classList.remove('hidden');
    setTimeout(() => {
      this.errorBanner.classList.add('hidden');
    }, 5000);
  }

  showSuccess(message) {
    this.successBanner.textContent = message;
    this.successBanner.classList.remove('hidden');
    setTimeout(() => {
      this.successBanner.classList.add('hidden');
    }, 6000);
  }

  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU');
  }

  escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
  }

  async apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && this.token) {
      this.logout();
      throw new Error('Сессия истекла, войдите заново');
    }
    return response;
  }

  // ---------- Авторизация ----------

  showAuthScreen() {
    this.authScreen.classList.remove('hidden');
    this.appScreen.classList.add('hidden');
  }

  showAppScreen() {
    this.authScreen.classList.add('hidden');
    this.appScreen.classList.remove('hidden');
  }

  switchAuthTab(tab) {
    this.authTabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    this.loginForm.classList.toggle('hidden', tab !== 'login');
    this.registerForm.classList.toggle('hidden', tab !== 'register');
    this.forgotPasswordForm.classList.add('hidden');
    this.resetPasswordForm.classList.add('hidden');
  }

  showLoginForm() {
    this.authTabs.forEach((tab) => tab.classList.remove('hidden'));
    this.switchAuthTab('login');
  }

  showForgotForm() {
    this.authTabs.forEach((tab) => tab.classList.add('hidden'));
    this.loginForm.classList.add('hidden');
    this.registerForm.classList.add('hidden');
    this.resetPasswordForm.classList.add('hidden');
    this.forgotPasswordForm.classList.remove('hidden');
  }

  async handleForgotPassword(e) {
    e.preventDefault();
    const email = this.forgotPasswordForm.elements.email.value.trim();
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Не удалось отправить ссылку');

      this.showSuccess(result.message || 'Если пользователь с таким email существует, ссылка для сброса отправлена');
      this.forgotPasswordForm.reset();
      this.showLoginForm();
    } catch (err) {
      this.showError(err.message);
    }
  }

  async handleResetPassword(e) {
    e.preventDefault();
    const password = this.resetPasswordForm.elements.password.value;
    const passwordConfirm = this.resetPasswordForm.elements.passwordConfirm.value;
    const token = new URLSearchParams(window.location.search).get('token');

    if (password !== passwordConfirm) {
      return this.showError('Пароли не совпадают');
    }

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const result = await response.json();
      if (!response.ok) {
        const errorText = result.errors ? result.errors.join(', ') : result.message;
        throw new Error(errorText || 'Не удалось сбросить пароль');
      }

      history.replaceState(null, '', '/');
      this.showSuccess('Пароль успешно изменён. Войдите с новым паролем.');
      this.resetPasswordForm.reset();
      this.showLoginForm();
    } catch (err) {
      this.showError(err.message);
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    const formData = new FormData(this.loginForm);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: formData.get('login'), password: formData.get('password') })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Не удалось войти');

      this.setSession(result.data.token, result.data.user);
    } catch (err) {
      this.showError(err.message);
    }
  }

  async handleRegister(e) {
    e.preventDefault();
    const formData = new FormData(this.registerForm);
    const password = formData.get('password');

    if (password !== formData.get('passwordConfirm')) {
      return this.showError('Пароли не совпадают');
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.get('email'), login: formData.get('login'), password })
      });
      const result = await response.json();
      if (!response.ok) {
        const errorText = result.errors ? result.errors.join(', ') : result.message;
        throw new Error(errorText || 'Не удалось зарегистрироваться');
      }

      this.setSession(result.data.token, result.data.user);
    } catch (err) {
      this.showError(err.message);
    }
  }

  async restoreSession() {
    try {
      const response = await this.apiFetch('/api/auth/me');
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Не удалось восстановить сессию');
      this.setCurrentUser(result.data);
    } catch (err) {
      this.showError(err.message);
    }
  }

  setSession(token, user) {
    this.token = token;
    localStorage.setItem('token', token);
    this.setCurrentUser(user);
  }

  setCurrentUser(user) {
    this.currentUser = user;
    this.showAppScreen();
    this.renderUserInfo();
    this.updateRoleUI();
    this.fetchTasks();
    this.fetchSessions();
    if (user.role === 'admin') {
      this.fetchUsers();
      this.fetchAdminSessions();
    }
  }

  logout() {
    const token = this.token;
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem('token');
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }
    this.showAuthScreen();
  }

  renderUserInfo() {
    if (!this.currentUser) return;
    const roleNames = { reader: 'Читатель', editor: 'Редактор', admin: 'Админ' };
    this.userInfo.innerHTML = `<strong>${this.escapeHtml(this.currentUser.login)}</strong>
      <span class="role-badge">${roleNames[this.currentUser.role] || this.currentUser.role}</span>`;
  }

  updateRoleUI() {
    const canEdit = this.currentUser && ['editor', 'admin'].includes(this.currentUser.role);
    this.createTaskCard.classList.toggle('hidden', !canEdit);
    this.adminPanel.classList.toggle('hidden', this.currentUser.role !== 'admin');
  }

  // ---------- Задачи ----------

  async fetchTasks() {
    try {
      const response = await this.apiFetch(`/api/tasks?status=${this.currentFilter}`);
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
      const response = await this.apiFetch('/api/tasks', {
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
      const response = await this.apiFetch(`/api/tasks/${id}/toggle`, {
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
      const response = await this.apiFetch(`/api/tasks/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Не удалось удалить задачу');
      }

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
    const canEdit = this.currentUser && ['editor', 'admin'].includes(this.currentUser.role);

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
        ${
          canEdit
            ? `<div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-success btn-toggle" data-id="${task.id}">
                  ${task.status === 'completed' ? 'Вернуть' : 'Завершить'}
                </button>
                <button class="btn btn-danger btn-delete" data-id="${task.id}">Удалить</button>
              </div>`
            : ''
        }
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

  // ---------- Панель админа ----------

  async fetchUsers() {
    try {
      const response = await this.apiFetch('/api/admin/users');
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Ошибка загрузки пользователей');
      this.renderUsers(result.data);
    } catch (err) {
      this.showError(err.message);
    }
  }

  renderUsers(users) {
    const roleNames = { reader: 'Читатель', editor: 'Редактор', admin: 'Админ' };

    this.usersContainer.innerHTML = users
      .map(
        (user) => `
      <div class="user-item">
        <div>
          <div><strong>${this.escapeHtml(user.login)}</strong> <span class="role-badge">${roleNames[user.role] || user.role}</span></div>
          <div style="font-size: 0.8em; color: #64748b;">${this.escapeHtml(user.email)}</div>
        </div>
        <select class="role-select" data-id="${user.id}" ${user.id === this.currentUser.id ? 'disabled' : ''}>
          ${['reader', 'editor', 'admin']
            .map((role) => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${roleNames[role]}</option>`)
            .join('')}
        </select>
      </div>
    `
      )
      .join('');

    this.usersContainer.querySelectorAll('.role-select:not([disabled])').forEach((select) => {
      select.addEventListener('change', () => this.updateUserRole(select.dataset.id, select.value));
    });
  }

  async updateUserRole(id, role) {
    try {
      const response = await this.apiFetch(`/api/admin/users/${id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const result = await response.json();
      if (!response.ok) {
        const errorText = result.errors ? result.errors.join(', ') : result.message;
        throw new Error(errorText || 'Не удалось изменить роль');
      }
      this.fetchUsers();
      this.fetchTasks();
    } catch (err) {
      this.showError(err.message);
      this.fetchUsers();
    }
  }

  // ---------- Мои сессии ----------

  async fetchSessions() {
    try {
      const response = await this.apiFetch('/api/auth/sessions');
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Ошибка загрузки сессий');
      this.renderSessions(result.data);
    } catch (err) {
      this.showError(err.message);
    }
  }

  renderSessions(sessions) {
    if (sessions.length === 0) {
      this.sessionsContainer.innerHTML = '<p style="text-align: center; color: #64748b;">Нет активных сессий.</p>';
      return;
    }

    this.sessionsContainer.innerHTML = sessions
      .map(
        (session) => `
      <div class="user-item">
        <div>
          <div>
            ${session.isCurrent ? '<span class="role-badge">текущая сессия</span>' : '<strong>Сессия</strong>'}
          </div>
          <div style="font-size: 0.85em; color: #475569;">${this.escapeHtml(session.userAgent || 'Неизвестный браузер')}</div>
          <div style="font-size: 0.8em; color: #64748b;">
            IP: ${this.escapeHtml(session.ip)} · Создана: ${this.formatDate(session.createdAt)} · Активность: ${this.formatDate(session.lastSeenAt)}
          </div>
        </div>
        <button class="btn btn-danger btn-revoke" data-id="${session.id}" ${session.isCurrent ? 'disabled' : ''}>Завершить</button>
      </div>
    `
      )
      .join('');

    this.sessionsContainer.querySelectorAll('.btn-revoke:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => this.revokeSession(btn.dataset.id));
    });
  }

  async revokeSession(id) {
    try {
      const response = await this.apiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Не удалось завершить сессию');
      }
      this.fetchSessions();
    } catch (err) {
      this.showError(err.message);
    }
  }

  // ---------- Сессии пользователей (админ) ----------

  async fetchAdminSessions() {
    try {
      const response = await this.apiFetch('/api/admin/sessions');
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Ошибка загрузки сессий');
      this.renderAdminSessions(result.data);
    } catch (err) {
      this.showError(err.message);
    }
  }

  renderAdminSessions(sessions) {
    this.adminSessionsBlock.classList.remove('hidden');
    if (sessions.length === 0) {
      this.adminSessionsContainer.innerHTML = '<p style="text-align: center; color: #64748b;">Нет активных сессий.</p>';
      return;
    }

    this.adminSessionsContainer.innerHTML = sessions
      .map(
        (session) => `
      <div class="user-item">
        <div>
          <div>
            <strong>${this.escapeHtml(session.login)}</strong>
            <span class="role-badge">${this.escapeHtml(session.email)}</span>
          </div>
          <div style="font-size: 0.85em; color: #475569;">${this.escapeHtml(session.userAgent || 'Неизвестный браузер')}</div>
          <div style="font-size: 0.8em; color: #64748b;">
            IP: ${this.escapeHtml(session.ip)} · Создана: ${this.formatDate(session.createdAt)} · Активность: ${this.formatDate(session.lastSeenAt)}
          </div>
        </div>
        <button class="btn btn-danger btn-revoke" data-id="${session.id}">Завершить</button>
      </div>
    `
      )
      .join('');

    this.adminSessionsContainer.querySelectorAll('.btn-revoke').forEach((btn) => {
      btn.addEventListener('click', () => this.revokeAdminSession(btn.dataset.id));
    });
  }

  async revokeAdminSession(id) {
    try {
      const response = await this.apiFetch(`/api/admin/sessions/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Не удалось завершить сессию');
      }
      this.fetchAdminSessions();
    } catch (err) {
      this.showError(err.message);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TaskApp();
});