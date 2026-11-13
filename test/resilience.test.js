import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { runLoad } from '../scripts/load.js';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(action, timeout=30000) {
  const end=Date.now()+timeout;
  let last;
  while(Date.now()<end){try{const value=await action();if(value)return value;}catch(e){last=e;}await pause(100);}
  throw new Error(`Condition timed out: ${last?.message || ''}`);
}
test('automatic import survives worker crash; replica set survives primary loss; indexed reads withstand sustained load', {timeout:240000}, async()=>{
  const replica=await MongoMemoryReplSet.create({binary:{version:'8.0.17'},replSet:{count:3,storageEngine:'wiredTiger',configSettings:{electionTimeoutMillis:1000}},instanceOpts:Array.from({length:3},()=>({args:['--wiredTigerCacheSizeGB','0.25']}))});
  const client=new MongoClient(replica.getUri(),{serverSelectionTimeoutMS:20000,writeConcern:{w:'majority'}});
  await client.connect();
  const name=`atlas_resilience_${randomUUID().replaceAll('-','')}`,database=client.db(name),children=[];
  let logs='';
  const env={...process.env,MONGODB_URI:replica.getUri(),MONGODB_DATABASE:name,AUTO_IMPORT:'true',IMPORT_TARGET:'10000',WORKER_LEASE_MS:'3000',WORKER_POLL_MS:'50',PORT:'4800',CATALOG_PORT:'4801',WORKSPACE_PORT:'4802',CATALOG_URL:'http://127.0.0.1:4801/graphql',WORKSPACE_URL:'http://127.0.0.1:4802/graphql',REQUESTS_PER_MINUTE:'100000',ADMIN_TOKEN:'',HOST:'127.0.0.1'};
  const run=path=>{const child=spawn(process.execPath,[path],{env,stdio:['ignore','pipe','pipe']});children.push(child);for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{logs=(logs+d).slice(-15000);});return child;};
  const stop=async child=>{if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill('SIGKILL');await exited;};
  const query=async text=>{const r=await fetch('http://127.0.0.1:4800/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:text}),signal:AbortSignal.timeout(25000)});const body=await r.json();if(body.errors||!r.ok)throw new Error(JSON.stringify(body));return body.data;};
  try {
    const first=run('test/fixtures/worker.js');
    await until(async()=>{const j=await database.collection('jobs').findOne({active:true});return j?.progress[0].page>=2&&j;});
    await stop(first);
    const interrupted=await database.collection('jobs').findOne({active:true});
    assert.equal(interrupted.status,'RUNNING');assert.ok(interrupted.progress[0].page<100);
    const replacement=run('test/fixtures/worker.js');
    const complete=await until(async()=>{const j=await database.collection('jobs').findOne({_id:interrupted._id});if(j?.status==='FAILED')throw new Error(j.error);return j?.status==='COMPLETED'&&j;},90000);
    assert.notEqual(complete.owner,interrupted.owner);assert.ok(complete.attempts>=2);
    const resumed=await database.collection('fixture_fetches').findOne({pid:replacement.pid});
    assert.equal(resumed.page,interrupted.progress[0].page+1);
    assert.equal(await database.collection('entries').countDocuments(),10101);
    assert.equal(await database.collection('entries').countDocuments({sourceId:'openlibrary'}),10000);
    await stop(replacement);
    for(const direction of [1,-1])for(const field of ['title','year','value','updatedAt'])for(const filter of [{},{kind:'BOOK'},{sourceId:'openlibrary'}]){
      const explain=await database.collection('entries').find(filter).sort({[field]:direction,_id:direction}).limit(20).explain('executionStats');
      const plan=JSON.stringify(explain.queryPlanner.winningPlan);
      assert.ok(plan.includes('IXSCAN'),`${field} ${direction} ${JSON.stringify(filter)}: ${plan}`);
      assert.ok(!/"stage":"(COLLSCAN|SORT)"/.test(plan),plan);
      assert.ok(explain.executionStats.totalDocsExamined<=20);
    }
    for(const service of ['catalog','workspace','gateway'])run(`src/${service}.js`);
    await until(()=>query('{ entries { total } collections { id } }'));
    const before=await query('mutation { createCollection(name:"Survives failover"){id} }');
    const primary=(await client.db('admin').command({hello:1})).primary;
    const server=replica.servers.find(s=>primary.endsWith(`:${s.instanceInfo.port}`));assert.ok(server);
    const failedAt=Date.now();
    await server.stop({doCleanup:false,force:false});
    const nextPrimary=await until(async()=>{const h=await client.db('admin').command({hello:1});return h.primary!==primary&&h.primary;});
    assert.notEqual(nextPrimary,primary);
    await until(()=>query('mutation { createCollection(name:"After failover"){id} }'));
    assert.equal((await query(`{collection(id:"${before.createCollection.id}"){name}}`)).collection.name,'Survives failover');
    assert.equal((await query('{ entries { total } }')).entries.total,10101);
    console.log(JSON.stringify({primaryFailoverMs:Date.now()-failedAt,previousPrimary:primary,nextPrimary}));
    const load=await runLoad({url:'http://127.0.0.1:4800/graphql',concurrency:10,durationSeconds:15});
    assert.equal(load.failed,0,JSON.stringify(load));assert.equal(load.limited,0,JSON.stringify(load));assert.ok(load.successful>100);
    console.log(JSON.stringify({load}));
    await pause(100);
    const diagnostics=await query('{ diagnostics { requests errors rejected rateLimited overloaded p95Ms services { name inflight } } }');
    assert.ok(diagnostics.diagnostics.requests>100);
    assert.equal(diagnostics.diagnostics.rateLimited,0);
  }catch(error){console.error(logs);throw error;}
  finally{await Promise.all(children.map(stop));await database.dropDatabase();await client.close();await replica.stop();}
});
