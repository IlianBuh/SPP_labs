import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { db, indexes, closeDb } from './db.js';
import { config } from './config.js';
import { startImport, sources } from './jobs.js';
import { importSource, seedSources, sleep } from './ingest.js';
import { log } from './runtime.js';

export async function runWorker(database, { signal, sourceImporter = importSource, leaseMs = config.workerLeaseMs, pollMs = config.workerPollMs, autoImport = config.autoImport, target = config.importTarget } = {}) {
  await indexes(database);
  await seedSources(database);
  const owner = randomUUID();
  let successes = 0, failures = 0, heartbeatPending = false;
  const heartbeat = async () => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try { await database.collection('services').updateOne({ _id: 'worker' }, { $set: { lastSeen: new Date(), owner, requests: successes, errors: failures } }, { upsert: true }); }
    catch (e) { log('worker', 'heartbeat failed', { error: e.message }); }
    finally { heartbeatPending = false; }
  };
  const writeSpan = async span => {
    try { await database.collection('traces').insertOne(span); }
    catch (e) { log('worker', 'trace write failed', { error: e.message }); }
  };
  const timer = setInterval(heartbeat, 5000); timer.unref();
  await heartbeat();
  try {
    if (autoImport && await database.collection('jobs').countDocuments() === 0) await startImport(database, target);
    while (!signal?.aborted) {
      try {
        const jobs = database.collection('jobs');
        const job = await jobs.findOneAndUpdate({ active: true, leaseUntil: { $lt: new Date() } }, { $set: { owner, status: 'RUNNING', leaseUntil: new Date(Date.now() + leaseMs), updatedAt: new Date().toISOString() }, $inc: { attempts: 1 } }, { returnDocument: 'after' });
        if (!job) { await sleep(pollMs); continue; }
        let leaseLost = false, renewal;
        const renew = setInterval(() => {
          if (renewal) return;
          renewal = jobs.updateOne({ _id: job._id, owner, active: true, leaseUntil: { $gt: new Date() } }, { $set: { leaseUntil: new Date(Date.now() + leaseMs) } })
            .then(result => { if (!result.matchedCount) leaseLost = true; }).catch(() => { leaseLost = true; }).finally(() => { renewal = null; });
        }, Math.max(100, Math.floor(leaseMs / 3)));
        const isActive = async () => !signal?.aborted && !leaseLost && Boolean(await jobs.findOne({ _id: job._id, owner, active: true, leaseUntil: { $gt: new Date() } }));
        const checkpoint = async () => {
          if (!await isActive()) throw new Error('Задача остановлена или потеряна аренда');
          const result = await jobs.updateOne({ _id: job._id, owner, active: true, leaseUntil: { $gt: new Date() } }, { $set: { progress: job.progress, updatedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + leaseMs) } });
          if (!result.matchedCount) { leaseLost = true; throw new Error('Потеряна аренда задачи'); }
        };
        const rootId = randomUUID(), started = performance.now();
        let jobErrors = 0;
        try {
          for (const source of sources) {
            if (!await isActive()) break;
            const at = performance.now();
            let errors = 0;
            try { await sourceImporter(database, job, source._id, { checkpoint, isActive }); }
            catch (error) {
              errors = 1;
              if (!await isActive()) break;
              job.progress.find(p => p.sourceId === source._id).error = error.message;
              await checkpoint();
              log('worker', 'source failed', { source: source._id, error: error.message });
            } finally {
              await writeSpan({ _id: randomUUID(), traceId: job.traceId || job._id, parentId: rootId, service: 'worker', operation: `import:${source._id}`, durationMs: performance.now() - at, errors, at: new Date() });
            }
          }
          if (await isActive()) {
            const counts = await Promise.all(sources.map(s => database.collection('entries').countDocuments({ sourceId: s._id })));
            const complete = job.progress.every(p => p.done) && counts.every(n => n > 0) && counts[0] >= job.target && counts.reduce((a,b) => a+b, 0) >= 10000;
            const result = await jobs.updateOne({ _id: job._id, owner, active: true, leaseUntil: { $gt: new Date() } }, { $set: { status: complete ? 'COMPLETED' : 'FAILED', active: false, error: complete ? null : job.progress.filter(p => p.error).map(p => `${p.sourceId}: ${p.error}`).join('; ') || 'Не достигнут требуемый объём', updatedAt: new Date().toISOString() } });
            if (result.matchedCount) { if (complete) successes++; else { failures++; jobErrors++; } }
          }
        } catch (error) { jobErrors++; throw error; }
        finally {
          clearInterval(renew);
          await renewal;
          if (signal?.aborted && !leaseLost) await jobs.updateOne({ _id: job._id, owner, active: true }, { $set: { status: 'QUEUED', leaseUntil: new Date(0) } });
          await writeSpan({ _id: rootId, traceId: job.traceId || job._id, parentId: job.parentSpanId || null, service: 'worker', operation: `job:${job._id}`, durationMs: performance.now() - started, errors: jobErrors, at: new Date() });
        }
      } catch (error) { log('worker', 'iteration failed', { error: error.message }); failures++; if (!signal?.aborted) await sleep(Math.min(3000, pollMs * 3)); }
    }
  } finally { clearInterval(timer); await heartbeat(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => controller.abort());
  try { await runWorker(await db(), { signal: controller.signal }); }
  finally { await closeDb(); }
}
