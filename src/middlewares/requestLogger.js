import { logger, sanitizeSensitive } from '../logger.js';

const hasBody = (body) => {
  return !!body && typeof body === 'object' && Object.keys(body).length > 0;
};

export const requestLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  let logged = false;

  const done = () => {
    if (logged) {
      return;
    }
    logged = true;

    logger.info('request completed', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - startTime) / 1e6,
      userId: req.user ? req.user.id : undefined,
      query: sanitizeSensitive(req.query),
      params: sanitizeSensitive(req.params),
      body: hasBody(req.body) ? sanitizeSensitive(req.body) : undefined
    });
  };

  res.on('finish', done);
  res.on('close', done);
  next();
};