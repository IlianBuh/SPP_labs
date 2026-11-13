import { randomUUID } from 'node:crypto';
import DataLoader from 'dataloader';
import { GraphQLError } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { workspaceTypeDefs } from './schema.js';
import { db, closeDb } from './db.js';
import { config } from './config.js';
import { cleanText, badInput, boundedInt } from './query.js';
import { limits } from './limits.js';
import { startImport } from './jobs.js';
import { serve } from './runtime.js';

const database = await db();
const collections = database.collection('collections'), notes = database.collection('notes');
async function collection(id) { const row = await collections.findOne({ _id: id }); if (!row) throw new GraphQLError('Подборка не найдена', { extensions: { code: 'NOT_FOUND' } }); return row; }
async function requireEntry(id) { if (!await database.collection('entries').findOne({ _id: id }, { projection: { _id: 1 } })) badInput('Запись не найдена'); }
const resolvers = {
  Query: {
    collections: (_, { limit = limits.collections, offset = 0 }) => collections.find().sort({ createdAt: -1, _id: -1 }).skip(boundedInt(offset, 0, 1000000, 'offset')).limit(boundedInt(limit, 1, limits.collections, 'limit')).maxTimeMS(5000).toArray(),
    collectionCount: () => collections.countDocuments({}, { maxTimeMS: 5000 }),
    collection: (_, { id }) => collection(id),
    importJobs: () => database.collection('jobs').find().sort({ createdAt: -1 }).limit(20).toArray(),
    async diagnostics(_, { traceId }) {
      const since = new Date(Date.now() - 300000);
      const [services, spans, metrics] = await Promise.all([
        database.collection('services').find().maxTimeMS(5000).toArray(),
        database.collection('traces').find(traceId ? { traceId } : { at: { $gte: since } }).sort({ at: traceId ? 1 : -1 }).limit(traceId ? limits.spans : 50).maxTimeMS(5000).toArray(),
        database.collection('traces').aggregate([
          { $match: { service: 'gateway', at: { $gte: since } } },
          { $group: { _id: null, requests: { $sum: 1 }, errors: { $sum: { $cond: [{ $gt: ['$errors', 0] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $in: ['$status', [403, 429, 503]] }, 1, 0] } },
            rateLimited: { $sum: { $cond: [{ $eq: ['$status', 429] }, 1, 0] } },
            overloaded: { $sum: { $cond: [{ $eq: ['$status', 503] }, 1, 0] } },
            p95: { $percentile: { input: '$durationMs', p: [0.95], method: 'approximate' } } } },
        ], { maxTimeMS: 5000 }).toArray(),
      ]);
      const metric = metrics[0] || {};
      return { services: ['gateway', 'catalog', 'workspace', 'worker'].map(name => {
        const row = services.find(s => s._id === name);
        return { name, status: row && Date.now() - row.lastSeen.getTime() < 20000 ? 'UP' : 'DOWN', lastSeen: row?.lastSeen?.toISOString(), requests: row?.requests || 0, errors: row?.errors || 0, rejected: row?.rejected || 0, rateLimited: row?.rateLimited || 0, overloaded: row?.overloaded || 0, inflight: row?.inflight || 0 };
      }), requests: metric.requests || 0, errors: metric.errors || 0, rejected: metric.rejected || 0, rateLimited: metric.rateLimited || 0, overloaded: metric.overloaded || 0, p95Ms: metric.p95?.[0] || 0, uptimeSeconds: (Date.now() - (services.find(s => s._id === 'gateway')?.startedAt?.getTime() || Date.now())) / 1000, spans };
    }
  },
  Mutation: {
    async createCollection(_, { name }) { const row = { _id: randomUUID(), name: cleanText(name, 100, 'name'), entryIds: [], createdAt: new Date().toISOString() }; await collections.insertOne(row); return row; },
    async renameCollection(_, { id, name }) { await collection(id); await collections.updateOne({ _id: id }, { $set: { name: cleanText(name, 100, 'name') } }); return collection(id); },
    async deleteCollection(_, { id }) { return (await collections.deleteOne({ _id: id })).deletedCount > 0; },
    async addToCollection(_, { collectionId, entryId }) {
      await collection(collectionId); await requireEntry(entryId);
      // Atomic limit and set semantics: concurrent writes cannot grow a collection past 100.
      const updated = await collections.findOneAndUpdate({ _id: collectionId, $or: [{ entryIds: entryId }, { 'entryIds.99': { $exists: false } }] }, { $addToSet: { entryIds: entryId } }, { returnDocument: 'after' });
      if (!updated) badInput('В подборке допускается до 100 записей'); return updated;
    },
    async removeFromCollection(_, { collectionId, entryId }) { await collection(collectionId); await collections.updateOne({ _id: collectionId }, { $pull: { entryIds: entryId } }); return collection(collectionId); },
    async addNote(_, { entryId, text }) { await requireEntry(entryId); const row = { _id: randomUUID(), entryId, text: cleanText(text, 2000, 'text'), createdAt: new Date().toISOString() }; await notes.insertOne(row); return row; },
    async deleteNote(_, { id }) { return (await notes.deleteOne({ _id: id })).deletedCount > 0; },
    startImport: (_, { target }, ctx) => startImport(database, target, ctx),
    async cancelImport(_, { id }) { const row = await database.collection('jobs').findOneAndUpdate({ _id: id, active: true }, { $set: { status: 'CANCELLED', active: false, updatedAt: new Date().toISOString() } }, { returnDocument: 'after' }); if (!row) badInput('Активная задача не найдена'); return row; }
  },
  Entry: { __resolveReference: ref => ref,
    notes: async (entry, { limit = limits.notes }, ctx) => { boundedInt(limit, 1, limits.notes, 'limit'); return (await ctx.notes.load(entry.id)).notes.slice(0, limit); },
    noteCount: async (entry, _, ctx) => (await ctx.notes.load(entry.id)).count,
  },
  Note: { id: n => n._id, entry: n => ({ __typename: 'Entry', id: n.entryId }) },
  Collection: { id: c => c._id, items: (c, { limit = limits.items }) => c.entryIds.slice(0, boundedInt(limit, 1, limits.items, 'limit')).map(id => ({ __typename: 'Entry', id })) },
  ImportJob: { id: j => j._id }, Span: { id: s => s._id, at: s => s.at.toISOString() }
};
const close = await serve({ name: 'workspace', port: config.workspacePort, database, schema: buildSubgraphSchema([{ typeDefs: workspaceTypeDefs, resolvers }]), context: async () => ({
  notes: new DataLoader(async ids => { const rows = await notes.aggregate([{ $match: { entryId: { $in: ids } } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$entryId', count: { $sum: 1 }, notes: { $firstN: { input: '$$ROOT', n: limits.notes } } } }], { maxTimeMS: 5000 }).toArray(); const map = new Map(rows.map(r => [r._id, r])); return ids.map(id => map.get(id) || { notes: [], count: 0 }); })
}) });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await close(); await closeDb(); process.exit(0); });
