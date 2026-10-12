import { readFile, writeFile } from 'node:fs/promises';
import { validate, dateOK } from '../src/worker.mjs';
const [operation,dateOrFile,outputFile]=process.argv.slice(2);
const origin=new URL(process.env.LISTING_BOARD_ORIGIN??'https://korea-autoparts-listing-desk.kongee7425.workers.dev');
if(origin.protocol!=='https:' || !origin.hostname.endsWith('.workers.dev') || origin.pathname!=='/' || origin.search || origin.hash || origin.username || origin.password)throw Error('Configure the deployed workers.dev origin');
// The workboard is intentionally public. Never forward executor or provider credentials.
const headers={};
async function read(date){const r=await fetch(`${origin.origin}/api/listing-work?date=${date}`,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Workboard read failed HTTP ${r.status}`);return r.json();}
if(operation==='read'){
 if(!dateOK(dateOrFile)||!outputFile)throw Error('Usage: read YYYY-MM-DD new-output.json');
 const data=await read(dateOrFile);await writeFile(outputFile,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});console.log(`Saved workboard snapshot; found=${data.found}`);
}else if(operation==='import'){
 const raw=JSON.parse(await readFile(dateOrFile,'utf8'));const batch=validate(raw.batch??raw);const current=await read(batch.date);
 if(current.found||current.version!==0)throw Error('Import blocked: target already has current or historical data');
 const response=await fetch(`${origin.origin}/api/listing-work`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({batch,expectedVersion:0}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Import failed HTTP ${response.status}`);console.log('Imported one previously absent workboard');
}else if(operation==='save'){
 // Saved snapshot includes its original revision. Never replace fresh server revision on conflict.
 const snapshot=JSON.parse(await readFile(dateOrFile,'utf8'));validate(snapshot.batch);if(!Number.isSafeInteger(snapshot.version))throw Error('Original snapshot revision required');
 const response=await fetch(`${origin.origin}/api/listing-work`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({batch:snapshot.batch,expectedVersion:snapshot.version}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Save failed HTTP ${response.status}; read and review again, do not blindly retry`);console.log('Workboard saved');
}else throw Error('Use read, import or save. This utility never uploads photos or publishes listings.');
