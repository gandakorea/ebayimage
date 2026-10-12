import {validate,dateOK,mergeResults} from './board-contract.mjs';
import {executor,executorReady} from './executor.mjs';
export {validate,dateOK} from './board-contract.mjs';
const encoder=new TextEncoder();
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export default {async fetch(req,env){try{

 const url=new URL(req.url);
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return json({error:'허용되지 않은 요청 출처'},403);
 if(url.pathname==='/login')return Response.redirect(`${url.origin}/listing-work`,302);
 if(url.pathname==='/api/direct'||url.pathname==='/api/automation/reference')return executor(req,env);
 if(url.pathname==='/api/automation/health'){await env.DB.prepare('SELECT 1 AS ok').first();return json({ready:true,storage:'D1',registrationExecutor:'local-cloudflare',executorConnected:executorReady(env),photoStorage:false});}
 if(url.pathname==='/api/listing-work'){
 if(req.method==='GET'){const date=url.searchParams.get('date');if(!dateOK(date))return json({error:'날짜 오류'},400);const row=await env.DB.prepare('SELECT body,version,deleted FROM work_batches WHERE date=?').bind(date).first();return json(row&&!row.deleted?{found:true,batch:JSON.parse(row.body),version:row.version}:{found:false,version:row?.version??0});}
 if(!['PUT','DELETE'].includes(req.method))return json({error:'Method not allowed'},405);
 let batch,expected,date;
 if(req.method==='PUT'){const raw=await req.text();if(encoder.encode(raw).length>500000)return json({error:'작업표가 너무 큽니다.'},413);let body;try{body=JSON.parse(raw);batch=validate(body.batch);}catch{return json({error:'작업표 형식 오류'},400);}expected=body.expectedVersion;date=batch.date;
 }else{date=url.searchParams.get('date');expected=req.headers.has('if-match')?Number(req.headers.get('if-match')):undefined;}
 if(!dateOK(date)||!Number.isSafeInteger(expected)||expected<0)return json({error:'먼저 작업표를 읽으세요.'},400);
 const old=await env.DB.prepare('SELECT body,version,deleted FROM work_batches WHERE date=?').bind(date).first();if((old?.version??0)!==expected)return json({error:'다른 곳에서 변경됐습니다. 다시 불러오세요.'},409);
 if(batch)batch=mergeResults(batch,old&&!old.deleted?JSON.parse(old.body):null);
 const version=expected+1,now=new Date().toISOString(),body=JSON.stringify(batch??(old?JSON.parse(old.body):{date}));
 const result=await env.DB.prepare('INSERT INTO work_batches(date,body,version,deleted,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET body=excluded.body,version=excluded.version,deleted=excluded.deleted,updated_at=excluded.updated_at WHERE work_batches.version=?').bind(date,body,version,req.method==='DELETE'?1:0,now,expected).run();
 if(result.meta.changes<1)return json({error:'작업표 변경 충돌'},409);
 return json({saved:req.method==='PUT',deleted:req.method==='DELETE',version,updatedAt:now,itemCount:batch?.groups.flatMap(g=>g.items).filter(r=>r.itemNumber).length??0});
 }
 if(url.pathname.startsWith('/api/'))return json({error:'등록은 로컬 에르메스에서 실행합니다.'},404);
 const response=await env.ASSETS.fetch(req),headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");return new Response(response.body,{status:response.status,headers});
 }catch{return json({error:'작업표 처리 실패. 기존 자료를 유지했습니다.'},500);}}};
