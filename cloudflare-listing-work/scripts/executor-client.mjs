import{readFile,writeFile,lstat}from'node:fs/promises';import{createHash}from'node:crypto';import path from'node:path';import{metadataPackage}from'../src/executor.mjs';import{decodePng,verifyEPS}from'./local-photo-validation.mjs';
const root=path.resolve(import.meta.dirname,'../..'),origin='https://korea-autoparts-listing-desk.kongee7425.workers.dev',sha=b=>createHash('sha256').update(b).digest('hex');
const [inputFile,outputFile]=process.argv.slice(2);if(!inputFile||!outputFile)throw Error('Usage: node cloudflare-listing-work/scripts/executor-client.mjs request.json new-response.json');
const env=Object.fromEntries((await readFile(path.join(root,'.env.automation.local'),'utf8')).split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const input=JSON.parse(await readFile(inputFile,'utf8'));let body,headers={authorization:'Bearer '+env.AUTOMATION_ADMIN_SECRET};
if(input.action==='begin'){
 if(!input.packageFile||!input.approvalFile)throw Error('Approved local package and photo approval required');const ps=JSON.parse(await readFile(input.packageFile,'utf8')),approval=JSON.parse(await readFile(input.approvalFile,'utf8'));if(approval.passed!==true||approval.images?.length!==ps.reduce((n,p)=>n+p.images.length,0))throw Error('Photo approval not passed');
 for(const p of ps)for(const im of p.images){const f=path.resolve(im.path);if(!f.startsWith(path.join(root,'완성본',p.partNumber)+path.sep)||(await lstat(f)).isSymbolicLink())throw Error('Final path mismatch');const bytes=await readFile(f);if(sha(bytes)!==im.sha256||!approval.images.some(a=>a.sha256===im.sha256&&a.path===im.path))throw Error('Photo approval/file SHA changed');await decodePng(bytes);}
 body=JSON.stringify({action:'begin',date:input.date,run:input.run,items:ps.map(metadataPackage)});headers['content-type']='application/json';
}else if(input.action==='upload'){
 const p=JSON.parse(await readFile(input.packageFile,'utf8')).find(p=>p.localUUID===input.itemId);const im=p?.images[input.index];if(!im)throw Error('Exact local photo required');const f=path.resolve(im.path);if(!f.startsWith(path.join(root,'완성본',p.partNumber)+path.sep)||(await lstat(f)).isSymbolicLink())throw Error('Final path mismatch');body=await readFile(f);if(sha(body)!==im.sha256)throw Error('Photo changed');await decodePng(body);headers={...headers,'content-type':'application/octet-stream','x-exact-run':input.run,'x-exact-ref':p.reference,'x-exact-item-id':p.localUUID,'x-exact-market':input.market,'x-exact-index':String(input.index)};
}else{body=JSON.stringify(input);headers['content-type']='application/json';}
try{
 const r=await fetch(origin+'/api/direct',{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(120000)}),result=await r.json();await writeFile(outputFile,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});if(!r.ok||!result.ok)throw Error('Remote operation failed');
 if(input.action==='upload'){const proof=await verifyEPS(result.result.value.maxDimensionImageUrl,await decodePng(body));await writeFile(outputFile+'.eps-QA.json',JSON.stringify({passed:true,...proof}),{flag:'wx',mode:0o600});}
 console.log(JSON.stringify({ok:true,action:input.action,outputFile}));
}catch{console.error('Operation incomplete; inspect saved receipt and exact status. No automatic retry.');process.exitCode=1;}
