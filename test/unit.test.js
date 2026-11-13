import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'graphql';
import { composeServices } from '@apollo/composition';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { catalogTypeDefs, workspaceTypeDefs } from '../src/schema.js';
import { entryQuery, operationCost, cleanText } from '../src/query.js';
import { normalizeBook, normalizeCountry, normalizeProduct, fetchJson, importSource } from '../src/ingest.js';
import { circuitBreakerFetch } from '../src/circuit-breaker.js';

test('Federation composes both real subgraphs and shared Entry entity', () => {
  assert.ok(buildSubgraphSchema([{ typeDefs: catalogTypeDefs }]));
  assert.ok(buildSubgraphSchema([{ typeDefs: workspaceTypeDefs }]));
  const result = composeServices([{ name: 'catalog', url: 'http://catalog/graphql', typeDefs: catalogTypeDefs }, { name: 'workspace', url: 'http://workspace/graphql', typeDefs: workspaceTypeDefs }]);
  assert.equal(result.errors, undefined);
  assert.match(result.supergraphSdl, /join__Graph/);
});
test('filters, text index search, stable sorting, and bounded pagination', () => {
  const query = entryQuery({ search: 'tolkien', kind: 'BOOK', minYear: 1900, maxYear: 2000, minValue: 10, tag: 'Fiction' }, { field:'YEAR', direction:'DESC' },2,12);
  assert.deepEqual(query, { query: { $text: { $search:'tolkien' }, kind:'BOOK', tags:'Fiction', year: { $gte:1900,$lte:2000 }, value: { $gte:10 } }, sort:{ year:-1,_id:-1 },skip:12,limit:12 });
  assert.throws(() => entryQuery({}, {}, 0));
  assert.throws(() => entryQuery({}, {}, 1, 101));
  assert.throws(() => entryQuery({ minYear:2000,maxYear:1900 }));
  assert.throws(() => cleanText('   ',100,'name'));
});
test('complexity includes aliases, fragments, nesting, and variable list sizes', () => {
  const doc = parse('query Q($n: Int!) { a: entries(pageSize:$n) { items { ...Fields } } b: entries(pageSize:$n) { items { id } } } fragment Fields on Entry { id title notes { text entry { title } } }');
  const small = operationCost(doc, doc.definitions[0], { n:1 }), large = operationCost(doc, doc.definitions[0], { n:100 });
  assert.equal(small.depth, 5);
  assert.ok(large.cost > small.cost);
  const repeated = parse('query { a: entries { items { id } } b: entries { items { id } } }');
  const single = parse('query { entries { items { id } } }');
  assert.equal(operationCost(repeated, repeated.definitions[0]).cost, operationCost(single,single.definitions[0]).cost * 2);
});
test('source adapters preserve identity and distinct typed metadata', () => {
  const book = normalizeBook({ key:'/works/OL1W',title:'Book',author_name:['Writer'],first_publish_year:1990,edition_count:2,language:['eng'] });
  assert.equal(book._id,'openlibrary:OL1W'); assert.equal(book.book.editionCount,2);
  assert.deepEqual(book.authors,[{name:'Writer'}]);
  const country = normalizeCountry({ cca3:'BLR',name:{common:'Belarus'},population:9000000,languages:{bel:'Belarusian'} });
  assert.equal(country.kind,'COUNTRY'); assert.deepEqual(country.country.languages,['Belarusian']);
  const product = normalizeProduct({ id:1,title:'Product',price:12,stock:3 });
  assert.equal(product.product.stock,3); assert.equal(product.value,12);
  assert.equal(normalizeBook({}),null); assert.equal(normalizeCountry({}),null); assert.equal(normalizeProduct({}),null);
});
test('upstream retries transient failures with bounded backoff', async () => {
  let calls = 0; const waits = [];
  const result = await fetchJson('https://example.org/data', { fetcher: async () => { calls++; return calls < 3 ? new Response('',{status:503}) : Response.json({ok:true}); }, pause: async ms => waits.push(ms) });
  assert.deepEqual(result,{ok:true}); assert.equal(calls,3); assert.deepEqual(waits,[1000,2000]);
});
test('permanent upstream errors are not retried; exhausted retries reject', async () => {
  let calls = 0;
  await assert.rejects(fetchJson('https://example.org/data', { fetcher: async () => { calls++; return new Response('',{status:404}); }, pause:async()=>{} }), /HTTP 404/);
  assert.equal(calls,1);
  await assert.rejects(fetchJson('https://example.org/data', { fetcher: async () => new Response('',{status:429}), pause:async()=>{},attempts:2 }), /HTTP 429/);
});

