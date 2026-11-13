import 'dotenv/config';

export const config = {
  host: process.env.HOST || '127.0.0.1',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  database: process.env.MONGODB_DATABASE || 'atlas_lab',
  port: Number(process.env.PORT || 4000),
  catalogPort: Number(process.env.CATALOG_PORT || 4001),
  workspacePort: Number(process.env.WORKSPACE_PORT || 4002),
  catalogUrl: process.env.CATALOG_URL || 'http://127.0.0.1:4001/graphql',
  workspaceUrl: process.env.WORKSPACE_URL || 'http://127.0.0.1:4002/graphql',
  internalSecret: process.env.INTERNAL_SECRET || 'local-lab-secret-change-me',
  adminToken: process.env.ADMIN_TOKEN || '',
  importTarget: Number(process.env.IMPORT_TARGET || 10500),
  autoImport: process.env.AUTO_IMPORT !== 'false',
  rate: Number(process.env.REQUESTS_PER_MINUTE || 180),
  concurrent: Number(process.env.MAX_CONCURRENT_REQUESTS || 30),
  upstreamTimeout: Number(process.env.UPSTREAM_TIMEOUT_MS || 30000),
  workerLeaseMs: Math.max(1000, Number(process.env.WORKER_LEASE_MS || 90000)),
  workerPollMs: Math.max(25, Number(process.env.WORKER_POLL_MS || 1000)),
  mongoSelectionTimeout: Number(process.env.MONGO_SELECTION_TIMEOUT_MS || 20000),
};
