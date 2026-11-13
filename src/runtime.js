import express from 'express';
import { randomUUID } from 'node:crypto';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { GraphQLError } from 'graphql';
import { config } from './config.js';
import { operationCost } from './query.js';

export function log(service, message, extra = {}) { console.log(JSON.stringify({ at: new Date().toISOString(), service, message, ...extra })); }
export async function serve({ name, port, database, schema, gateway, context = async () => ({}), publicDir }) {
  const app = express();
  app.disable('x-powered-by');
  const buckets = new Map();
  const counters = { requests: 0, errors: 0, rejected: 0, rateLimited: 0, overloaded: 0, inflight: 0 };
  const startedAt = new Date();
  let heartbeatPending = false, traceWrites = 0;
  const heartbeat = async () => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try { await database.collection('services').updateOne({ _id: name }, { $set: { name, lastSeen: new Date(), startedAt, ...counters } }, { upsert: true }); }
    catch (e) { log(name, 'heartbeat failed', { error: e.message }); }
    finally { heartbeatPending = false; }
  };
  await heartbeat();
  const timer = setInterval(() => { heartbeat(); const now = Date.now(); for (const [key, value] of buckets) if (value.reset < now) buckets.delete(key); }, 5000);
  timer.unref();
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    next();
  });
  const admission = (req, res, next) => {
    counters.requests++;
    req.traceId = /^[a-f0-9-]{36}$/.test(req.headers['x-trace-id'] || '') ? req.headers['x-trace-id'] : randomUUID();
    res.setHeader('x-trace-id', req.traceId);
    const state = req.lifecycle = { spanId: randomUUID(), start: performance.now(), operation: 'HTTP', errors: 0, code: null, executing: false, admitted: false, closed: false, recorded: false, released: false };
    // A disconnected client must not permanently occupy a slot, or free it
    // while its resolver is still running (which would bypass concurrency).
    state.release = () => { if (state.admitted && state.closed && !state.executing && !state.released) { state.released = true; counters.inflight--; } };
    const record = status => {
      if (state.recorded) return;
      state.recorded = true;
      const errors = state.errors || (status >= 400 ? 1 : 0);
      if (errors) counters.errors++;
      const span = { _id: state.spanId, traceId: req.traceId, parentId: req.headers['x-parent-span'] || null, service: name, operation: state.operation, durationMs: performance.now() - state.start, errors, status, code: state.code, at: new Date() };
      // Bound telemetry's own pending work if MongoDB is unavailable.
      if (traceWrites < 1000) {
        traceWrites++;
        database.collection('traces').insertOne(span).catch(e => log(name, 'trace write failed', { error: e.message })).finally(() => { traceWrites--; });
      }
      log(name, 'graphql', { traceId: span.traceId, operation: span.operation, durationMs: Math.round(span.durationMs), errors, status, code: state.code });
    };
    res.once('finish', () => { state.closed = true; state.release(); record(res.statusCode); });
    res.once('close', () => { state.closed = true; state.release(); record(res.writableFinished ? res.statusCode : 499); });
    const fail = (status, code, message) => {
      counters.rejected++;
      if (status === 429) counters.rateLimited++;
      if (status === 503) counters.overloaded++;
      state.code = code;
      return res.status(status).json({ errors: [{ message, extensions: { code } }] });
    };
    if (name !== 'gateway' && req.headers['x-internal-secret'] !== config.internalSecret) return fail(403, 'FORBIDDEN', 'Доступ только через GraphQL Gateway');
    const now = Date.now(), key = req.ip;
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) { bucket = { count: 0, reset: now + 60000 }; buckets.set(key, bucket); }
    if (name === 'gateway' && ++bucket.count > config.rate) { res.setHeader('Retry-After', Math.ceil((bucket.reset - now) / 1000)); return fail(429, 'RATE_LIMITED', 'Лимит запросов. Повторите позже.'); }
    if (counters.inflight >= config.concurrent) return fail(503, 'SERVICE_UNAVAILABLE', 'Сервер занят. Повторите позже.');
    state.admitted = true;
    counters.inflight++;
    next();
  };
  const server = new ApolloServer({
    ...(gateway ? { gateway } : { schema }),
    allowBatchedHttpRequests: false,
    includeStacktraceInErrorResponses: false,
    parseOptions: { maxTokens: 3000 },
    plugins: [{
      async requestDidStart(ctx) {
        const state = ctx.contextValue.lifecycle;
        state.executing = true;
        return {
          async didResolveOperation(requestContext) {
            state.operation = requestContext.operationName || 'anonymous';
            if (name !== 'gateway') return;
            operationCost(requestContext.document, requestContext.operation, requestContext.request.variables, requestContext.schema);
            if (requestContext.operation.operation === 'mutation' && config.adminToken && requestContext.contextValue.token !== config.adminToken) throw new GraphQLError('Нужен токен администратора', { extensions: { code: 'UNAUTHENTICATED' } });
          },
          async willSendResponse(result) {
            state.errors = result.errors?.length || 0;
            state.code = result.errors?.[0]?.extensions?.code || null;
            state.executing = false;
            state.release();
          }
        };
      }
    }]
  });
  await server.start();
  // Guard and handler share Express's exact same matching rules, including
  // case, trailing slashes and mounted subpaths.
  app.use('/graphql', admission, express.json({ limit: '128kb' }), expressMiddleware(server, {
    context: async ({ req }) => ({ traceId: req.traceId, spanId: req.lifecycle.spanId, lifecycle: req.lifecycle, parentId: req.headers['x-parent-span'] || null, token: (req.headers.authorization || '').replace(/^Bearer /, ''), ...await context(req) })
  }));
  if (publicDir) app.use(express.static(publicDir));
  app.use((err, req, res, _next) => {
    if (req.lifecycle) { req.lifecycle.executing = false; req.lifecycle.code = err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST'; req.lifecycle.release(); }
    res.status(err.status || 500).json({ errors: [{ message: err.status === 413 ? 'Слишком большой запрос' : 'Некорректный запрос' }] });
  });
  const http = await new Promise((resolve, reject) => { const listener = app.listen(port, config.host, () => resolve(listener)); listener.on('error', reject); });
  http.requestTimeout = 20000;
  log(name, 'listening', { port, host: config.host });
  return async () => { clearInterval(timer); await server.stop(); await new Promise(resolve => http.close(resolve)); await heartbeat(); };
}
