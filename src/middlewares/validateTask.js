export const validateCreateTask = (req, res, next) => {
  const { title, dueDate } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    errors.push('Заголовок задачи обязателен и должен содержать минимум 2 символа.');
  }

  if (!dueDate || isNaN(Date.parse(dueDate))) {
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