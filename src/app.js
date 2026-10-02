import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import taskRoutes from './routes/tasks.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import { apiNotFound, errorHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { logger } from './logger.js';

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.disable('x-powered-by');
app.use(cors());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tasks', taskRoutes);

app.use('/api', apiNotFound);

app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info('Сервер запущен', { port: PORT });
});