import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{dateOK} from '../src/worker.mjs';
import { database } from './d1-local.mjs';
const secret='test-only-not-a-production-credential-123456789';
const makeBatch=()=>({date:'2026-10-11',batchMemo:'검증용',scheduledTime:'17:00',automationEnabled:false,publishMode:'approval',groups:[1,2,3].map(agent=>({agent,items:[{id:`test-${agent}`,itemNumber:agent===1?'123456789012':'',price:'20',shippingPolicy:'7day normal',memo:''}]}))});
function setup(){const DB=database();const env={DB,WORKER_SECRET:secret,ASSETS:{fetch:async()=>new Response('test asset')}};const call=(path,method='GET',body,headers={})=>worker.fetch(new Request(`https://test.example${path}`,{method,headers:{authorization:`Bearer ${secret}`,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined}),env);return {DB,env,call};}
test('read/save/read/CAS conflict/delete/history and restore use actual SQLite',async()=>{
 const {DB,call}=setup();try{
 assert.deepEqual(await (await call('/api/listing-work?date=2026-10-11')).json(),{found:false,version:0});
 const batch=makeBatch();let r=await call('/api/listing-work','PUT',{batch,expectedVersion:0});assert.equal(r.status,200);assert.equal((await r.json()).version,1);
 r=await call('/api/listing-work?date=2026-10-11');assert.deepEqual((await r.json()).batch,batch);
 assert.equal((await call('/api/listing-work','PUT',{batch,expectedVersion:0})).status,409);
 assert.equal((await call('/api/listing-work?date=2026-10-11','DELETE',undefined,{'if-match':'1'})).status,200);
 assert.deepEqual(await (await call('/api/listing-work?date=2026-10-11')).json(),{found:false,version:2});
 assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM work_batch_history').get().n,2);
 assert.equal((await call('/api/listing-work','PUT',{batch,expectedVersion:2})).status,200);
 }finally{DB.close();}
});
test('public access, cross origin, malformed data and DB failures cannot appear as empty success',async()=>{
 const {DB,env,call}=setup();try{
 assert.equal((await worker.fetch(new Request('https://test.example/api/listing-work?date=2026-10-11'),env)).status,200);
 assert.equal((await call('/api/listing-work','PUT',{batch:makeBatch(),expectedVersion:0},{origin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/listing-work','PUT',{batch:makeBatch()})).status,400);
 assert.equal((await call('/api/listing-work?date=2026-02-30')).status,400);
 env.DB={prepare(){throw Error('failure');}};assert.equal((await call('/api/listing-work?date=2026-10-11')).status,500);
 }finally{DB.close();}
});
test('passwordless page and old login redirect',async()=>{const {DB,env}=setup();try{delete env.WORKER_SECRET;assert.equal((await worker.fetch(new Request('https://test.example/listing-work'),env)).status,200);const r=await worker.fetch(new Request('https://test.example/login'),env);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://test.example/listing-work');}finally{DB.close();}});
test('newer execution result survives older browser edit',async()=>{
 const {DB,call}=setup();try{
 const original=makeBatch();original.groups[0].items[0].statusUpdatedAt='2026-10-11T10:00:00Z';original.groups[0].items[0].usResult={status:'completed',listingId:'test'};
 await call('/api/listing-work','PUT',{batch:original,expectedVersion:0});const stale=makeBatch();stale.batchMemo='새 메모';stale.groups[0].items[0].statusUpdatedAt='2026-10-11T09:00:00Z';await call('/api/listing-work','PUT',{batch:stale,expectedVersion:1});
 const result=await (await call('/api/listing-work?date=2026-10-11')).json();assert.equal(result.batch.groups[0].items[0].usResult.listingId,'test');assert.equal(result.batch.batchMemo,'새 메모');
 }finally{DB.close();}
});

test('photo fields and inline image bytes cannot enter D1',async()=>{const {DB,call}=setup();try{for(const mutate of [b=>{b.images=['https://example.com/photo.jpg'];},b=>{b.groups[0].items[0].photoData='abc';},b=>{b.batchMemo='data:image/png;base64,AAAA';},b=>{b.batchMemo='A'.repeat(1500);}]){const batch=makeBatch();mutate(batch);assert.equal((await call('/api/listing-work','PUT',{batch,expectedVersion:0})).status,400);}assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM work_batches').get().n,0);}finally{DB.close();}});
