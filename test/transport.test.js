import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { catalogTypeDefs, workspaceTypeDefs } from '../src/schema.js';
import { serve } from '../src/runtime.js';
import { createGateway } from '../src/gateway.js';
import { config } from '../src/config.js';
import gql from 'graphql-tag';

// Real HTTP/Apollo/Federation transport, isolated fixture resolvers, no MongoDB required.
test('HTTP gateway executes a distributed nested query, traces both subgraphs, protects mutations and isolates outages', {timeout:30000}, async () => {
  const spans=[];
  const database={collection:()=>({updateOne:async()=>({}),insertOne:async span=>{spans.push(span);}})};
  const entry={id:'fixture:1',title:'HTTP federation',kind:'BOOK',description:'Test',url:'https://example.org',tags:[],authors:[{name:'Writer'}],updatedAt:new Date().toISOString()};
  const catalogSchema=buildSubgraphSchema([{typeDefs:catalogTypeDefs,resolvers:{Query:{entry:()=>entry,sources:()=>[]},Entry:{__resolveReference:()=>entry}}}]);
  const workspaceSchema=buildSubgraphSchema([{typeDefs:workspaceTypeDefs,resolvers:{Query:{collections:()=>[{id:'c',name:'Read',createdAt:new Date().toISOString(),items:[{id:entry.id}]}]},Entry:{__resolveReference:r=>r,notes:()=>[{id:'n',text:'Note',createdAt:new Date().toISOString(),entry:{id:entry.id}}]},Mutation:{createCollection:(_,args)=>({id:'new',name:args.name,items:[],createdAt:new Date().toISOString()})}}}]);
  const closes=[];
  const previous={rate:config.rate,adminToken:config.adminToken};
  config.adminToken='transport-secret'; config.rate=20;
  async function request(query,token='transport-secret') {
    const response=await fetch('http://127.0.0.1:4500/graphql',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({query})});
    return {status:response.status,traceId:response.headers.get('x-trace-id'),...await response.json()};
  }
  try {
    closes.push(await serve({name:'catalog',port:4501,database,schema:catalogSchema}));
    const closeWorkspace=await serve({name:'workspace',port:4502,database,schema:workspaceSchema}); closes.push(closeWorkspace);
    closes.push(await serve({name:'gateway',port:4500,database,gateway:createGateway({catalogUrl:'http://127.0.0.1:4501/graphql',workspaceUrl:'http://127.0.0.1:4502/graphql'})}));
    const result=await request('query Transport { collections(limit:5) { name items(limit:10) { title authors { name } notes(limit:5) { text entry { title } } } } }');
    assert.equal(result.errors,undefined,JSON.stringify(result.errors));
    assert.equal(result.data.collections[0].items[0].notes[0].entry.title,entry.title);
    const trace=spans.filter(s=>s.traceId===result.traceId);
    assert.deepEqual(new Set(trace.map(s=>s.service)),new Set(['gateway','catalog','workspace']));
    const root=trace.find(s=>s.service==='gateway'); assert.ok(trace.filter(s=>s!==root).every(s=>s.parentId===root._id));
    assert.equal((await request('mutation { createCollection(name:"Blocked") { id } }','wrong')).errors[0].extensions.code,'UNAUTHENTICATED');
    assert.equal((await request('mutation { createCollection(name:"Allowed") { name } }')).data.createCollection.name,'Allowed');
    const deep='query { entry(id:"x") { '+'notes { entry { '.repeat(6)+'id '+'} } '.repeat(6)+'} }';
    assert.equal((await request(deep)).errors[0].extensions.code,'QUERY_TOO_COMPLEX');
    await closeWorkspace(); closes.splice(1,1);
    assert.equal((await request('{ entry(id:"x") { title } }')).data.entry.title,entry.title);
    assert.ok((await request('{ collections { id } }')).errors?.length);
    let limited=false;for(let i=0;i<25;i++){if((await request('{ __typename }')).status===429){limited=true;break;}}
    assert.ok(limited);
  } finally { for(const close of closes.reverse()) await close(); Object.assign(config,previous); }
});

