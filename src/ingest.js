import { config } from './config.js';
import { sources } from './jobs.js';
import { limits } from './limits.js';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function fetchJson(url, { fetcher = fetch, pause = sleep, attempts = 4 } = {}) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(url, { headers: { 'User-Agent': process.env.IMPORT_USER_AGENT || 'AtlasLab/1.0 (educational catalog)', Accept: 'application/json' }, signal: AbortSignal.timeout(config.upstreamTimeout) });
      if (!response.ok) {
        error = new Error(`HTTP ${response.status}: ${new URL(url).hostname}`);
        if (response.status !== 429 && response.status < 500) throw Object.assign(error, { permanent: true });
        const retryAfter = Number(response.headers.get('retry-after'));
        if (attempt < attempts - 1) await pause(Math.min(60000, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt));
        continue;
      }
      return await response.json();
    } catch (err) {
      error = err;
      if (err.permanent) throw err;
      if (attempt < attempts - 1) await pause(1000 * 2 ** attempt);
    }
  }
  throw error;
}
export function normalizeBook(row) {
  if (!row.key || !row.title) return null;
  const key = row.key.replace(/^\/works\//, '');
  return { _id: `openlibrary:${key}`, title: row.title, kind: 'BOOK', description: `${row.title}${row.author_name?.length ? ' — ' + row.author_name.join(', ') : ''}`, sourceId: 'openlibrary', url: `https://openlibrary.org/works/${key}`, year: Number.isInteger(row.first_publish_year) ? row.first_publish_year : null, value: row.edition_count || 0, tags: (row.subject || []).slice(0, limits.tags), authors: (row.author_name || []).slice(0, limits.authors).map(name => ({ name })), book: { editionCount: row.edition_count || 0, languages: (row.language || []).slice(0, limits.languages) }, updatedAt: new Date().toISOString() };
}
export function normalizeCountry(row) {
  if (!row.cca3 || !row.name?.common) return null;
  return { _id: `countries:${row.cca3}`, title: row.name.common, kind: 'COUNTRY', description: row.name.official || row.name.common, sourceId: 'countries', url: 'https://github.com/mledoze/countries', year: null, value: row.area ?? null, tags: [row.region, row.subregion].filter(Boolean), authors: [], country: { capital: (row.capital || []).slice(0, limits.capital), region: row.region, population: row.population ?? null, area: row.area ?? null, languages: Object.values(row.languages || {}).slice(0, limits.languages) }, updatedAt: new Date().toISOString() };
}
export function normalizeProduct(row) {
  if (row.id == null || !row.title) return null;
  return { _id: `dummyjson:${row.id}`, title: row.title, kind: 'PRODUCT', description: row.description || '', sourceId: 'dummyjson', url: `https://dummyjson.com/products/${row.id}`, year: null, value: row.price || 0, tags: [...new Set([row.category, ...(row.tags || [])].filter(Boolean))].slice(0, limits.tags), authors: [], product: { brand: row.brand, price: row.price, rating: row.rating, stock: row.stock }, updatedAt: new Date().toISOString() };
}
export async function writeBatch(database, records) {
  const unique = [...new Map(records.filter(Boolean).map(row => [row._id, row])).values()];
  if (unique.length) await database.collection('entries').bulkWrite(unique.map(row => ({ updateOne: { filter: { _id: row._id }, update: { $set: row }, upsert: true } })), { ordered: false });
  return unique.length;
}
export async function importSource(database, job, sourceId, { checkpoint, isActive, fetcher = fetchJson, pause = sleep }) {
  const progress = job.progress.find(p => p.sourceId === sourceId);
  if (progress.done) return;
  async function save(records, page, done) {
    if (!await isActive()) throw new Error('Задача остановлена или потеряна аренда');
    await writeBatch(database, records);
    progress.fetched = await database.collection('entries').countDocuments({ sourceId });
    progress.page = page; progress.done = done; progress.error = null;
    await checkpoint();
  }
  if (sourceId === 'countries') {
    const rows = await fetcher('https://raw.githubusercontent.com/mledoze/countries/master/countries.json');
    if (!Array.isArray(rows) || rows.length < 100) throw new Error('Countries Dataset: неполный или неверный ответ');
    await save(rows.map(normalizeCountry), 1, true); return;
  }
  if (sourceId === 'dummyjson') {
    const data = await fetcher('https://dummyjson.com/products?limit=0');
    if (!Array.isArray(data.products) || !data.products.length) throw new Error('DummyJSON: пустой ответ');
    await save(data.products.map(normalizeProduct), 1, true); return;
  }
  // One request per second, requested fields only; stable ordering and persistent checkpoints.
  for (let page = progress.page + 1; ; page++) {
    if (!await isActive()) return;
    const url = new URL('https://openlibrary.org/search.json');
    url.search = new URLSearchParams({ q: 'language:eng', fields: 'key,title,author_name,first_publish_year,edition_count,language,subject', limit: '100', page: String(page), sort: 'key' }).toString();
    const data = await fetcher(url.toString());
    if (!Array.isArray(data.docs) || !data.docs.length) throw new Error('Open Library: записи закончились до достижения целевого объёма');
    const rows = data.docs.map(normalizeBook).filter(Boolean);
    await save(rows, page, false);
    if (progress.fetched >= job.target && page * 100 >= job.target) { progress.done = true; await checkpoint(); return; }
    if (page > Math.ceil(job.target / 100) + 200) throw new Error('Open Library: слишком много повторов или неполных страниц');
    await pause(1100);
  }
}
export async function seedSources(database) {
  for (const source of sources) await database.collection('sources').updateOne({ _id: source._id }, { $set: source }, { upsert: true });
}
