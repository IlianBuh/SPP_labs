import http from "node:http";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { pool, initDatabase } from "./database/pool.js";
import { createAuthRouter } from "./auth/auth.js";
import { authenticateRequest } from "./auth/middleware.js";
import { GameState } from "./game/gameState.js";
import { OpLog } from "./game/opLog.js";
import { Persistence, loadInitialState } from "./game/persistence.js";
import { GameServer } from "./game/gameServer.js";

async function main() {
  await initDatabase();
  const initial = await loadInitialState(pool);

  const gameState = new GameState({
    gridSize: config.gridSize,
    paletteSize: config.paletteSize,
    cooldownMs: config.cooldownMs,
  });
  gameState.loadUsers(initial.users);
  gameState.loadCells(initial.cells);
  gameState.setNextSeq(initial.nextSeq);
  logger.info("game state loaded", {
    users: initial.users.length,
    paintedCells: initial.cells.length,
    nextSeq: initial.nextSeq,
  });

  const opLog = new OpLog(config.opLogSize);
  const persistence = new Persistence({ pool, flushMs: config.persistFlushMs });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(express.json({ limit: "16kb" }));
  app.use(express.static(path.join(config.rootDir, "public")));
  app.use(
    "/api/auth",
    createAuthRouter({ onUserCreated: (user) => gameState.addUser(user) })
  );
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  app.use((err, req, res, _next) => {
    logger.error("request error", { error: err.message, path: req.path });
    res.status(500).json({ success: false, message: "Внутренняя ошибка сервера" });
  });

  const server = http.createServer(app);
  const gameServer = new GameServer({
    httpServer: server,
    gameState,
    opLog,
    persistence,
    authenticateRequest,
    config,
    log: logger,
  });

  server.listen(config.port, () => {
    logger.info(`pixel-canvas listening on http://localhost:${config.port}`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    persistence.stop();
    try {
      await persistence.flushNow();
      logger.info("persistence flushed on shutdown", { remaining: persistence.queue.length });
    } catch (err) {
      logger.error("final persistence flush failed", { error: err.message });
    }
    gameServer.close();
    server.close();
    await pool.end();
    process.exit(0);
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("fatal startup error", { error: err.message });
  process.exit(1);
});