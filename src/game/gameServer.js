import { WebSocketServer } from "ws";
import { PaintError } from "./gameState.js";

function rejectSocket(socket, code) {
  const reason = code === 401 ? "Unauthorized" : "Forbidden";
  socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * WebSocket-сервер игры: noServer:true + обработка upgrade на http-сервере.
 * Авторизация при handshake — httpOnly cookie (браузерный WS не умеет заголовки),
 * проверка Origin, heartbeat через ws.ping() (браузер отвечает pong сам).
 */
export class GameServer {
  constructor({ httpServer, gameState, opLog, persistence, authenticateRequest, config, log }) {
    this.gameState = gameState;
    this.opLog = opLog;
    this.persistence = persistence;
    this.authenticateRequest = authenticateRequest;
    this.config = config;
    this.log = log;
    this.clients = new Set();

    this.wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageSize || 65536 });
    httpServer.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
    this.wss.on("connection", (ws, req, ctx) => this.onConnection(ws, ctx));

    this.heartbeatTimer = setInterval(() => this.heartbeat(), config.heartbeatIntervalMs || 30000);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  handleUpgrade(req, socket, head) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        if (url.host !== req.headers.host) {
          this.log.warn("ws upgrade rejected: foreign origin", {
            origin,
            host: req.headers.host,
          });
          rejectSocket(socket, 403);
          return;
        }
      } catch {
        this.log.warn("ws upgrade rejected: invalid origin", { origin });
        rejectSocket(socket, 403);
        return;
      }
    }
    this.authenticateRequest(req)
      .then((ctx) => {
        if (!ctx) {
          this.log.info("ws upgrade rejected: unauthenticated");
          rejectSocket(socket, 401);
          return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req, ctx);
        });
      })
      .catch((err) => {
        this.log.error("ws upgrade auth error", { error: err.message });
        socket.destroy();
      });
  }

  onConnection(ws, ctx) {
    ws.user = ctx.user;
    ws.isAlive = true;
    this.clients.add(ws);
    this.log.info("ws client connected", { userId: ws.user.id, username: ws.user.username });

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", (data, isBinary) => this.onMessage(ws, data, isBinary));
    ws.on("close", () => {
      this.clients.delete(ws);
      this.broadcastPlayers();
      this.log.info("ws client disconnected", { userId: ws.user.id });
    });
    ws.on("error", (err) => this.log.warn("ws socket error", { error: err.message }));

    this.send(ws, { type: "players", online: this.onlinePlayers() });
  }

  onMessage(ws, data, isBinary) {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.send(ws, { type: "error", code: "bad_message", message: "Некорректное сообщение" });
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "init":
        this.handleInit(ws, msg);
        break;
      case "paint":
        this.handlePaint(ws, msg);
        break;
      default:
        break;
    }
  }

  handleInit(ws, msg) {
    const lastSeq =
      Number.isInteger(msg.lastSeq) && msg.lastSeq >= 0 ? msg.lastSeq : null;
    if (this.opLog.count === 0) {
      this.send(ws, {
        type: "snapshot",
        seq: this.gameState.nextSeq,
        colors: this.gameState.colorsArray(),
      });
    } else {
      const ops = this.opLog.fromSeq(lastSeq);
      if (ops === null) {
        this.send(ws, {
          type: "snapshot",
          seq: this.gameState.nextSeq,
          colors: this.gameState.colorsArray(),
        });
      } else {
        this.send(ws, { type: "delta", seq: this.opLog.lastSeq, ops });
      }
    }
    this.send(ws, { type: "leaderboard", list: this.gameState.leaderboard(10) });
    this.send(ws, { type: "players", online: this.onlinePlayers() });
  }

  handlePaint(ws, msg) {
    try {
      const op = this.gameState.applyPaint(ws.user.id, msg.x, msg.y, msg.color);
      op.username = ws.user.username;
      this.opLog.push(op);
      this.persistence.push(op);
      this.broadcast({ type: "op", ...op });
      this.broadcast({ type: "leaderboard", list: this.gameState.leaderboard(10) });
    } catch (err) {
      if (err instanceof PaintError) {
        this.send(ws, { type: "error", code: err.code, message: err.message, ...err.extra });
      } else {
        this.log.error("paint handler error", { error: err.message, userId: ws.user.id });
        this.send(ws, { type: "error", code: "internal", message: "Ошибка сервера" });
      }
    }
  }

  onlinePlayers() {
    const seen = new Set();
    const out = [];
    for (const ws of this.clients) {
      if (seen.has(ws.user.id)) continue;
      seen.add(ws.user.id);
      out.push({ id: ws.user.id, username: ws.user.username });
    }
    return out;
  }

  heartbeat() {
    for (const ws of this.clients) {
      if (!ws.isAlive) {
        this.log.info("ws heartbeat timeout, terminating", { userId: ws.user.id });
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }

  broadcastPlayers() {
    this.broadcast({ type: "players", online: this.onlinePlayers() });
  }

  send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  close() {
    clearInterval(this.heartbeatTimer);
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    this.wss.close();
  }
}