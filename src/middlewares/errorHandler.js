import multer from 'multer';
import { logger } from '../logger.js';

const BODY_PARSER_ERRORS = {
  'entity.parse.failed': {
    status: 400,
    message: 'Некорректный JSON в теле запроса'
  },
  'entity.too.large': {
    status: 413,
    message: 'Слишком большое тело запроса'
  }
};

export const apiNotFound = (req, res) => {
  res.status(404).json({ success: false, message: 'Ресурс не найден' });
};

export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'Файл слишком большой (максимум 5 МБ)' });
    }
    return res.status(400).json({ success: false, message: 'Некорректные данные файла в запросе' });
  }

  if (err.type && BODY_PARSER_ERRORS[err.type]) {
    const { status, message } = BODY_PARSER_ERRORS[err.type];
    return res.status(status).json({ success: false, message });
  }

  if (err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ success: false, message: err.message || 'Ошибка запроса' });
  }

  logger.error('Внутренняя ошибка сервера', { err, method: req.method, path: req.originalUrl });
  res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
};