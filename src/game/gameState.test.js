import { test } from "node:test";
import assert from "node:assert/strict";
import { GameState, PaintError } from "./gameState.js";
import { OpLog } from "./opLog.js";

function makeGame(overrides = {}) {
  let t = 1_000_000;
  const clock = {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
  const state = new GameState({ now: clock.now, ...overrides });
  state.loadUsers([
    { id: 1, username: "alice" },
    { id: 2, username: "bob" },
    { id: 3, username: "carol" },
  ]);
  return { state, clock };
}

test("total order: seq монотонен и version совпадает с seq", () => {
  const { state, clock } = makeGame();
  const a = state.applyPaint(1, 0, 0, 3);
  clock.advance(2000);
  const b = state.applyPaint(2, 5, 5, 7);
  clock.advance(2000);
  const c = state.applyPaint(1, 0, 1, 1);
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(c.seq, 3);
  assert.ok(a.seq < b.seq && b.seq < c.seq);
  assert.deepEqual(a, { seq: 1, x: 0, y: 0, color: 3, version: 1, user: 1, ts: 1_000_000 });
});

test("LWW: одновременная покраска одной клетки — побеждает больший seq", () => {
  const { state, clock } = makeGame();
  state.applyPaint(1, 7, 7, 3);
  clock.advance(2000);
  state.applyPaint(2, 7, 7, 7);
  const cell = state.getCell(7, 7);
  assert.equal(cell.color, 7);
  assert.equal(cell.owner, 2);
  assert.equal(cell.version, 2);
  assert.equal(state.score.get(1), 0);
  assert.equal(state.score.get(2), 1);
});

test("перекраска своей клетки не меняет счёт", () => {
  const { state, clock } = makeGame();
  state.applyPaint(1, 3, 3, 1);
  clock.advance(2000);
  state.applyPaint(1, 3, 3, 2);
  clock.advance(2000);
  state.applyPaint(2, 4, 4, 5);
  assert.equal(state.score.get(1), 1);
  assert.equal(state.score.get(2), 1);
  assert.equal(state.totalPaints.get(1), 2);
});

test("счёт переходит от прежнего владельца к новому", () => {
  const { state, clock } = makeGame();
  state.applyPaint(1, 0, 0, 1);
  clock.advance(2000);
  state.applyPaint(1, 1, 0, 1);
  clock.advance(2000);
  state.applyPaint(2, 0, 0, 2);
  assert.equal(state.score.get(1), 1);
  assert.equal(state.score.get(2), 1);
  const stats = state.userStats(1);
  assert.equal(stats.score, 1);
  assert.equal(stats.totalPaints, 2);
  assert.equal(stats.bestScore, 2);
});

test("кулдаун: вторая покраска раньше COOLDOWN_MS отклоняется с retryInMs", () => {
  const { state, clock } = makeGame({ cooldownMs: 2000 });
  state.applyPaint(1, 5, 5, 1);
  assert.throws(
    () => state.applyPaint(1, 6, 6, 2),
    (err) => err instanceof PaintError && err.code === "cooldown" && err.extra.retryInMs === 2000
  );
  clock.advance(1999);
  assert.throws(() => state.applyPaint(1, 6, 6, 2), (err) => err.code === "cooldown");
  clock.advance(1);
  const op = state.applyPaint(1, 6, 6, 2);
  assert.equal(op.seq, 2);
  assert.equal(state.lastPaintAt.get(1), 1_002_000);
});

test("кулдаун не мешает другим игрокам", () => {
  const { state, clock } = makeGame();
  state.applyPaint(1, 0, 0, 1);
  clock.advance(100);
  const op = state.applyPaint(2, 0, 0, 2);
  assert.equal(op.seq, 2);
});

test("валидация границ и палитры", () => {
  const { state } = makeGame({ gridSize: 10, paletteSize: 16 });
  assert.throws(() => state.applyPaint(1, -1, 0, 1), (e) => e.code === "out_of_bounds");
  assert.throws(() => state.applyPaint(1, 10, 0, 1), (e) => e.code === "out_of_bounds");
  assert.throws(() => state.applyPaint(1, 0, 10, 1), (e) => e.code === "out_of_bounds");
  assert.throws(() => state.applyPaint(1, 1.5, 0, 1), (e) => e.code === "out_of_bounds");
  assert.throws(() => state.applyPaint(1, 0, 0, 16), (e) => e.code === "invalid_color");
  assert.throws(() => state.applyPaint(1, 0, 0, -1), (e) => e.code === "invalid_color");
  assert.throws(() => state.applyPaint(1, 0, 0, 1.5), (e) => e.code === "invalid_color");
});

test("leaderboard: сортировка по убыванию счёта и лимит", () => {
  const { state, clock } = makeGame();
  state.applyPaint(1, 0, 0, 1);
  clock.advance(2000);
  state.applyPaint(1, 1, 0, 1);
  clock.advance(2000);
  state.applyPaint(2, 2, 2, 1);
  clock.advance(2000);
  state.applyPaint(3, 3, 3, 1);
  clock.advance(2000);
  state.applyPaint(1, 4, 4, 1); // alice: 3, bob: 1, carol: 1
  const list = state.leaderboard(2);
  assert.equal(list.length, 2);
  assert.equal(list[0].username, "alice");
  assert.equal(list[0].score, 3);
  assert.equal(list[1].score, 1);
});

test("OpLog: дельта в пределах буфера, снапшот при устаревшем lastSeq", () => {
  const log = new OpLog(3);
  assert.deepEqual(log.fromSeq(null), []);
  for (let i = 1; i <= 3; i++) log.push({ seq: i, x: i, y: i, color: 1, version: i, user: 1, ts: 0 });
  assert.equal(log.firstSeq, 1);
  assert.equal(log.lastSeq, 3);
  const delta = log.fromSeq(1);
  assert.deepEqual(delta.map((o) => o.seq), [2, 3]);
  assert.deepEqual(log.fromSeq(3), []);
  assert.deepEqual(log.fromSeq(0), null);
});

test("OpLog ring buffer: перезапись старых операций", () => {
  const log = new OpLog(3);
  for (let i = 1; i <= 5; i++) log.push({ seq: i, x: i, y: i, color: 1, version: i, user: 1, ts: 0 });
  assert.equal(log.count, 5);
  assert.equal(log.firstSeq, 3);
  assert.equal(log.lastSeq, 5);
  assert.deepEqual(log.entries().map((o) => o.seq), [3, 4, 5]);
  assert.equal(log.fromSeq(2), null);
  assert.deepEqual(log.fromSeq(3).map((o) => o.seq), [4, 5]);
});

test("OpLog: восстановление холста из БД (loadCells + setNextSeq)", () => {
  const { state } = makeGame();
  state.loadCells([
    { x: 0, y: 0, color: 3, version: 10, user_id: 2 },
    { x: 5, y: 5, color: 1, version: 7, user_id: 1 },
  ]);
  state.setNextSeq(10);
  assert.equal(state.getCell(0, 0).color, 3);
  assert.equal(state.getCell(0, 0).owner, 2);
  assert.equal(state.getCell(0, 0).version, 10);
  assert.equal(state.getCell(9, 9).color, -1);
  const op = state.applyPaint(1, 1, 1, 4);
  assert.equal(op.seq, 11);
});