import { logger } from "../logger.js";

export async function loadInitialState(pool) {
  const [cellsRes, usersRes, maxRes] = await Promise.all([
    pool.query("SELECT x, y, color, version, user_id FROM cells"),
    pool.query("SELECT id, username, score, total_paints, best_score FROM users ORDER BY id"),
    pool.query("SELECT COALESCE(MAX(version), 0)::bigint AS max_version FROM cells"),
  ]);
  return {
    cells: cellsRes.rows,
    users: usersRes.rows,
    nextSeq: Number(maxRes.rows[0].max_version),
  };
}

/**
 * Очередь записи операций в Postgres с батч-флашем.
 * Операция уже применена в памяти; сюда приходит для персистентности.
 * Пачка сбрасывается одной транзакцией каждые flushMs; при сбое —
 * экспоненциальный retry (не блокирует игровой процесс).
 */
export class Persistence {
  constructor({ pool, flushMs = 100, maxQueue = 200000, log = logger }) {
    this.pool = pool;
    this.flushMs = flushMs;
    this.maxQueue = maxQueue;
    this.log = log;
    this.queue = [];
    this.timer = null;
    this.flushing = false;
    this.failures = 0;
    this.stopped = false;
  }

  push(op) {
    if (this.stopped) return;
    this.queue.push(op);
    if (this.queue.length > this.maxQueue) {
      const dropped = this.queue.splice(0, this.queue.length - this.maxQueue);
      this.log.warn("persistence queue overflow, dropping oldest ops", { dropped: dropped.length });
    }
    this.schedule();
  }

  schedule() {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.flushMs);
  }

  async flush() {
    if (this.flushing || this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.flushing = true;
    try {
      await this.flushBatch(batch);
      this.failures = 0;
      this.log.debug("persistence flushed", { ops: batch.length });
    } catch (err) {
      this.failures += 1;
      if (!this.stopped) this.queue = batch.concat(this.queue);
      this.log.error("persistence flush failed", {
        error: err.message,
        failures: this.failures,
        lost: this.stopped ? batch.length : 0,
        queued: this.queue.length,
      });
      if (!this.stopped) {
        const delay = Math.min(1000 * 2 ** (this.failures - 1), 30000);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, delay);
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Одна транзакция на пачку: клетки upsert'ятся в порядке seq,
   * счёт игроков пересчитывается агрегированными дельтами.
   */
  async flushBatch(ops) {
    const client = await this.pool.connect();
    const paintCounts = new Map();
    const peakDelta = new Map();
    const running = new Map();
    const bump = (userId, d) => {
      const cur = (running.get(userId) || 0) + d;
      running.set(userId, cur);
      peakDelta.set(userId, Math.max(peakDelta.get(userId) || 0, cur));
    };
    try {
      await client.query("BEGIN");
      for (const op of ops) {
        const { rows } = await client.query(
          `WITH prev AS (SELECT user_id FROM cells WHERE x = $1 AND y = $2)
           INSERT INTO cells (x, y, color, version, user_id, painted_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (x, y) DO UPDATE SET
             color = EXCLUDED.color,
             version = EXCLUDED.version,
             user_id = EXCLUDED.user_id,
             painted_at = now()
           RETURNING (SELECT user_id FROM prev) AS prev_user`,
          [op.x, op.y, op.color, op.version, op.user]
        );
        const prev = rows[0].prev_user;
        if (prev !== null && prev !== op.user) {
          bump(prev, -1);
        }
        if (prev !== op.user) {
          bump(op.user, 1);
        }
        paintCounts.set(op.user, (paintCounts.get(op.user) || 0) + 1);
      }
      for (const [userId, delta] of running) {
        await client.query(
          `UPDATE users SET
             score = score + $2,
             total_paints = total_paints + $3,
             best_score = GREATEST(best_score, score + $4)
           WHERE id = $1`,
          [userId, delta, paintCounts.get(userId) || 0, peakDelta.get(userId) || 0]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* клиент уже разорван — игнорируем */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** Финальный сброс перед остановкой (после stop() допускается один flush). */
  async flushNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}