import { randomUUID } from 'node:crypto';
import { boundedInt } from './query.js';

export const sources = [
  { _id: 'openlibrary', name: 'Open Library', url: 'https://openlibrary.org', kind: 'BOOK' },
  { _id: 'countries', name: 'Countries Dataset', url: 'https://github.com/mledoze/countries', kind: 'COUNTRY' },
  { _id: 'dummyjson', name: 'DummyJSON', url: 'https://dummyjson.com', kind: 'PRODUCT' }
];
export async function startImport(database, target = 10500, trace = {}) {
  boundedInt(target, 10000, 100000, 'target');
  const job = { _id: randomUUID(), status: 'QUEUED', target, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), leaseUntil: new Date(0), progress: sources.map(s => ({ sourceId: s._id, fetched: 0, page: 0, done: false, error: null })) };
  job.traceId = trace.traceId || job._id;
  job.parentSpanId = trace.spanId || null;
  const previous = await database.collection('jobs').findOne({ status: { $in: ['FAILED', 'CANCELLED'] } }, { sort: { createdAt: -1 } });
  if (previous) {
    const latest = await database.collection('jobs').findOne({}, { sort: { createdAt: -1 } });
    if (latest?._id === previous._id) job.progress = previous.progress.map(p => ({ ...p, error: null, done: p.sourceId === 'openlibrary' ? p.done && p.fetched >= target && p.page * 100 >= target : p.done }));
  }
  try { await database.collection('jobs').insertOne(job); return job; }
  catch (err) { if (err.code === 11000) return database.collection('jobs').findOne({ active: true }); throw err; }
}