test('all GraphQL URL variants enforce admission and trace rejected requests', async () => {
  const spans=[], services=new Map();
  const database={collection:name=>({updateOne:async(filter,update)=>{if(name==='services')services.set(filter._id,update.$set);},insertOne:async row=>spans.push(row)})};
  const schema=buildSubgraphSchema([{typeDefs:gql`type Query { ping: String! }`,resolvers:{Query:{ping:()=> 'pong'}}}]);
  const previous={rate:config.rate,concurrent:config.concurrent};
  const closes=[];
  config.rate=1;
  const post=async(port,path,body={query:'{ ping }'})=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,trace:response.headers.get('x-trace-id'),body:await response.json()};};
  try {
    closes.push(await serve({name:'catalog',port:4531,database,schema}));
    closes.push(await serve({name:'gateway',port:4530,database,schema}));
    for(const path of ['/graphql','/graphql/','/GraphQL','/graphql/extra']) {
      const result=await post(4531,path);
      assert.equal(result.status,403,path);assert.ok(result.trace,path);
    }
    assert.equal((await post(4530,'/graphql')).status,200);
    for(const path of ['/graphql','/graphql/','/GraphQL','/graphql/extra']) assert.equal((await post(4530,path)).status,429,path);
    assert.equal(spans.filter(s=>s.status===429).length,4);
    assert.equal(spans.filter(s=>s.status===403).length,4);
    assert.ok(spans.every(s=>s.traceId && s._id));
  } finally {for(const close of closes.reverse())await close();Object.assign(config,previous);}
  assert.equal(services.get('gateway').rateLimited,4);
  assert.equal(services.get('gateway').requests,5);
  assert.equal(services.get('gateway').errors,4);
});

test('disconnect retains execution capacity until completion, then releases exactly once', async () => {
  const spans=[], snapshots=[];
  const database={collection:name=>({updateOne:async(_filter,update)=>{if(name==='services')snapshots.push(update.$set);},insertOne:async row=>spans.push(row)})};
  let entered, finish;
  const started=new Promise(r=>{entered=r;});
  const pending=new Promise(r=>{finish=r;});
  const schema=buildSubgraphSchema([{typeDefs:gql`type Query { ping: String! slow: String! }`,resolvers:{Query:{ping:()=> 'pong',slow:async()=>{entered();await pending;return 'done';}}}}]);
  const previous={rate:config.rate,concurrent:config.concurrent};
  config.rate=100;config.concurrent=1;
  const close=await serve({name:'gateway',port:4532,database,schema});
  const post=(query,signal)=>fetch('http://127.0.0.1:4532/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query}),signal});
  try {
    const abort=new AbortController();
    const request=post('{ slow }',abort.signal).catch(error=>error);
    await started;abort.abort();await request;
    const blocked=await post('{ ping }');assert.equal(blocked.status,503);await blocked.json();
    finish();
    let recovered=false;
    for(let i=0;i<30;i++){const r=await post('{ ping }');await r.json();if(r.status===200){recovered=true;break;}await new Promise(r=>setTimeout(r,10));}
    assert.ok(recovered,'completed aborted resolver must release capacity');
    for(let i=0;i<3;i++){const r=await post('{ ping }');assert.equal(r.status,200);await r.json();}
    const malformed=await fetch('http://127.0.0.1:4532/graphql',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);await malformed.json();
    const normal=await post('{ ping }');assert.equal(normal.status,200);await normal.json();
    assert.ok(spans.some(s=>s.status===499));assert.ok(spans.some(s=>s.status===503));
  }finally{finish();await close();Object.assign(config,previous);}
  assert.equal(snapshots.at(-1).inflight,0);
  assert.ok(snapshots.at(-1).overloaded>=1);
});
