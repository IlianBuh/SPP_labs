# План: Обработка ошибок и коды возврата в соответствии с семантикой HTTP

## Требование

> 2. Реализовать обработку ошибок и кодов возврата в соответствии с семантикой стандартов HTTP.

## Контекст

Express 4 (ESM) + better-sqlite3, SPA-фронтенд в `public/`, API на `/api/*`.
Аудит выполнен эмпирически: сервер поднят в изолированном окружении (`/tmp`), ответы проверены curl-запросами (тесты T1–T15 ниже).

## Найденные дефекты

### Критичные (нарушение семантики HTTP / формата API)

| # | Сценарий | Фактически | Ожидалось по RFC | Где |
|---|----------|-----------|------------------|-----|
| D1 | `GET /api/unknown` | **200 OK + HTML SPA** (catch-all `app.get('*')` перехватывает любой GET, включая API) | 404 JSON | `src/app.js:26` — T1 |
| D2 | `POST /api/unknown` (не-GET) | 404 HTML (default Express) | 404 JSON | `src/app.js` — T10 |
| D3 | Некорректный JSON в теле запроса | 400 HTML (default error page Express, **утечка стектрейса** в ответе) | 400 JSON | `src/app.js` — T2, T9, T15 |
| D4 | Файл > 5 МБ при создании задачи | **500 HTML** (`MulterError LIMIT_FILE_SIZE` без `status` → default-обработчик) | **413 Payload Too Large** JSON | `src/middlewares/upload.js` — T5 |
| D5 | Неожиданное поле в multipart-запросе | **500 HTML** (`LIMIT_UNEXPECTED_FILE`) | **400 Bad Request** JSON | `src/middlewares/upload.js` — T7 |
| D6 | 401 без токена / с невалидным токеном | 401 JSON, но **без заголовка `WWW-Authenticate`** | RFC 9110 §15.5.2: 401 **обязан** содержать `WWW-Authenticate`; RFC 6750: `WWW-Authenticate: Bearer` | `src/middlewares/auth.js` — T4, T11 |
| D7 | Нет централизованного обработчика ошибок | Форматы и коды ошибок разрознены (HTML/JSON, 500 вместо 400/413), нет единого логирования | Единый JSON-формат + правильные коды + логирование | `src/app.js` — следствие D1–D5 |

### Средние

| # | Сценарий | Фактически | Ожидалось | Где |
|---|----------|-----------|-----------|-----|
| D8 | `description` не строка (например, число) | **500** («Не удалось создать задачу») | 400 Bad Request (ошибка валидации данных) | `src/services/tasks.js:21`, `src/middlewares/validateTask.js` — T13 |
| D9 | Ошибки БД/сервиса в `TaskController` | 500 отдаётся без `console.error` — баги скрыты, диагностика невозможна | логировать ошибку (как в auth/admin контроллерах) | `src/controllers/tasks.js` |

### Низкие / опциональные

| # | Сценарий | Фактически | Комментарий |
|---|----------|-----------|-------------|
| D10 | `DELETE /api/tasks/:id` | 200 + тело | Допустимо по RFC 9110 §9.3.5, но идиоматичнее **204 No Content** |
| D11 | `GET /api/tasks?status=garbage` | 200 + все задачи (фильтр молча игнорируется) | Либо 400 на неизвестный статус, либо документированное поведение — T14 |
| D12 | `GET /api/auth/me` для удалённого пользователя | 401 в контроллере | Недостижимо (проверка уже в `authenticate`); корректнее 404 — не трогать |
| D13 | Заголовок `X-Powered-By: Express` | раскрывает технологию | Опциональный хардненинг |

## Задачи по исправлению

### 1. Централизованный обработчик ошибок + 404 для API (`src/app.js`, новый `src/middlewares/errorHandler.js`)

