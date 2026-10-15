# Пиксельный холст — многопользовательская веб-игра (лабораторная №4)

Многопользовательский пиксельный холст в стиле r/place: сетка 100×100, палитра из 16
цветов, кулдаун покраски 2 секунды. Счёт игрока — сколько клеток холста сейчас его
цвета. Таблица лидеров top-10, список онлайн-игроков.

## Возможности

- Мгновенная синхронизация через WebSockets (требование 1)
- Только JavaScript, без фреймворков: Express + `ws`, клиент на ванильном JS (требование 2)
- Сохранение холста и статистики в PostgreSQL между запусками (требование 3)
- Разрешение конфликтов: серверный total order + LWW (побеждает операция с большим `seq`,
  клиенты применяют операции строго по порядку) (требование 4)
- Восстановление после потери соединения: оптимистичная очередь покрасок в
  `localStorage`, переподключение с backoff, синхронизация снапшотом/дельтой (требование 5)
- Деплой на Render.com (требование 6)

## Стек

- Сервер: Node.js 22+, Express 4, `ws`, `pg`
- БД: PostgreSQL (локально — docker-compose, на проде — Supabase)
- Аутентификация: bcrypt + JWT (24 ч, `jti`) + таблица сессий, токен в httpOnly cookie
  (браузерный WebSocket присылает cookie при handshake автоматически)

## Локальный запуск

Требуется Node.js ≥ 22 и Docker.

```bash
npm ci
cp .env.example .env
docker compose up -d    # PostgreSQL 16 на localhost:5432
npm run dev             # http://localhost:3000
```

Проверка:

```bash
npm run lint
npm test
```

Ручной сценарий: откройте два окна браузера (обычное + инкогнито), зарегистрируйте
двух игроков, покрасьте одну и ту же клетку с обоих — у всех участников в итоге
одинаковое состояние. Выключите сеть (DevTools → Network → Offline), покрасьте
несколько клеток, включите снова — покраски уйдут на сервер. Перезапустите сервер —
холст и статистика восстановятся.

## Деплой на Render.com

1. **Supabase** — создайте проект (регион — ближайший к Render, европейский).
   В Dashboard → Project Settings → Database найдите строку подключения
   **Direct connection** (порт **5432**, не pgbouncer/6543). Она выглядит как
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
2. **GitHub** — запушьте этот репозиторий на GitHub.
3. **Render** — New → Blueprint (по `render.yaml`) или New Web Service, подключите
   репозиторий. Параметры:
   - Runtime: **Node**
   - Build: `npm ci`
   - Start: `node src/server.js`
   - Plan: **Free**
4. В **Environment** задайте обязательные переменные:
   - `DATABASE_URL` — direct connection из п. 1
   - `JWT_SECRET` — длинная случайная строка (например, `openssl rand -hex 32`)
   - `NODE_ENV=production` (в `render.yaml` уже задана)
5. Deploy. Проверьте `https://<имя>.onrender.com/api/health` → `{"status":"ok"}`.

Примечания для free-плана:

- Render усыпляет сервис без трафика (~15 мин): первый заход медленный.
- Supabase усыпляет проект после ~недели неактивности: первый запрос к БД медленный.
  Соединение из `pg` переживает «пробуждение» (retry при первом коннекте).
- Данные живут в Supabase и переживают рестарты/редеплои Render.

## Протокол WebSocket

Клиент → сервер: `init {lastSeq?}`, `paint {x, y, color}`.
Сервер → клиент: `snapshot {seq, colors}`, `delta {seq, ops}`, `op {...}`,
`leaderboard {list}`, `players {online}`, `error {code, message, retryInMs?}`.
Heartbeat — управляющие кадры `ping`/`pong` (браузер отвечает автоматически),
неответивший сокет закрывается.