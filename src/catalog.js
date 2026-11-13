import DataLoader from 'dataloader';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { catalogTypeDefs } from './schema.js';
import { db, closeDb } from './db.js';
import { config } from './config.js';
import { entryQuery } from './query.js';
import { serve } from './runtime.js';
import { limits } from './limits.js';

const database = await db();
const entries = database.collection('entries');
const sourceRows = async () => {
  const [sources, counts] = await Promise.all([database.collection('sources').find().limit(limits.sources).maxTimeMS(5000).toArray(), entries.aggregate([{ $group: { _id: '$sourceId', count: { $sum: 1 } } }], { maxTimeMS: 5000 }).toArray()]);
  return sources.map(s => ({ ...s, count: counts.find(c => c._id === s._id)?.count || 0 }));
};
const resolvers = {
  Query: {
    async entries(_, { filter, sort, page = 1, pageSize = 20 }) {
      const opts = entryQuery(filter ?? {}, sort ?? {}, page, pageSize);
      const [items, total] = await Promise.all([
        entries.find(opts.query).sort(opts.sort).skip(opts.skip).limit(opts.limit).maxTimeMS(5000).toArray(),
        entries.countDocuments(opts.query, { maxTimeMS: 5000 })
      ]);
      return { items, total, pageInfo: { page, pageSize, totalPages: Math.ceil(total / pageSize), hasNextPage: page * pageSize < total } };
    },
    entry: (_, { id }, ctx) => ctx.entries.load(id),
    sources: sourceRows,
    async catalogStats() {
      const [kinds, sources] = await Promise.all([entries.aggregate([{ $group: { _id: '$kind', count: { $sum: 1 } } }], { maxTimeMS: 5000 }).toArray(), sourceRows()]);
      return { total: kinds.reduce((sum, row) => sum + row.count, 0), kinds: kinds.map(r => ({ kind: r._id, count: r.count })), sources };
    }
  },
  Entry: { id: e => e._id, __resolveReference: (e, ctx) => ctx.entries.load(e.id), source: (e, _, ctx) => ctx.sources.load(e.sourceId) },
  Source: { id: s => s._id, count: (s, _, ctx) => s.count ?? ctx.sourceCounts.load(s._id) }
};
const schema = buildSubgraphSchema([{ typeDefs: catalogTypeDefs, resolvers }]);
const close = await serve({ name: 'catalog', port: config.catalogPort, database, schema, context: async () => ({
  entries: new DataLoader(async ids => { const rows = await entries.find({ _id: { $in: ids } }).maxTimeMS(5000).toArray(); const map = new Map(rows.map(r => [r._id, r])); return ids.map(id => map.get(id) || null); }),
  sources: new DataLoader(async ids => { const rows = await database.collection('sources').find({ _id: { $in: ids } }).toArray(); return ids.map(id => rows.find(s => s._id === id)); }),
  sourceCounts: new DataLoader(async ids => { const rows = await entries.aggregate([{ $match: { sourceId: { $in: ids } } }, { $group: { _id: '$sourceId', count: { $sum: 1 } } }], { maxTimeMS: 5000 }).toArray(); const counts = new Map(rows.map(r => [r._id, r.count])); return ids.map(id => counts.get(id) || 0); })
}) });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await close(); await closeDb(); process.exit(0); });