- Новый middleware `errorHandler(err, req, res, next)`:
  - `err instanceof multer.MulterError`:
    - `LIMIT_FILE_SIZE` → **413** JSON «Файл слишком большой (максимум 5 МБ)»;
    - `LIMIT_UNEXPECTED_FILE` и прочие → **400** JSON.
  - Ошибки body-parser: `err.type === 'entity.parse.failed'` (иначе `err instanceof SyntaxError && err.status === 400`) → **400** JSON «Некорректный JSON в теле запроса».
  - Если у ошибки есть осмысленный `err.status` в диапазоне 400–499 → вернуть его с JSON-телом.
  - Иначе → **500** JSON «Внутренняя ошибка сервера»; `console.error(err)` (с текстом ошибки, но **без** деталей в ответе).
- 404 для API: `app.use('/api', apiNotFound)` с JSON-ответом **после** монтирования всех API-роутов и **до** SPA-fallback.
- SPA fallback `app.get('*', ...)` оставить только для не-API путей (за счёт порядка обработчиков).
- Рекомендация: `express.json({ limit: '1mb' })` — превышение лимита тела станет 413, а не необработанная ошибка.

### 2. `WWW-Authenticate` на 401 (`src/middlewares/auth.js`)

- Оба 401-ответа в `authenticate` дополнить заголовком:
  `WWW-Authenticate: Bearer realm="api"` (RFC 6750);
  при недействительном/просроченном токене — `WWW-Authenticate: Bearer realm="api", error="invalid_token"`.
- Опционально: 403 от `authorize` — `WWW-Authenticate: Bearer error="insufficient_scope"`.

### 3. Валидация типов и входных данных (`src/middlewares/validateTask.js`, `src/services/auth.js`)

- `validateCreateTask`: проверять типы — `title`/`description` должны быть строками (или отсутствовать для description); `dueDate` — разбираемая дата. Несоответствие → 400 JSON.
- `validateTaskStatus` (новый): для `GET /api/tasks` — `pending | completed | all` (или отсутствие параметра); иное → 400. Реализует D11 явно.
- `AuthService.register/login`: перед `.trim()` убедиться, что `email`/`login`/`password` — строки (`typeof`), иначе выбрасывать `ValidationError` (сейчас возможен TypeError → 500).

### 4. Логирование 500 (`src/controllers/tasks.js`)

- Во всех `catch` блоков `TaskController` добавить `console.error(error)` — единый стиль с auth/admin контроллерами (D9).

### 5. Опциональная идиоматика (по согласованию)

- `DELETE /api/tasks/:id` → **204** без тела (D10); фронтенд в `public/js/app.js` поправить под отсутствие тела.
- `app.disable('x-powered-by')` (D13).
- Попытка смены роли самому себе — оставить 400 (семантически спорно, но согласовано ранее).

## Проверка (ручная, повтор тестов T1–T15)

| Тест | Запрос | Ожидание после фикса |
|------|--------|----------------------|
| T1  | `GET /api/unknown` без токена | 404 JSON |
| T2  | `POST /api/auth/register` с битым JSON | 400 JSON, без стектрейса |
| T4  | `GET /api/tasks` без токена | 401 JSON + `WWW-Authenticate: Bearer` |
| T5  | `POST /api/tasks` с файлом 6 МБ (токен editor) | 413 JSON |
| T7  | `POST /api/tasks` с неожиданным полем файла | 400 JSON |
| T8  | `PATCH /api/tasks/1/toggle` (не существует) | 404 JSON (без изменений) |
| T11 | `GET /api/tasks` с мусорным токеном | 401 JSON + `WWW-Authenticate: Bearer error="invalid_token"` |
| T13 | `POST /api/tasks` `description: 123` | 400 JSON |
| T14 | `GET /api/tasks?status=garbage` | 400 JSON |
| T10 | `POST /api/unknown` | 404 JSON |

Регресс: регистрация (201), логин (200/401), создание задачи с файлом ≤5 МБ (201), toggle (200/404), удаление (204/404), админ-панель (200/400/403/404) — все корректные коды не меняются.

## Риски / примечания

- Порядок middleware в `app.js` критичен: API-404 и error-handler ставятся после роутов, SPA-fallback — последним.
- При удалении задачи с файлом файл удаляется асинхронно (уже реализовано) — не затрагивается.
- Изменения не затрагивают схему БД и формат успешных ответов `{success:true, data}`.