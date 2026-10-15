(function () {
  "use strict";

  var GRID_SIZE = 100;
  var COOLDOWN_MS = 2000;
  var PENDING_KEY = "pendingPaints";
  var PENDING_LIMIT = 300;
  var RECONNECT_MAX_MS = 30000;

  var PALETTE = [
    [255, 69, 0], [255, 168, 0], [255, 214, 53], [0, 163, 104],
    [0, 204, 192], [36, 80, 164], [54, 144, 234], [129, 30, 159],
    [180, 74, 192], [255, 57, 129], [255, 153, 170], [109, 72, 47],
    [255, 255, 255], [212, 215, 217], [137, 141, 144], [0, 0, 0],
  ];

  function $(sel) { return document.querySelector(sel); }

  var state = {
    colors: new Int16Array(GRID_SIZE * GRID_SIZE).fill(-1),
    lastSeq: 0,
    pending: loadPending(),
    connected: false,
    initialized: false,
    cooldownUntil: 0,
    activeColor: null,
    user: null,
    players: [],
    leaderboard: [],
    ws: null,
    reconnectDelay: 1000,
    retryTimer: null,
    resendTimer: null,
    buffered: new Map(),
    cooldownLoop: null,
  };

  function loadPending() {
    try {
      var raw = localStorage.getItem(PENDING_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function savePending() {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(state.pending));
    } catch (e) {
      /* localStorage недоступен — очередь живёт в памяти */
    }
  }

  function pushPending(paint) {
    state.pending.push(paint);
    if (state.pending.length > PENDING_LIMIT) {
      state.pending.splice(0, state.pending.length - PENDING_LIMIT);
    }
    savePending();
  }

  /* ---------------- API ---------------- */

  async function api(path, body) {
    var opts = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    var data = null;
    try { data = await res.json(); } catch (e) { /* пусто */ }
    if (!res.ok) {
      throw new Error((data && data.message) || "Ошибка " + res.status);
    }
    return data ? data.data : null;
  }

  /* ---------------- экраны ---------------- */

  function showAuth() {
    $("#game-view").classList.add("hidden");
    $("#auth-view").classList.remove("hidden");
    stopWS();
  }

  function showGame() {
    $("#auth-view").classList.add("hidden");
    $("#game-view").classList.remove("hidden");
    $("#user-name").textContent = state.user.username;
    renderStats();
    buildPalette();
    startWS();
  }

  function renderStats() {
    var s = state.user;
    $("#user-stats").textContent = "очки: " + (s.score || 0) +
      " · покрасок: " + (s.totalPaints || 0) +
      " · рекорд: " + (s.bestScore || 0);
  }

  /* ---------------- авторизация ---------------- */

  var authMode = "login";

  function setAuthMode(mode) {
    authMode = mode;
    $("#tab-login").classList.toggle("active", mode === "login");
    $("#tab-register").classList.toggle("active", mode === "register");
    $("#auth-submit").textContent = mode === "login" ? "Войти" : "Зарегистрироваться";
    $("#password").autocomplete = mode === "login" ? "current-password" : "new-password";
  }

  function authError(msg) {
    var el = $("#auth-error");
    if (msg) {
      el.textContent = msg;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  function bindAuth() {
    $("#tab-login").addEventListener("click", function () { setAuthMode("login"); authError(null); });
    $("#tab-register").addEventListener("click", function () { setAuthMode("register"); authError(null); });
    $("#auth-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var username = $("#username").value.trim();
      var password = $("#password").value;
      var btn = $("#auth-submit");
      btn.disabled = true;
      authError(null);
      try {
        state.user = await api("/api/auth/" + authMode, { username: username, password: password });
        showGame();
      } catch (err) {
        authError(err.message);
      } finally {
        btn.disabled = false;
      }
    });
    $("#logout-btn").addEventListener("click", async function () {
      try { await api("/api/auth/logout", {}); } catch (e) { /* токен уже мёртв */ }
      location.reload();
    });
  }

  /* ---------------- WebSocket ---------------- */

  function startWS() {
    var proto = location.protocol === "https:" ? "wss" : "ws";
    var ws = new WebSocket(proto + "://" + location.host);
    state.ws = ws;

    ws.onopen = function () {
      state.reconnectDelay = 1000;
      setConnection("online");
      state.connected = true;
      ws.send(JSON.stringify({ type: "init", lastSeq: state.lastSeq }));
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleMessage(msg);
    };

    ws.onclose = function () { onSocketClosed(); };
    ws.onerror = function () { /* за ним придёт onclose */ };
  }

  function stopWS() {
    if (state.ws) {
      try { state.ws.close(); } catch (e) { /* пусто */ }
      state.ws = null;
    }
    if (state.retryTimer) { clearTimeout(state.retryTimer); state.retryTimer = null; }
    if (state.resendTimer) { clearTimeout(state.resendTimer); state.resendTimer = null; }
  }

  function onSocketClosed() {
    state.connected = false;
    state.initialized = false;
    state.buffered.clear();
    state.pending.forEach(function (p) { p.sent = false; });
    savePending();
    setConnection("reconnecting");
    state.retryTimer = setTimeout(function () {
      state.retryTimer = null;
      if (!$("#game-view").classList.contains("hidden")) startWS();
    }, state.reconnectDelay);
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "snapshot": applySnapshot(msg); break;
      case "delta": applyDelta(msg); break;
      case "op": applyOp(msg); break;
      case "leaderboard":
        state.leaderboard = msg.list || [];
        renderLeaderboard();
        break;
      case "players":
        state.players = msg.online || [];
        renderPlayers();
        break;
      case "error": handleServerError(msg); break;
      default: break;
    }
  }

  function applySnapshot(msg) {
    if (msg.seq != null) state.lastSeq = msg.seq;
    var colors = msg.colors;
    for (var i = 0; i < state.colors.length; i++) {
      state.colors[i] = colors[i] == null ? -1 : colors[i];
    }
    state.initialized = true;
    render();
    flushPending();
  }

  function applyDelta(msg) {
    for (var i = 0; i < msg.ops.length; i++) {
      applyOp(msg.ops[i], true);
    }
    if (msg.seq != null && msg.seq > state.lastSeq) state.lastSeq = msg.seq;
    state.initialized = true;
    render();
    flushPending();
  }

  function applyOp(op, fromDelta) {
    var cell = op.y * GRID_SIZE + op.x;
    if (op.seq != null && op.seq <= state.lastSeq) {
      removePendingFor(op);
      return;
    }
    if (fromDelta || op.seq === state.lastSeq + 1 || (op.seq == null && !state.initialized)) {
      if (op.seq != null) state.lastSeq = op.seq;
      state.colors[cell] = op.color;
      removePendingFor(op);
      render();
      drainBuffer();
      return;
    }
    state.buffered.set(op.seq, op);
    drainBuffer();
    if (state.buffered.size > 50) forceReconnect();
  }

  function drainBuffer() {
    while (state.buffered.has(state.lastSeq + 1)) {
      var op = state.buffered.get(state.lastSeq + 1);
      state.buffered.delete(state.lastSeq + 1);
      state.lastSeq = op.seq;
      state.colors[op.y * GRID_SIZE + op.x] = op.color;
      removePendingFor(op);
      render();
    }
  }

  function forceReconnect() {
    try { if (state.ws) state.ws.close(); } catch (e) { /* пусто */ }
  }

  function removePendingFor(op) {
    var idx = -1;
    for (var i = 0; i < state.pending.length; i++) {
      var p = state.pending[i];
      if (p.x === op.x && p.y === op.y && p.color === op.color && p.sent) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      state.pending.splice(idx, 1);
      savePending();
    }
  }

  function handleServerError(msg) {
    if (msg.code === "cooldown") {
      state.cooldownUntil = Date.now() + (msg.retryInMs || COOLDOWN_MS);
    } else {
      toast(msg.message || "Ошибка сервера");
    }
  }

  /* ---------------- очередь оффлайн-покрасок ---------------- */

  function tryPaint(x, y) {
    var now = Date.now();
    if (now < state.cooldownUntil) return;
    if (state.activeColor === null) return;
    state.colors[y * GRID_SIZE + x] = state.activeColor;
    render();
    state.cooldownUntil = now + COOLDOWN_MS;
    pushPending({ x: x, y: y, color: state.activeColor, t: now, sent: false });
    flushPending();
  }

  function flushPending() {
    if (!state.connected || !state.initialized || !state.ws || state.pending.length === 0) return;
    var next = null;
    for (var i = 0; i < state.pending.length; i++) {
      var p = state.pending[i];
      if (!p.sent) { next = p; break; }
    }
    if (!next) return;
    next.sent = true;
    savePending();
    try {
      state.ws.send(JSON.stringify({ type: "paint", x: next.x, y: next.y, color: next.color }));
    } catch (e) {
      next.sent = false;
      return;
    }
    paceNextSend();
  }

  function paceNextSend() {
    if (state.resendTimer) clearTimeout(state.resendTimer);
    state.resendTimer = setTimeout(function () {
      state.resendTimer = null;
      flushPending();
    }, COOLDOWN_MS + 250);
  }

  /* ---------------- отрисовка ---------------- */

  var boardCtx = $("#board").getContext("2d");
  var previewCtx = $("#preview").getContext("2d");
  var imageData = boardCtx.createImageData(GRID_SIZE, GRID_SIZE);

  function render() {
    var d = imageData.data;
    for (var i = 0; i < state.colors.length; i++) {
      var c = PALETTE[state.colors[i]];
      var o = i * 4;
      if (!c) {
        d[o + 3] = 0;
      } else {
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
      }
    }
    boardCtx.putImageData(imageData, 0, 0);
  }

  function buildPalette() {
    var wrap = $("#palette");
    wrap.innerHTML = "";
    PALETTE.forEach(function (rgb, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch" + (i === 0 ? " active" : "");
      btn.style.background = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
      btn.title = "Цвет " + (i + 1);
      btn.addEventListener("click", function () {
        state.activeColor = i;
        Array.prototype.forEach.call(wrap.children, function (el) { el.classList.remove("active"); });
        btn.classList.add("active");
      });
      wrap.appendChild(btn);
    });
    state.activeColor = 0;
  }

  function updateCooldownUI() {
    var remaining = state.cooldownUntil - Date.now();
    var bar = $("#cooldown-bar");
    if (remaining <= 0) {
      bar.classList.add("full");
      return;
    }
    bar.classList.remove("full");
    bar.style.width = (remaining / COOLDOWN_MS) * 100 + "%";
  }

  function bindCanvas() {
    var wrap = $(".canvas-wrap");
    var board = $("#board");

    function cellFromEvent(e) {
      var rect = board.getBoundingClientRect();
      var x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_SIZE);
      var y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_SIZE);
      return { x: x, y: y };
    }

    wrap.addEventListener("pointerdown", function (e) { tryPaintFrom(e); });
    wrap.addEventListener("pointermove", function (e) { previewFrom(e); });
    wrap.addEventListener("pointerleave", function () {
      previewCtx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
    });

    function tryPaintFrom(e) {
      var cell = cellFromEvent(e);
      if (cell.x < 0 || cell.x >= GRID_SIZE || cell.y < 0 || cell.y >= GRID_SIZE) return;
      if (Date.now() < state.cooldownUntil) return;
      tryPaint(cell.x, cell.y);
    }

    function previewFrom(e) {
      var cell = cellFromEvent(e);
      previewCtx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
      if (cell.x < 0 || cell.x >= GRID_SIZE || cell.y < 0 || cell.y >= GRID_SIZE) return;
      var rgb = PALETTE[state.activeColor] || [255, 255, 255];
      previewCtx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.55)";
      previewCtx.fillRect(cell.x, cell.y, 1, 1);
    }
  }

  /* ---------------- лидерборд / онлайн ---------------- */

  function renderLeaderboard() {
    var list = $("#leaderboard-list");
    list.innerHTML = "";
    state.leaderboard.forEach(function (row, i) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = (i + 1) + ". " + row.username;
      if (state.user && row.id === state.user.id) name.classList.add("you");
      var score = document.createElement("span");
      score.className = "num";
      score.textContent = row.score;
      li.appendChild(name);
      li.appendChild(score);
      list.appendChild(li);
    });
    if (!state.leaderboard.length) {
      var empty = document.createElement("li");
      empty.className = "dim";
      empty.textContent = "Пока никого";
      list.appendChild(empty);
    }
  }

  function renderPlayers() {
    var list = $("#players-list");
    list.innerHTML = "";
    state.players.forEach(function (row) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = row.username;
      if (state.user && row.id === state.user.id) name.classList.add("you");
      var status = document.createElement("span");
      status.className = "conn conn-online";
      status.textContent = "онлайн";
      li.appendChild(name);
      li.appendChild(status);
      list.appendChild(li);
    });
    if (!state.players.length) {
      var empty = document.createElement("li");
      empty.className = "dim";
      empty.textContent = "Никого нет";
      list.appendChild(empty);
    }
  }

  /* ---------------- статус / уведомления ---------------- */

  function setConnection(status) {
    var el = $("#conn-status");
    var banner = $("#banner");
    el.className = "conn conn-" + status;
    if (status === "online") {
      el.textContent = "онлайн";
      banner.classList.add("hidden");
    } else if (status === "reconnecting") {
      el.textContent = "переподключение…";
      banner.classList.remove("hidden");
      $("#banner-text").textContent = "Соединение потеряно. Покраски сохраняются и отправятся после переподключения…";
    } else {
      el.textContent = "нет связи";
      banner.classList.remove("hidden");
      $("#banner-text").textContent = "Нет соединения";
    }
  }

  var toastTimer = null;
  function toast(message) {
    var el = $("#toast");
    el.textContent = message;
    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 3000);
  }

  /* ---------------- старт ---------------- */

  async function init() {
    bindAuth();
    bindCanvas();
    setAuthMode("login");

    state.cooldownLoop = setInterval(updateCooldownUI, 100);

    try {
      state.user = await api("/api/auth/me");
      showGame();
    } catch (e) {
      showAuth();
    }
  }

  init();
})();