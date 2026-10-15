export class PaintError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "PaintError";
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Игровое состояние холста в памяти. Единственный источник правды.
 * Каждой применённой операции присваивается монотонный глобальный seq;
 * version клетки = seq операции, которая её последней покрасила (LWW).
 * Node single-threaded event loop гарантирует total order применений.
 */
export class GameState {
  constructor({ gridSize = 100, paletteSize = 16, cooldownMs = 2000, now = () => Date.now() } = {}) {
    this.gridSize = gridSize;
    this.paletteSize = paletteSize;
    this.cooldownMs = cooldownMs;
    this.now = now;
    const n = gridSize * gridSize;
    this.colors = new Int32Array(n).fill(-1);
    this.versions = new Float64Array(n);
    this.owners = new Int32Array(n);
    this.score = new Map();
    this.totalPaints = new Map();
    this.bestScore = new Map();
    this.usernames = new Map();
    this.lastPaintAt = new Map();
    this.nextSeq = 0;
  }

  idx(x, y) {
    return y * this.gridSize + x;
  }

  addUser({ id, username, score = 0, total_paints = 0, best_score = 0 }) {
    this.usernames.set(id, username);
    this.score.set(id, score);
    this.totalPaints.set(id, total_paints);
    this.bestScore.set(id, best_score);
  }

  loadUsers(users) {
    for (const u of users) this.addUser(u);
  }

  loadCells(rows) {
    for (const row of rows) {
      const i = this.idx(row.x, row.y);
      this.colors[i] = row.color;
      this.versions[i] = Number(row.version);
      this.owners[i] = row.user_id || 0;
    }
  }

  setNextSeq(seq) {
    this.nextSeq = seq;
  }

  getCell(x, y) {
    const i = this.idx(x, y);
    return { color: this.colors[i], version: this.versions[i], owner: this.owners[i] };
  }

  colorsArray() {
    return Array.from(this.colors);
  }

  cooldownRemaining(userId, now = this.now()) {
    const last = this.lastPaintAt.get(userId);
    if (last === undefined) return 0;
    return Math.max(0, this.cooldownMs - (now - last));
  }

  /**
   * Применяет покраску. Возвращает операцию { seq, x, y, color, version, user, ts }.
   * Бросает PaintError: out_of_bounds / invalid_color / cooldown.
   */
  applyPaint(userId, x, y, color, now = this.now()) {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x >= this.gridSize ||
      y < 0 ||
      y >= this.gridSize
    ) {
      throw new PaintError("out_of_bounds", "Клетка вне границ холста");
    }
    if (!Number.isInteger(color) || color < 0 || color >= this.paletteSize) {
      throw new PaintError("invalid_color", "Недопустимый цвет");
    }
    const remaining = this.cooldownRemaining(userId, now);
    if (remaining > 0) {
      throw new PaintError("cooldown", "Нужно подождать перед следующей покраской", {
        retryInMs: Math.ceil(remaining),
      });
    }

    const i = this.idx(x, y);
    const prevOwner = this.owners[i];
    const seq = this.nextSeq + 1;
    this.nextSeq = seq;
    this.colors[i] = color;
    this.versions[i] = seq;
    this.owners[i] = userId;
    this.lastPaintAt.set(userId, now);

    if (prevOwner !== userId) {
      if (prevOwner !== 0 && this.score.has(prevOwner)) {
        this.score.set(prevOwner, this.score.get(prevOwner) - 1);
      }
      this.score.set(userId, (this.score.get(userId) || 0) + 1);
    }
    this.totalPaints.set(userId, (this.totalPaints.get(userId) || 0) + 1);
    const score = this.score.get(userId) || 0;
    this.bestScore.set(userId, Math.max(this.bestScore.get(userId) || 0, score));

    return { seq, x, y, color, version: seq, user: userId, ts: now };
  }

  userStats(userId) {
    return {
      score: this.score.get(userId) || 0,
      totalPaints: this.totalPaints.get(userId) || 0,
      bestScore: this.bestScore.get(userId) || 0,
    };
  }

  leaderboard(limit = 10) {
    const list = [];
    for (const [id, score] of this.score) {
      list.push({ id, username: this.usernames.get(id) || `#${id}`, score });
    }
    list.sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
    return limit ? list.slice(0, limit) : list;
  }
}