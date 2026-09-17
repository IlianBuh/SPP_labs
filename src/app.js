import express from 'express';
import path from 'path';
import fs from 'fs';
import taskRoutes from './routes/tasks.js';

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.use('/', taskRoutes);

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});