# План: защита от подбора паролей, контроль активных сессий, восстановление доступа по email

## Контекст

SPA-менеджер задач (Express 4 + better-sqlite3, `public/` static, JWT-аутентификация 24 ч). Сейчас JWT stateless: отозвать подключение нельзя, лимитов и учёта попыток входа нет, сброс пароля отсутствует. Паттерн кода: routes → controllers → services → repositories, структурированный логгер с `sanitizeSensitive`, сид через `CREATE TABLE IF NOT EXISTS` в `src/database/db.js`.

## Решения (согласованы с пользователем)

1. **Доставка email** — `nodemailer`; если `SMTP_HOST` не задан → dev-fallback: ссылка сброса пишется в лог через `logger.info`.
2. **Сессии** — таблица `sessions` в SQLite + `jti` в JWT; `authenticate` проверяет сессию в БД (отзыв работает мгновенно, данные переживают рестарт).
3. **Видимость сессий** — пользователь видит и отзывает свои; админ — обзор всех сессий с отзывом любой.
4. **Лимит сессий** — `MAX_SESSIONS_PER_USER` (по умолчанию 5): при превышении отзывается самая старая активная сессия, новый вход проходит.
5. **Защита от подбора** — пара (login + IP): 5 неудач → блокировка 15 мин (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MS`), счётчик в SQLite, сброс после успешного входа; плюс общий IP-лимит на auth-эндпоинты (20 запросов / 15 мин, `LOGIN_IP_MAX_ATTEMPTS`, `LOGIN_IP_WINDOW_MS`).
6. **Сброс пароля** — ссылка с токеном (crypto 32 байта, в БД — sha256-хеш), TTL 60 мин (`RESET_TOKEN_TTL_MS`), одноразовая, единственная активная на пользователя; после сброса отзываются **все** сессии. Ответ on forgot-password одинаковый независимо от существования email (анти-энумерация).
7. **Токен `jti`** — `crypto.randomUUID()`; срок жизни сессии = сроку JWT (24 ч).
8. **Под защитой IP-лимитера** — `POST /login`, `POST /register`, `POST /forgot-password`.
9. Регистрация продолжает автоматически логинить (создаёт сессию).

## Зависимости

`npm i nodemailer` (чистый JS, native-сборка в Dockerfile не меняется). Для `jti` — встроенный `crypto`.

## Задачи

### 1. БД (`src/database/db.js`) — новые таблицы (CREATE TABLE IF NOT EXISTS)

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- jti
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL,
  ip TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(login, ip)
);

CREATE TABLE IF NOT EXISTS ip_attempts (
  ip TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  ip TEXT NOT NULL
);
```

### 2. Репозитории (по паттерну `users.js` / `tasks.js`)

- `src/repositories/sessions.js` — `SessionRepository`:
  `create({id, userId, ip, userAgent, now, expiresAt})`, `findById(id)`, `listActiveByUser(userId)`, `listActiveWithUsers()` (JOIN users → login/email), `countActiveByUser(userId)`, `revoke(id)`, `revokeAllByUser(userId)`, `revokeOldestByUser(userId)`, `updateLastSeen(id, ts)`.
  «Активная» = `revoked_at IS NULL AND expires_at > now`.
- `src/repositories/loginAttempts.js` — `LoginAttemptRepository`:
  `get(login, ip)`, `recordFailure(login, ip, lockAfter, lockMs)` (upsert: при `failed_count + 1 >= lockAfter` → `failed_count = 0`, `locked_until = now + lockMs`), `reset(login, ip)`, `prune(olderThan)`.
- `src/repositories/ipAttempts.js` — `IpAttemptRepository`:
  `record(ip, windowMs)` (upsert: если `now - window_start > windowMs` → сброс окна; иначе `attempt_count + 1`), `get(ip)`.
- `src/repositories/passwordResets.js` — `PasswordResetRepository`:
  `create({userId, tokenHash, ip, expiresAt})`, `findByTokenHash(tokenHash)`, `consume(id, now)`, `consumeAllUnusedByUser(userId)`.

### 3. Службы

- `src/services/sessions.js` — `SessionService`:
  - `createSession(user, {ip, userAgent})` — транзакция (db.transaction): вытеснение старых при `countActiveByUser >= MAX_SESSIONS_PER_USER` (`revokeOldestByUser`), вставка новой, возврат `jti`.
  - `isActive(session)` — не отозвана и не истекла.
  - `refreshLastSeen(session)` — обновление, только если прошло > 60 с (уменьшение записи на каждый запрос).
- `src/services/mailer.js` — `sendPasswordReset({to, resetUrl})`:
  - если `SMTP_HOST` задан → `nodemailer.createTransport` (port/user/pass), `from = SMTP_FROM`;
  - иначе → `logger.info('mail dev fallback', { to, resetUrl })` — единственное место, где ссылка попадает в лог.
- `src/services/auth.js` — доработка:
  - `generateToken(user, jti)` — payload `{ id, role, login, jti }`, `expiresIn: '24h'`.
  - `login({login, password, ip, userAgent})` — при неверных данных: `LoginAttemptRepository.recordFailure` (+ `logger.warn` с `login` и `ip`, без пароля); при успехе: `reset(login, ip)` + `SessionService.createSession` → `{token, user, sessionId}`.
  - `register(...)` — принимает контекст (`ip`, `userAgent`), создаёт сессию, возвращает как сейчас.
  - `logout(sessionId)` — `SessionRepository.revoke`.
  - `listSessions(userId, currentSessionId)` — активные сессии + флаг `isCurrent`.
  - `revokeSession(userId, sessionId)` — отзыв только своей сессии.
  - `forgotPassword({email, ip})` — нормализация email; пользователь может не существовать — поведение одинаковое; при существующем: `consumeAllUnusedByUser`, `create` токена, `sendPasswordReset({to: email, resetUrl: APP_BASE_URL + '/reset-password?token=' + token})`; токен наружу не возвращается.
  - `resetPassword({token, password})` — sha256 токена → поиск; ошибка, если не найден / `used_at` проставлен / `expires_at < now`; валидация пароля ≥ 6; обновление `password_hash` (bcrypt 10); `revokeAllByUser`; `consume`. Возвращает успех без токена.
- `src/middlewares/rateLimit.js`:
  - `loginPairLimiter` — для `POST /login`: если `login_attempts.locked_until > now` → 429 `{success:false, message:'Слишком много попыток входа. Попробуйте позже'}` (без раскрытия причины); прочие проверки — в `AuthService.login`.
  - `ipLimiter` (фабрика `/auth|register|forgot/` применима ко всем трём) — `IpAttemptRepository.record(ip, LOGIN_IP_WINDOW_MS)`; превышение `LOGIN_IP_MAX_ATTEMPTS` → 429 с тем же общим сообщением.
  - Периодическая `prune` устаревших записей (при каждом вызове — `DELETE WHERE updated_at < now - max(window, TTL)`; простая и достаточная очистка).

### 4. Мидлварь `src/middlewares/auth.js` — проверка сессии

- `authenticate`: после `verifyToken` — `payload.jti`; `SessionRepository.findById(jti)`; если сессии нет / отозвана / истекла → 401 `invalid_token` (прежний формат ответа); иначе `req.sessionId = jti`, `SessionService.refreshLastSeen`, `next()`.

### 5. Контроллеры и роуты

- `src/routes/auth.js`:
  - `POST /login` — `ipLimiter`, `loginPairLimiter`, `AuthController.login`;
  - `POST /register` — `ipLimiter`, `AuthController.register`;
  - `POST /logout` — `authenticate`, отзыв текущей сессии;
  - `GET /sessions` — `authenticate`, список своих сессий;
  - `DELETE /sessions/:id` — `authenticate`, отзыв своей сессии (404 чужой/несуществующей);
  - `POST /forgot-password` — `ipLimiter`;
  - `POST /reset-password`;
  - `GET /me` — без изменений.
- `src/controllers/auth.js` — новые методы по существующему стилю (try/catch, `{success, data}`, `ValidationError` → 400); прокинуть `req.ip` и `req.headers['user-agent']` в сервисы; forgot-password отвечает одинаковым сообщением всегда; reset-password возвращает 400 при невалидном/истёкшем токене (`ValidationError`).
- `src/controllers/admin.js` + `src/routes/admin.js`:
  - `GET /api/admin/sessions` — все активные сессии с login/email пользователя;
  - `DELETE /api/admin/sessions/:id` — отзыв любой сессии (включая свою текущую — следующий запрос админа вернёт 401, фронтенд разлогинит).

### 6. Фронтенд (`public/index.html`, `public/js/app.js`, `public/css/style.css`)

- **Login-форма**: ссылка «Забыли пароль?» → форма ввода email (submit → `POST /api/auth/forgot-password`) → сообщение «Если пользователь с таким email существует, ссылка для сброса отправлена» и возврат к логину.
- **Reset-форма**: при загрузке страницы, если `location.search` содержит `token` → вместо экрана входа показать форму «Новый пароль + подтверждение» → `POST /api/auth/reset-password` → сообщение об успехе, возврат к логину.
- **Панель «Активные подключения»** (видна всем ролям): `GET /api/auth/sessions` → список (user-agent, ip, создана/последняя активность, бейдж «текущая»); кнопка «Завершить» (disabled у текущей) → `DELETE /api/auth/sessions/:id`, перерисовка.
- **Выход**: перед очисткой `localStorage` — `POST /api/auth/logout` (fire-and-forget).
- **Админ-панель**: блок «Сессии пользователей»: `GET /api/admin/sessions` (логин, email, UA, ip, время), кнопка «Завершить» → `DELETE /api/admin/sessions/:id`.
- При 401 (отзыв сессии другим админом/вытеснение) существующий `apiFetch` уже разлогинивает.

### 7. Конфигурация

- `src/app.js` — без изменений маршрутизации; `SESSION_TTL_MS` не вводим (равен 24 ч JWT).
- `.env.example` и `docker-compose.yaml` — новые переменные:
  `LOGIN_MAX_ATTEMPTS=5`, `LOGIN_LOCKOUT_MS=900000`, `LOGIN_IP_MAX_ATTEMPTS=20`, `LOGIN_IP_WINDOW_MS=900000`, `MAX_SESSIONS_PER_USER=5`, `RESET_TOKEN_TTL_MS=3600000`, `APP_BASE_URL=http://localhost:3000`, `SMTP_HOST=` (пусто → fallback), `SMTP_PORT=587`, `SMTP_USER=`, `SMTP_PASS=`, `SMTP_FROM=`.
- В `src/services/auth.js`/`mailer.js` — чтение env с безопасными дефолтами (как `JWT_SECRET`).

## Проверка (ручная)

1. `npm start`; регистрация → `GET /api/auth/sessions` показывает сессию с бейджем «текущая»; `POST /api/auth/logout` → следующий запрос с токеном → 401.
2. Вход с двух браузеров → две сессии; «Завершить» одной → её запросы 401, вторая работает.
3. `MAX_SESSIONS_PER_USER=3`, 4 быстрых входа → остаются 3, самая старая отозвана.
4. Подбор: 5 неверных паролей → 6-я попытка (даже с верным паролем) → 429; при `LOGIN_LOCKOUT_MS=5000` через 5 с вход проходит; верный пароль сбрасывает счётчик.
5. IP-лимит: `for i in $(seq 1 21); do curl -s -o /dev/null -w "%{http_code}\n" -X POST /api/auth/login ...; done | sort | uniq -c` → 20×401/400 и затем 429 независимо от логина.
6. Forgot-password без SMTP → в логе `mail dev fallback` со ссылкой; открыть ссылку → форма сброса; новый пароль работает, старый — нет; все сессии отозваны (второй браузер получает 401).
7. Повторное использование ссылки → 400; при `RESET_TOKEN_TTL_MS=1000` истёкшая → 400; несуществующий email → тот же ответ, что и существующий.
8. Админ: `GET /api/admin/sessions` показывает чужие сессии; отзыв чужой → 401 у неё; отзыв своей — фронтенд разлогинивает при следующем запросе.
9. `docker compose build && docker compose up` — сборка без native-изменений (nodemailer — чистый JS).

## Риски / примечания

- Все ответы блокировок и сброса — общие формулировки: не раскрываем ни существование аккаунта, ни состояние блокировки (анти-энумерация).
- Ссылка с токеном попадает в лог **только** в dev-fallback; при настроенном SMTP в логах — только `userId`. `requestLogger` уже редактирует поля `token`/`password`.
- `authenticate` добавляет 1 чтение из SQLite на запрос + запись `last_seen` не чаще раза в минуту — приемлемо для учебного объёма (WAL).
- Вытеснение старых сессий и создание новой — в одной транзакции (better-sqlite3 `db.transaction`).
- Сброс пароля отзывает все сессии, включая текущую: после сброса требуется повторный вход.
- Миграций нет — `CREATE TABLE IF NOT EXISTS` в `db.js` по существующему стилю; существующая БД обновится при старте.