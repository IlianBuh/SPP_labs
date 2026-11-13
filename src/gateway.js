import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ApolloGateway, RemoteGraphQLDataSource } from '@apollo/gateway';
import { composeServices } from '@apollo/composition';
import { catalogTypeDefs, workspaceTypeDefs } from './schema.js';
import { db, closeDb } from './db.js';
import { config } from './config.js';
import { serve } from './runtime.js';
import { circuitBreakerFetch } from './circuit-breaker.js';

class TracedSource extends RemoteGraphQLDataSource {
  constructor(options, breakerOptions) {
    super({ ...options, fetcher: circuitBreakerFetch({ name: options.name, ...breakerOptions }) });
  }
  willSendRequest({ request, context }) {
    request.http.headers.set('x-internal-secret', config.internalSecret);
    request.http.headers.set('x-trace-id', context.traceId || randomUUID());
    request.http.headers.set('x-parent-span', context.spanId || 'gateway');
  }
}
export function createGateway({ catalogUrl = config.catalogUrl, workspaceUrl = config.workspaceUrl, breakerOptions } = {}) {
  const composition = composeServices([
    { name: 'catalog', url: catalogUrl, typeDefs: catalogTypeDefs },
    { name: 'workspace', url: workspaceUrl, typeDefs: workspaceTypeDefs }
  ]);
  if (composition.errors?.length) throw new AggregateError(composition.errors, 'Federation composition failed');
  return new ApolloGateway({ supergraphSdl: composition.supergraphSdl, buildService: options => new TracedSource(options, breakerOptions) });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const close = await serve({ name: 'gateway', port: config.port, database: await db(), gateway: createGateway(), publicDir: fileURLToPath(new URL('../public', import.meta.url)) });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await close(); await closeDb(); process.exit(0); });
}