test('import reaches 10000 unique books, writes checkpoints, resumes and remains idempotent', async () => {
  const records = new Map();
  const database = { collection: () => ({
    async bulkWrite(operations) { for(const op of operations) records.set(op.updateOne.filter._id,op.updateOne.update.$set); },
    async countDocuments({sourceId}) { return [...records.values()].filter(row=>row.sourceId===sourceId).length; }
  }) };
  const job = { target:10000,progress:[{sourceId:'openlibrary',fetched:0,page:0,done:false}] };
  const checkpoints = [];
  const fetcher = async url => { const page=Number(new URL(url).searchParams.get('page')); return {docs:Array.from({length:100},(_,i)=>({key:`/works/OL${(page-1)*100+i}W`,title:`Book ${(page-1)*100+i}`}))}; };
  const options = { fetcher,pause:async()=>{},isActive:async()=>true,checkpoint:async()=>checkpoints.push(structuredClone(job.progress)) };
  await importSource(database,job,'openlibrary',options);
  assert.equal(records.size,10000); assert.equal(job.progress[0].done,true); assert.equal(job.progress[0].page,100);
  assert.equal(checkpoints.length,101);
  // Resume from the persisted penultimate page: replay/upsert cannot duplicate records.
  job.progress[0] = {sourceId:'openlibrary',fetched:9900,page:99,done:false};
  const called=[];
  await importSource(database,job,'openlibrary',{...options,fetcher:async url=>{called.push(Number(new URL(url).searchParams.get('page')));return fetcher(url);}});
  assert.deepEqual(called,[100]); assert.equal(records.size,10000);
});
test('cancelled import stops before fetching the next page', async () => {
  let fetched=false;
  await importSource({}, {target:10000,progress:[{sourceId:'openlibrary',page:0,done:false}]},'openlibrary',{checkpoint:async()=>{},isActive:async()=>false,fetcher:async()=>{fetched=true;}});
  assert.equal(fetched,false);
});
test('deep operations and fragment fanout are rejected before execution', () => {
  const source = 'query { entry(id:"x") { ' + 'notes { entry { '.repeat(6) + 'id ' + '} } '.repeat(6) + '} }';
  const doc=parse(source);
  assert.throws(()=>operationCost(doc,doc.definitions[0]),e=>e.extensions?.code==='QUERY_TOO_COMPLEX');
  const fanout=parse('query { collections { items { notes { entry { notes { entry { title } } } } } } }');
  assert.throws(()=>operationCost(fanout,fanout.definitions[0]),e=>e.extensions?.code==='QUERY_TOO_COMPLEX');
  const fragments = parse('query { ...F18 } fragment F0 on Query { __typename } ' + Array.from({length:18},(_,i)=>`fragment F${i+1} on Query { ...F${i} ...F${i} }`).join(' '));
  assert.throws(()=>operationCost(fragments,fragments.definitions[0]),e=>e.extensions?.code==='QUERY_TOO_COMPLEX');
});

test('cost uses variable defaults, schema parent types and actual bounded list sizes', () => {
  const doc=parse('query Q($n:Int=100){ entries(pageSize:$n) { items { id title } } }');
  assert.deepEqual(operationCost(doc,doc.definitions[0]),operationCost(doc,doc.definitions[0],{n:100}));
  assert.ok(operationCost(doc,doc.definitions[0]).cost > operationCost(doc,doc.definitions[0],{n:1}).cost * 20);
  const unsafe=parse('{ collections { items { notes { text entry { title } } } } }');
  assert.throws(()=>operationCost(unsafe,unsafe.definitions[0]),e=>e.extensions?.code==='QUERY_TOO_COMPLEX');
  const bounded=parse('{ collections(limit:5) { items(limit:10) { notes(limit:5) { text entry { title } } } } }');
  assert.ok(operationCost(bounded,bounded.definitions[0]).cost<50000);
  const fragmented=parse('query Q($n:Int=100){ entries(pageSize:$n) { ...Page } } fragment Page on EntryPage { items { id title } }');
  assert.deepEqual(operationCost(fragmented,fragmented.definitions[0]),operationCost(doc,doc.definitions[0]));
  const skipped=parse('query Q($skip:Boolean=true) { collections @skip(if:$skip) { items { notes { text entry { title } } } } }');
  assert.equal(operationCost(skipped,skipped.definitions[0]).cost,0);
});

test('circuit breaker opens, allows one recovery probe, and closes after recovery', async () => {
  let clock=0,calls=0,healthy=false,release;
  const fetcher=circuitBreakerFetch({now:()=>clock,resetMs:100,fetcher:async()=>{calls++;if(!healthy)return new Response('',{status:503});await new Promise(r=>{release=r;});return Response.json({ok:true});}});
  for(let i=0;i<3;i++)await assert.rejects(fetcher('http://fixture'),/HTTP 503/);
  await assert.rejects(fetcher('http://fixture'),/circuit breaker/);assert.equal(calls,3);
  clock=101;healthy=true;
  const probe=fetcher('http://fixture');
  await assert.rejects(fetcher('http://fixture'),/circuit breaker/);assert.equal(calls,4);
  release();assert.equal((await probe).status,200);
  const next=fetcher('http://fixture');release();assert.equal((await next).status,200);assert.equal(calls,5);
});
