import { db, indexes, closeDb } from '../src/db.js';
import { seedSources } from '../src/ingest.js';
try { const database = await db(); await indexes(database); await seedSources(database); }
finally { await closeDb(); }
