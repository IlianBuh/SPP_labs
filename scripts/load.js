import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function runLoad({ url = `http://127.0.0.1:${process.env.PORT || 4000}/graphql`, concurrency = 5, total = 50, durationSeconds = 0, query = 'query Load { entries(pageSize: 20) { total items { id title kind source { name } } } }' } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100 || !Number.isInteger(total) || total < 1 || total > 100000 || !Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 300) throw new Error('Usage: npm run test:load -- [concurrency 1..100] [requests 1..100000] [duration seconds 0..300]');
  const samples = [], successful = []; let next = 0, failed = 0, limited = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (durationSeconds ? performance.now() - start < durationSeconds * 1000 : next < total) {
      next++;
      const at = performance.now();
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(30000) });
        const body = await response.json();
        if (response.status === 429 || response.status === 503) limited++;
        else if (!response.ok || body.errors) failed++;
        else successful.push(performance.now() - at);
      } catch { failed++; }
      samples.push(performance.now() - at);
    }
  }));
  const elapsedSeconds = (performance.now() - start) / 1000;
  const percentile = (array, p) => array.length ? array[Math.ceil(array.length * p) - 1] : null;
  samples.sort((a,b) => a-b);successful.sort((a,b) => a-b);
  return { total: samples.length, concurrency, durationSeconds: elapsedSeconds, failed, limited, successful: successful.length, requestsPerSecond: samples.length / elapsedSeconds, successfulRequestsPerSecond: successful.length / elapsedSeconds, p50Ms: percentile(samples,.5), p95Ms: percentile(samples,.95), successfulP95Ms: percentile(successful,.95) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLoad({ concurrency: Number(process.argv[2] || 5), total: Number(process.argv[3] || 50), durationSeconds: Number(process.argv[4] || 0) });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
}
