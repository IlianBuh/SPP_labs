import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, indexes, closeDb } from './db.js';
import { seedSources } from './ingest.js';

try { const database = await db(); await indexes(database); await seedSources(database); await closeDb(); }
catch (error) { console.error(`MongoDB недоступна: ${error.message}\nЗапустите Docker Desktop и выполните docker compose up -d`); process.exit(1); }
let stopping = false;
const children = new Set(), timers = new Set();
function run(name) {
  if (stopping) return;
  const child = spawn(process.execPath, [fileURLToPath(new URL(`./${name}.js`, import.meta.url))], { stdio: 'inherit', env: process.env });
  children.add(child);
  child.on('exit', (code) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} завершился (${code}); перезапуск через 3 секунды`);
      const timer = setTimeout(() => { timers.delete(timer); run(name); }, 3000); timers.add(timer);
    }
  });
}
for (const name of ['catalog', 'workspace', 'gateway', 'worker']) run(name);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(0); }, 5000).unref();
});
