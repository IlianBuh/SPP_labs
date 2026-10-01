export const validateCreateTask = (req, res, next) => {
  const { title, description, dueDate } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    errors.push('Заголовок задачи обязателен и должен содержать минимум 2 символа.');
  }

  if (description !== undefined && typeof description !== 'string') {
    errors.push('Описание задачи должно быть строкой.');
  }

  if (!dueDate || typeof dueDate !== 'string' || isNaN(Date.parse(dueDate))) {
    errors.push('Укажите корректную дату завершения задачи.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Ошибка валидации данных',
      errors
    });
  }

  next();
};

export const validateTaskStatus = (req, res, next) => {
  const { status } = req.query;
  if (status !== undefined && status !== '' && !['pending', 'completed', 'all'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Ошибка валидации данных',
      errors: ['Некорректный статус. Допустимые значения: pending, completed, all.']
    });
  }
  next();
};