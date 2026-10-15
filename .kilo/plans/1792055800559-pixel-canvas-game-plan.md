# План: многопользовательская веб-игра «Пиксельный холст» (лабораторная №4)

## Контекст

Рабочая папка пустая — новый проект. Репозиторий из прошлых лаб: Express 4 + better-sqlite3, JWT-аутентификация, eslint + CI lint workflow, docker-compose.

Требования задания: мгновенная синхронизация через WebSockets; только JavaScript без фреймворков (клиент — ванильный JS); сервер Express; сохранение данных между запусками; разрешение конфликтов при одновременном редактировании одного элемента; восстановление состояния после потери соединения; деплой и ссылка.

## Решения (согласованы с пользователем)

1. **Игра** — пиксельный холст в стиле r/place: сетка 100×100, палитра из 16 цветов, кулдаун покраски 2 сек (`COOLDOWN_MS`). Элемент, который редактируют конкурирующие пользователи, — клетка холста.
2. **Правила** — каждый игрок выбирает цвет; счёт = сколько клеток на холсте сейчас его цвета; статистика: всего покрасок, рекорд; таблица лидеров top-10; список онлайн-игроков.
3. **Стек** — Express (REST + статика), библиотека `ws` (клиент — нативный WebSocket браузера), клиент без фреймворков (HTML/CSS/ванильный JS + canvas).
4. **Хранилище** — PostgreSQL через `pg` (node-postgres): бесплатный Supabase (данные переживают рестарты и редеплои; на Render free нет persistent disk, SQLite-файл терялся бы). Локально — Postgres в docker-compose.
5. **Аутентификация** — полная регистрация/логин как в прошлых лабах: bcrypt, JWT 24 ч с `jti`, таблица `sessions` (логаут отзывает сессию). Токен — в httpOnly cookie `SameSite=Lax` (браузерный WebSocket не умеет ставить заголовки, а cookie присылает при handshake автоматически).
6. **Разрешение конфликтов** — серверный total order + LWW: сервер — единственный источник правды, каждой применённой операции присваивается монотонный глобальный `seq`; клетка хранит `version` и `user_id` автора; при одновременной покраске одной клетки побеждает операция с большим `seq`; клиенты применяют операции строго по порядку `seq`.
7. **Персистентность** — write-through с батчингом: операция применяется в памяти мгновенно (для мгновенного бродкаста), запись в Postgres — единой транзакцией пачкой каждые ~100 мс (`PERSIST_FLUSH_MS`), повторные попытки при сбое. При старте холст восстанавливается одним SELECT.
8. **Восстановление после потери соединения** — клиент держит оптимистичную очередь действий в localStorage (`pendingPaints`), при reconnect шлёт `init` с последним `lastSeq`, сервер отдаёт снапшот или дельту (ring buffer последних операций в памяти), затем клиент отправляет отложенные действия; сердечный сигнал ping/pong на сервере, close неответивших; на клиенте — backoff-переподключение (1с → 2с → 5с → … → 30с) и статус-баннер.
9. **Деплой** — Render.com (free): git-деплой, `render.yaml` (Blueprint), env: `DATABASE_URL` (Supabase) и `JWT_SECRET` задаются в дашборде.

## Архитектура

### Структура проекта

```
SPP_labs/
├── package.json
├── render.yaml
├── docker-compose.yaml        # локальный postgres:16
├── eslint.config.js
├── .github/workflows/lint.yml
├── .gitignore                 # node_modules, .env, data/
├── .env.example
├── src/
│   ├── server.js              # старт HTTP (Express) + WS-сервер
│   ├── config.js              # PORT, DATABASE_URL, JWT_SECRET, COOLDOWN_MS, GRID_SIZE...
│   ├── logger.js              # простой логгер (как в прошлых лабах)
│   ├── database/pool.js       # pg Pool, CREATE TABLE IF NOT EXISTS
│   ├── auth/auth.js           # register/login/logout/me, bcrypt, JWT+jti, cookie
│   ├── auth/middleware.js     # проверка JWT + сессии (для REST)
│   ├── game/gameState.js      # холст в памяти, seq, версии, кулдауны, счёт
│   ├── game/opLog.js          # ring buffer последних N=5000 операций
│   ├── game/persistence.js    # очередь записи с батч-флашем в Postgres
│   └── game/gameServer.js     # WS: handshake-авторизация, init, paint, бродкаст
└── public/
    ├── index.html             # логин/регистрация, игровой экран, лидерборд
    ├── styles.css
    └── app.js                 # весь клиент на ванильном JS
```

