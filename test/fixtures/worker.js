// Deterministic external transport only; the real worker, checkpoints, lease,
// normalizers, MongoDB writes and crash recovery run unchanged.
import { runWorker } from '../../src/worker.js';
import { db, closeDb } from '../../src/db.js';
import { importSource, sleep } from '../../src/ingest.js';
const database = await db();
const controller = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => controller.abort());
const fetcher = async url => {
  if (url.includes('countries')) return Array.from({length:100},(_,i)=>({cca3:`C${i}`,name:{common:`Country ${i}`},area:i+1}));
  if (url.includes('dummyjson')) return {products:[{id:1,title:'Fixture product',price:10}]};
  const page=Number(new URL(url).searchParams.get('page'));
  await database.collection('fixture_fetches').insertOne({pid:process.pid,page});
  return {docs:Array.from({length:100},(_,i)=>({key:`/works/T${(page-1)*100+i}`,title:`Book ${(page-1)*100+i}`,first_publish_year:1900+i,edition_count:i}))};
};
try { await runWorker(database,{signal:controller.signal,sourceImporter:(db,job,source,options)=>importSource(db,job,source,{...options,fetcher,pause:()=>sleep(35)})}); }
finally { await closeDb(); }
