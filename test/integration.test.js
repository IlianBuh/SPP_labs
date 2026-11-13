import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { indexes } from '../src/db.js';
import { seedSources, normalizeBook, normalizeCountry, normalizeProduct, writeBatch } from '../src/ingest.js';

const pause = ms => new Promise(r => setTimeout(r,ms));
test('MongoDB + gateway + two subgraphs: federation, CRUD, import lease, limits and service failure', { timeout:300000 }, async () => {
  const memory = process.env.TEST_MONGODB_URI ? null : await MongoMemoryServer.create({ binary: { version:'8.0.17' } });
  const uri = process.env.TEST_MONGODB_URI || memory.getUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS:5000 });
  await client.connect();
  const databaseName = `atlas_test_${randomUUID().replaceAll('-','')}`;
  const database = client.db(databaseName);
  const children = [];
  let logs = '';
  const env = { ...process.env, MONGODB_URI:uri, MONGODB_DATABASE:databaseName, AUTO_IMPORT:'false', PORT:'4400', CATALOG_PORT:'4401', WORKSPACE_PORT:'4402', CATALOG_URL:'http://127.0.0.1:4401/graphql', WORKSPACE_URL:'http://127.0.0.1:4402/graphql', INTERNAL_SECRET:'integration-secret', ADMIN_TOKEN:'integration-token', REQUESTS_PER_MINUTE:'100' };
  const run = name => { const child = spawn(process.execPath,[`src/${name}.js`],{ env,stdio:['ignore','pipe','pipe'] }); children.push(child); child.stdout.on('data',d=>{logs+=d;}); child.stderr.on('data',d=>{logs+=d;}); return child; };
  async function query(query,variables={},token='integration-token') { const response = await fetch('http://127.0.0.1:4400/graphql',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({query,variables})}); return { status:response.status,traceId:response.headers.get('x-trace-id'),...await response.json() }; }
  async function ok(queryText,variables) { const result = await query(queryText,variables); assert.equal(result.errors,undefined,JSON.stringify(result.errors)); return result; }
  try {
    await indexes(database); await seedSources(database);
    await writeBatch(database,[normalizeBook({key:'/works/TEST',title:'Integration Book',author_name:['Writer'],first_publish_year:2000}),normalizeCountry({cca3:'BLR',name:{common:'Belarus'},population:9000000}),normalizeProduct({id:1,title:'Test Phone',price:10})]);
    await writeBatch(database,[normalizeProduct({id:1,title:'Test Phone',price:10})]);
    assert.equal(await database.collection('entries').countDocuments(),3,'upsert deduplicates');
    run('catalog'); const workspace = run('workspace'); run('gateway');
    let ready = false;
    for (let i=0;i<100;i++) { try { const r=await query('{ sources { id } collections { id } }'); if (!r.errors) {ready=true;break;} } catch { /* startup */ } await pause(200); }
    assert.ok(ready,logs);
    const page = await ok('query($f: EntryFilter) { entries(filter:$f, pageSize:1) { total items { id title } pageInfo { hasNextPage totalPages } } }',{f:{kind:'BOOK',search:'Integration'}});
    assert.equal(page.data.entries.total,1);
    assert.equal((await query('{ entries(pageSize:101) { total } }')).errors[0].extensions.code,'BAD_USER_INPUT');
    assert.equal((await query('mutation { createCollection(name:"Unauthorized") { id } }',{},'wrong')).errors[0].extensions.code,'UNAUTHENTICATED');
    const created = await ok('mutation { createCollection(name:"Reading") { id } }'); const id=created.data.createCollection.id;
    await ok('mutation($id:ID!){ addToCollection(collectionId:$id,entryId:"openlibrary:TEST"){id} }',{id});
    await ok('mutation($id:ID!){ addToCollection(collectionId:$id,entryId:"openlibrary:TEST"){id} }',{id});
    const note=await ok('mutation { addNote(entryId:"openlibrary:TEST",text:"Remember") { id } }');
    const noteSummary=await ok('{entry(id:"openlibrary:TEST"){noteCount notes(limit:1){text}}}');
    assert.equal(noteSummary.data.entry.noteCount,1);assert.equal(noteSummary.data.entry.notes.length,1);
    const federated=await ok('query Federation($id:ID!) { collection(id:$id) { name items { title authors { name } source { name } notes { text entry { title } } } } }',{id});
    assert.equal(federated.data.collection.items.length,1);
    assert.equal(federated.data.collection.items[0].notes[0].entry.title,'Integration Book');
    await pause(150);
    const trace = await ok('query($t:String){ diagnostics(traceId:$t) { spans { id service traceId parentId } } }',{t:federated.traceId});
    assert.deepEqual(new Set(trace.data.diagnostics.spans.map(s=>s.service)),new Set(['gateway','catalog','workspace']));
    const root=trace.data.diagnostics.spans.find(s=>s.service==='gateway');
    assert.ok(trace.data.diagnostics.spans.filter(s=>s.service!=='gateway').every(s=>s.parentId===root.id));
    const job=await ok('mutation { startImport(target:10000) { id } }'); const duplicate=await ok('mutation { startImport(target:10000) { id } }');
    assert.equal(job.data.startImport.id,duplicate.data.startImport.id);
    await ok('mutation($id:ID!){cancelImport(id:$id){status}}',{id:job.data.startImport.id});
    await ok('mutation($id:ID!){deleteNote(id:$id)}',{id:note.data.addNote.id});
    await ok('mutation($id:ID!){renameCollection(id:$id,name:"Renamed"){name}}',{id});
    await ok('mutation($id:ID!){removeFromCollection(collectionId:$id,entryId:"openlibrary:TEST"){id}}',{id});
    await ok('mutation($id:ID!){deleteCollection(id:$id)}',{id});
    await database.collection('collections').insertMany(Array.from({length:21},(_,i)=>({_id:`page-${i}`,name:`Collection ${i}`,entryIds:[],createdAt:new Date().toISOString()})));
    const firstPage=await ok('{collectionCount collections(limit:20,offset:0){id}}');
    const secondPage=await ok('{collections(limit:20,offset:20){id}}');
    assert.equal(firstPage.data.collectionCount,21);assert.equal(firstPage.data.collections.length,20);assert.equal(secondPage.data.collections.length,1);
    assert.equal(new Set([...firstPage.data.collections,...secondPage.data.collections].map(c=>c.id)).size,21);
    const direct=await fetch('http://127.0.0.1:4401/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'{ sources { id } }'})}); assert.equal(direct.status,403);
    let limited=false, limitedTrace;
    for(let i=0;i<105;i++){const r=await query('{ __typename }');if(r.status===429){limited=true;limitedTrace=r.traceId;break;}}
    assert.ok(limited,'rate limit enforced');
    await pause(100);
    const diagnosticResponse=await fetch('http://127.0.0.1:4402/graphql',{method:'POST',headers:{'content-type':'application/json','x-internal-secret':'integration-secret'},body:JSON.stringify({query:'query($trace:String){diagnostics(traceId:$trace){requests errors rejected rateLimited spans{traceId status code}}}',variables:{trace:limitedTrace}})});
    const diagnostics=await diagnosticResponse.json();assert.equal(diagnostics.errors,undefined,JSON.stringify(diagnostics));
    assert.ok(diagnostics.data.diagnostics.requests>=100);assert.ok(diagnostics.data.diagnostics.rateLimited>=1);
    assert.ok(diagnostics.data.diagnostics.spans.some(s=>s.status===429&&s.code==='RATE_LIMITED'));
    const exited=once(workspace,'exit'); workspace.kill(); await exited;
    // A fresh gateway process resets this process-local rate window; this also
    // checks that restarting the gateway preserves persisted application data.
    const gateway=children[2], gatewayExited=once(gateway,'exit');gateway.kill();await gatewayExited;run('gateway');
    let restarted=false;
    for(let i=0;i<100;i++){try{const r=await query('{entries{total}}');if(!r.errors){restarted=true;break;}}catch{}await pause(200);}
    assert.ok(restarted,logs.slice(-5000));
    assert.equal((await ok('{ entries { total } }')).data.entries.total,3,'catalog survives workspace outage');
    assert.ok((await query('{ collections { id } }')).errors?.length,'outage reported through GraphQL');
  } catch(error) { console.error(logs.slice(-10000)); throw error; }
  finally {
    await Promise.all(children.filter(c=>c.exitCode===null&&!c.killed).map(async child=>{ const exited=once(child,'exit');child.kill();await exited;}));
    await database.dropDatabase(); await client.close(); await memory?.stop();
  }
});
