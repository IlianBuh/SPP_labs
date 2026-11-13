// End-to-end evidence: real public sources -> automatic worker -> MongoDB ->
// federated API. All writes go to a unique temporary database, never atlas_lab.
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { MongoClient } from 'mongodb';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { indexes } from '../src/db.js';
import { seedSources } from '../src/ingest.js';
import { runLoad } from './load.js';

const memory=await MongoMemoryServer.create({binary:{version:'8.0.17'},instance:{args:['--wiredTigerCacheSizeGB','0.25']}});
const client=new MongoClient(memory.getUri());await client.connect();
const databaseName=`atlas_live_${randomUUID().replaceAll('-','')}`,database=client.db(databaseName),children=[];
const env={...process.env,MONGODB_URI:memory.getUri(),MONGODB_DATABASE:databaseName,HOST:'127.0.0.1',PORT:'4700',CATALOG_PORT:'4701',WORKSPACE_PORT:'4702',CATALOG_URL:'http://127.0.0.1:4701/graphql',WORKSPACE_URL:'http://127.0.0.1:4702/graphql',AUTO_IMPORT:'true',IMPORT_TARGET:'10000',ADMIN_TOKEN:'',REQUESTS_PER_MINUTE:'100000'};
const artifact={startedAt:new Date().toISOString(),node:process.version,rateLimitForCapacityTest:100000};
let logs='';
const run=name=>{const child=spawn(process.execPath,[`src/${name}.js`],{env,stdio:['ignore','pipe','pipe']});children.push(child);for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{logs=(logs+d).slice(-30000);});return child;};
const query=async query=>{const r=await fetch('http://127.0.0.1:4700/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)});const body=await r.json();if(!r.ok||body.errors)throw new Error(JSON.stringify(body));return body.data;};
try {
  await indexes(database);await seedSources(database);
  for(const service of ['catalog','workspace','gateway','worker'])run(service);
  console.log('Verification UI: http://127.0.0.1:4700 (temporary database)');
  const deadline=Date.now()+1200000;
  let job,lastPage=-1;
  while(Date.now()<deadline){
    if(children.some(c=>c.exitCode!==null||c.signalCode!==null))throw new Error('A service exited unexpectedly');
    job=await database.collection('jobs').findOne({});
    const page=job?.progress?.[0]?.page;
    if(page!=null&&Math.floor(page/10)!==lastPage){lastPage=Math.floor(page/10);console.log(JSON.stringify({status:job.status,books:job.progress[0].fetched,page}));}
    if(job?.status==='FAILED')throw new Error(job.error);
    if(job?.status==='COMPLETED')break;
    await new Promise(r=>setTimeout(r,1000));
  }
  if(job?.status!=='COMPLETED')throw new Error('Import did not finish within 20 minutes');
  artifact.job={id:job._id,status:job.status,progress:job.progress,attempts:job.attempts};
  artifact.catalog=await query('{catalogStats{total kinds{kind count} sources{id count}}}');
  if(artifact.catalog.catalogStats.total<10000||artifact.catalog.catalogStats.sources.some(s=>!s.count))throw new Error('Data requirement not reached');
  artifact.loads=[];
  for(const concurrency of [5,10,20]){
    const load=await runLoad({url:'http://127.0.0.1:4700/graphql',concurrency,durationSeconds:20});
    artifact.loads.push(load);console.log(JSON.stringify({load}));
    if(load.failed||load.limited)throw new Error('Capacity test had failures/rejections');
  }
  artifact.plans={};
  for(const field of ['title','year','value','updatedAt']){
    const explain=await database.collection('entries').find().sort({[field]:-1,_id:-1}).limit(20).explain('executionStats');
    artifact.plans[field]={docsExamined:explain.executionStats.totalDocsExamined,plan:explain.queryPlanner.winningPlan};
  }
  artifact.diagnostics=await query('{diagnostics{requests errors rejected rateLimited overloaded p95Ms services{name status requests errors inflight}}}');
  artifact.finishedAt=new Date().toISOString();
}catch(error){artifact.error=error.message;console.error(logs);process.exitCode=1;}
finally{
  await mkdir('verification',{recursive:true});
  await writeFile('verification/live-result.json',JSON.stringify(artifact,null,2));
  await Promise.all(children.filter(c=>c.exitCode===null&&c.signalCode===null).map(async c=>{const exited=once(c,'exit');c.kill();await exited;}));
  await database.dropDatabase();await client.close();await memory.stop();
}
console.log(JSON.stringify(artifact,null,2));