### Протокол WebSocket (JSON)

Клиент → сервер:
- `init { lastSeq? }` — при подключении/переподключении
- `paint { x, y, color }` — попытка покраски (валидация на сервере)
- `pong`

Сервер → клиент:
- `snapshot { seq, cells[] }` или `delta { seq, ops[] }` — если `lastSeq` в пределах ring buffer
- `op { seq, x, y, color, version, user, ts }` — бродкаст применённой операции
- `leaderboard { list: [{ username, score }] }`, `players { online: [{ id, username }] }`
- `error { code, message }` — кулдаун, чужой цвет, не авторизован
- `ping`

### Схема БД

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  score INT NOT NULL DEFAULT 0,
  total_paints INT NOT NULL DEFAULT 0,
  best_score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  jti TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS cells (
  x INT NOT NULL, y INT NOT NULL,
  color INT NOT NULL,
  version BIGINT NOT NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  painted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (x, y)
);
```

Счёт игрока меняется в той же транзакции, что и клетка: предыдущему владельцу клетки `score - 1`, новому `score + 1`; обновление `total_paints`, `best_score`.

### Разрешение конфликтов (total order + LWW)

1. Клиент шлёт `paint`; сервер проверяет: авторизация, `x,y` в границах, цвет из палитры, кулдаун игрока (в памяти, `lastPaintAt`), применяет к in-memory холсту.
2. Сервер инкрементирует глобальный `seq`, присваивает клетке новый `version`, кладёт операцию в ring buffer и очередь персистентности, бродкастит `op` всем (включая автора — автор не применяет сам, полагается на серверный порядок).
3. Конфликт двух покрасок одной клетки: обе приходят на сервер, применяются в порядке поступления (Node single-threaded гарантирует total order), побеждает операция с большим `seq`; клиенты, применяя строго по `seq`, автоматически сходятся. Никаких OT/CRDT не нужно.

### Переподключение

- Клиент: `ws.onclose`/событие `offline` → статус «Переподключение…», попытки с backoff, покраски в это время применяются локально оптимистично и копятся в `localStorage.pendingPaints` (лимит 300, старые отбрасываются).
- После `ws.open` → `init { lastSeq }` → `snapshot`/`delta` (сервер сравнивает `lastSeq` с началом ring buffer) → отправка `pendingPaints`.
- Сервер: heartbeat — `ws.ping()` каждые 30 сек, закрывает сокет без pong за 10 сек; `jti`-сессия должна быть живой (JWT 24 ч переживает reconnect).

## Зависимости

`express`, `ws`, `pg`, `bcrypt`, `jsonwebtoken`, `cookie-parser`; dev: `eslint` (конфиг как в прошлых лабах), тесты — `node:test` (без доп. пакетов).

## Задачи

### 1. Каркас проекта
- `npm init`, установка зависимостей, `package.json` scripts: `start`, `dev` (`node --watch src/server.js`), `test`, `lint`.
- `src/config.js` (env: `PORT=3000`, `DATABASE_URL`, `JWT_SECRET`, `SESSION_TTL_HOURS=24`, `COOLDOWN_MS=2000`, `GRID_SIZE=100`, `PALETTE=16`, `OP_LOG_SIZE=5000`, `PERSIST_FLUSH_MS=100`), `src/logger.js`.
- `express` статик-раздача `public/`, `cookie-parser`, JSON body, обработка ошибок.
- `eslint.config.js` + `.github/workflows/lint.yml` (npm ci, npm run lint) — как в прошлых лабах.

### 2. База данных
- `docker-compose.yaml` — `postgres:16` с volume для локальной разработки.
- `src/database/pool.js` — pg Pool (DATABASE_URL), миграции через `CREATE TABLE IF NOT EXISTS` при старте, `pool.on('error')` с логом.

### 3. Аутентификация
- `src/auth/auth.js` — `POST /api/register`, `POST /api/login` (bcrypt, JWT 24 ч, `jti = crypto.randomUUID()`, INSERT в `sessions`), `POST /api/logout` (revoke сессии), `GET /api/me`.
- `src/auth/middleware.js` — проверка JWT из cookie + сессии в БД; единая функция и для REST, и для WS-handshake (`req.upgradeReq`/headers).

### 4. Игровое состояние (память)
- `src/game/gameState.js` — холст `Int32Array(size*size)` + массивы `version`, `owner`, in-memory счёт игроков, `lastPaintAt` по userId, `nextSeq`.
- `applyPaint(userId, x, y, color)` — валидация (границы, палитра, кулдаун), мутация, `seq++`, возврат операции. Чистая функция — юнит-тест.
- `src/game/opLog.js` — ring buffer на `OP_LOG_SIZE`.

### 5. Персистентность
- `src/game/persistence.js` — очередь операций; таймер `PERSIST_FLUSH_MS` сбрасывает пачку одной транзакцией (UPDATE/INSERT клетки + счёт юзеров); при ошибке — retry с экспоненциальной задержкой (не блокирует игровой процесс).
- При старте сервера — загрузка холста и статистики из Postgres в память.

### 6. WS-сервер
- `src/game/gameServer.js` — `WebSocketServer({ noServer: true })`, Upgrade с авторизацией по cookie + проверкой Origin.
- Обработка `init` (снапшот/дельта), `paint`, `pong`; бродкаст `op`; рассылка `leaderboard` и `players` при изменениях; heartbeat; лимит размера сообщения; обработка ошибок/логирование.

### 7. Клиент (ванильный JS)
- `public/` — экран логина/регистрации; игровой экран: canvas 100×100, отрисовка через `ImageData` (одна передача), превью клетки под курсором, палитра 16 цветов и выбор активного цвета, индикатор кулдауна (затемнение кнопки/полоска), таблица лидеров и список онлайн, статус соединения.
- Очередь `pendingPaints` в localStorage, оптимистичное применение, отправка после `init`; reconnect с backoff; применение `op` строго по `seq` (пропуск/перезапись локального при рассинхроне).
- Единственный файл `app.js` (модуль/классы), без фреймворков.

### 8. Тесты и проверка
- `src/game/gameState.test.js` на `node:test`: total order (seq монотонен), LWW при одновременной покраске, кулдаун, счёт/лидерборд.

### 9. Деплой на Render
- `render.yaml`: web service `runtime: node`, `buildCommand: npm ci`, `startCommand: node src/server.js`, free plan; env: `DATABASE_URL`, `JWT_SECRET` (задаются в дашборде).
- README-инструкция в плане отсутствует — шаги для пользователя в `README.md`: создать проект Supabase (регион — ближайший к Render, европейский), получить connection string, отдать в Render (New Web Service ← GitHub-репозиторий), установить env-переменные, деплой, получить URL.
- Пункт обязателен к выполнению для сдачи (требование 6): после деплоя ссылка предоставляется в отчёте.

## Валидация

Локально: `docker compose up -d` → `npm run dev` → открыть два окна браузера (обычное + инкогнито):
1. Регистрация/логин двух игроков; мгновенная синхронизация покрасок (задержка <100 мс в одном регионе).
2. Конфликт: два клиента красят одну клетку в один момент → у обоих в итоге одинаковое состояние, победила одна операция (проверить version/автора).
3. Offline: DevTools → Network → Offline, покрасить несколько клеток, восстановить соединение → действия из очереди ушли, состояние совпало.
4. Перезапуск сервера (`Ctrl+C`, снова `npm run dev`) → холст и статистика восстановились (требование 3).
5. `npm run lint`, `npm test`.

На проде (Render): деплой, открыть ссылку, повторить пункты 1–3 в двух вкладках; пережить авто-рестарт (логои Deployment history / кнопка Restart) — данные на месте.

## Риски

- **Supabase free** — проект «засыпает» после неактивности (~неделя), первый запрос медленный (~секунды); коннект-строка с `pgbouncer`/direct-портом: использовать direct connection (порт 5432) для длинных воркеров.
- **Render free** — сервис спит без трафика (~15 мин), первый заход медленный; допустимо для сдачи.
- **Потеря данных при краше** — не более `PERSIST_FLUSH_MS` (100 мс) операций, дата теряется только при жёстком падении процесса.
- **`jti`-сессии** — если сервер на Render перезапущен, сессии остаются в Postgres, JWT продолжает работать (это плюс).