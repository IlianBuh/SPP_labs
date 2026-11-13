import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client;
let database;
export async function db() {
  if (!database) {
    client = new MongoClient(config.mongoUri, { maxPoolSize: 30, minPoolSize: 1, serverSelectionTimeoutMS: config.mongoSelectionTimeout, socketTimeoutMS: 25000, waitQueueTimeoutMS: 5000, retryReads: true, retryWrites: true, writeConcern: { w: 'majority', wtimeoutMS: 15000 } });
    await client.connect();
    database = client.db(config.database);
  }
  return database;
}
export async function indexes(database) {
  await Promise.all([
    database.collection('entries').createIndex({ title: 'text', description: 'text', tags: 'text', 'authors.name': 'text' }, { default_language: 'none' }),
    database.collection('entries').createIndex({ kind: 1, sourceId: 1, title: 1, _id: 1 }),
    database.collection('entries').createIndex({ title: 1, _id: 1 }),
    database.collection('entries').createIndex({ year: -1, _id: -1 }),
    database.collection('entries').createIndex({ value: -1, _id: -1 }),
    database.collection('entries').createIndex({ updatedAt: -1, _id: -1 }),
    database.collection('entries').createIndex({ sourceId: 1 }),
    database.collection('notes').createIndex({ entryId: 1, createdAt: -1 }),
    database.collection('traces').createIndex({ at: 1 }, { expireAfterSeconds: 86400 }),
    database.collection('traces').createIndex({ traceId: 1, at: 1 }),
    database.collection('jobs').createIndex({ active: 1 }, { unique: true, partialFilterExpression: { active: true } }),
    database.collection('jobs').createIndex({ createdAt: -1 }),
    database.collection('collections').createIndex({ createdAt: -1, _id: -1 }),
    database.collection('traces').createIndex({ service: 1, at: -1 }),
    ...['kind', 'sourceId'].flatMap(filter => ['title', 'year', 'value', 'updatedAt'].map(field => database.collection('entries').createIndex({ [filter]: 1, [field]: 1, _id: 1 }))),
  ]);
}
export async function closeDb() { await client?.close(); database = undefined; client = undefined; }
