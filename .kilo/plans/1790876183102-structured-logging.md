# План: Структурированное JSON-логирование + мидлварь лога запросов

## Требование

> Добавить структурированное логирование. Логи — в stdout, ошибки — в stderr. Мидлварь логирует обработанный запрос по завершении: путь, параметры запроса, нечувствительные данные запроса. Формат — JSON.

## Решения (согласовано с пользователем)

1. **Самописный модуль логгера** — нулевая зависимость (pino/winston не добавляем).
2. **Полная запись запроса**: `method`, `path` (originalUrl), `statusCode`, `durationMs`, `userId` (если аутентифицирован), `query`, `params` (route), `body` (только если непустой).
3. **Политика чувствительных данных**: рекурсивный denylist по ключам (сравнение в нижнем регистре): `password`, `token`, `refreshToken`, `accessToken`, `secret`, `authorization`, `cookie`, `cookies` → значение заменяется на `"[REDACTED]"`. Заголовки и multer-файлы **не логируются вообще** (заголовки не включаются в запись).
4. **Заменить все существующие `console.*`** на `logger.*` (13 мест): ошибки → `logger.error` (stderr), информационные → `logger.info` (stdout).

## Файлы

- Новый: `src/logger.js`
- Новый: `src/middlewares/requestLogger.js`
- Правки: `src/app.js`, `src/middlewares/errorHandler.js`, `src/controllers/auth.js`, `src/controllers/tasks.js`, `src/controllers/admin.js`, `src/services/tasks.js`, `src/database/db.js`

## Задачи

### 1. `src/logger.js` — модуль логгера (без зависимостей)

- API: `logger.info(msg, fields?)`, `logger.warn(...)`, `logger.error(...)`.
- Запись: `JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })` + `\n`.
- Вывод: `info`/`warn` → `process.stdout.write()`, `error` → `process.stderr.write()`.
- **Безопасный сериализатор** (replacer для `JSON.stringify`):
  - `Error` → `{ name, message, stack }` (иначе `JSON.stringify` даст `{}` и потеряет стек);
  - `BigInt` → строка;
  - не-plain-объекты (Buffer, multer File, Date и т.п.) → `"[Unserializable]"`;
  - защита от циклических ссылок через `WeakSet` увиденных объектов.
- Фильтр по уровню: env `LOG_LEVEL` (по умолчанию `info`); ниже уровня — не выводить.
- Экспорт `sanitizeSensitive(value)` — рекурсивная чистка по denylist (п. «Решения» 3): массивы обходятся, plain-объекты фильтруются по ключам, ключ из denylist → `"[REDACTED]"`, остальное — рекурсия. Соблюдать осторожность с объектами, не являющимися plain (не заходить внутрь).

### 2. `src/middlewares/requestLogger.js` — мидлварь лога запросов

- `export const requestLogger = (req, res, next) => { ... }`.
- Фиксировать `startTime = process.hrtime.bigint()`.
- Подписка на завершение с защитой от двойного лога (`let logged = false`):
  - `res.on('finish', done)` и `res.on('close', done)` — `close` страхует случай обрыва клиентом.
- В `done()`: `logger.info('request completed', { method, path: req.originalUrl, statusCode: res.statusCode, durationMs: Number(process.hrtime.bigint() - startTime) / 1e6, userId: req.user?.id, query: sanitizeSensitive(req.query), params: sanitizeSensitive(req.params), body: hasBody ? sanitizeSensitive(req.body) : undefined })`, где `hasBody = req.body` — plain-объект с хотя бы одним ключом. `undefined`-поля не попадают в JSON.
- `req.user` доступен к моменту `finish`, т.к. `authenticate` выполняется до завершения обработки.
- Работает и для ошибок: errorHandler отправляет 500 → `finish` срабатывает; отдельный `logger.error` в errorHandler дублировать не нужно (это разные записи: access-лог vs лог ошибки).

### 3. `src/app.js` — монтаж и стартовый лог

- Импорты: `requestLogger`, `logger`.
- `app.use(requestLogger)` — **после** `express.json()`/`express.urlencoded()` (чтобы `req.body` был распарсен) и **до** `express.static(...)` и роутов — логируются все запросы.
- Строка 37: `console.log(...)` → `logger.info('Сервер запущен', { port: PORT })`.

### 4. Замена всех `console.*` на `logger.*`

| Файл | Место | Замена |
|---|---|---|
| `src/middlewares/errorHandler.js:39` | `console.error(err)` | `logger.error('Внутренняя ошибка сервера', { err })` — сериализатор развернёт Error в `{name,message,stack}`; плюс `method`, `path: req.originalUrl` для контекста |
| `src/controllers/auth.js:16,33` | `console.error(error)` | `logger.error('Ошибка в AuthController', { err: error })` (сообщение можно сделать по смыслу ветки, напр. «Ошибка при регистрации») |
| `src/controllers/tasks.js` (5 мест) | `console.error(error)` | то же, `{ err: error }` |
| `src/controllers/admin.js:9,32` | `console.error(error)` | то же |
| `src/services/tasks.js:51` | `console.error(Ошибка удаления файла...)` | `logger.error('Ошибка удаления файла', { message: err.message })` |
| `src/database/db.js:56` | `console.log(Создан администратор...)` | `logger.info('Создан администратор', { login: ADMIN_LOGIN })` |

Во всех случаях передавать объект ошибки через поле `err` (не интерполировать в строку) — сериализатор сохранит стек.

## Проверка (ручная)

Запуск: `node src/app.js` (или `npm start`). Для каждого шага ответ сервера не меняется (коды/формат API без изменений).

1. `curl -X POST /api/auth/register` с `{login, email, password}` → в stdout JSON-строка access-лога: `password: "[REDACTED]"`, присутствуют `login`/`email`, каждую строку проверить `JSON.parse`.
2. `curl GET /api/tasks?status=pending` с токеном → `query: {status: "pending"}`, `userId` заполнен.
3. `curl GET /api/tasks/:id` → route `params: {id: "..."}`.
4. Вложенная чувствительность: body `{user: {password: "x"}, items: [{token: "y"}]}` → оба `"[REDACTED]"`.
5. Ошибка: `POST /api/auth/login` с битым JSON → 400 в stdout; временно вызвать 500 (или существующую ветку) → запись уровня `error` в **stderr**, а не в stdout.
6. `curl GET /` (static/SPA) → тоже логируется.
7. Ошибка с `Error` (например, сломанная БД не требуется — достаточно проследить любую упавшую операцию): в записи есть `err.stack`.
8. `LOG_LEVEL=error node src/app.js` → access-логов нет, ошибки есть (опционально).

## Риски / примечания

- **Порядок middleware**: `requestLogger` ставится после body-parser и до роутов; иначе `req.body` будет пуст.
- **JSON.stringify не должен кидать**: весь вывод идёт через безопасный сериализатор (Error, BigInt, циклы, Buffers) — иначе падение логгера сломает запрос.
- Пароль/токены попадают в лог только при обходе denylist; заголовки не логируются вовсе — утечки Authorization нет.
- Access-лог пишется на уровне `info` (stdout) всегда; серверные ошибки дополнительно логируются в `logger.error` (stderr) из errorHandler/контроллеров. 4xx — это ошибки клиента → только access-лог (info).
- Изменения не затрагивают схему БД, API-ответы и поведение роутов.