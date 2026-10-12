import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import worker from '../src/worker.mjs';
import { database } from './d1-local.mjs';
const DB=database();const secret=randomBytes(32).toString('hex');
const env={DB,WORKER_SECRET:secret,ASSETS:{async fetch(req){const u=new URL(req.url);const name=u.pathname==='/app.js'?'app.js':u.pathname==='/app.css'?'app.css':'index.html';return new Response(await readFile(path.join(import.meta.dirname,'../dist',name)),{headers:{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html;charset=utf-8'}});}}};
// Loopback-only preview uses disposable in-memory DB, no production credentials or eBay calls.
http.createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const result=await worker.fetch(new Request(`http://localhost:8787${req.url}`,{method:req.method,headers:{...req.headers,authorization:`Bearer ${secret}`},body:body.length?body:undefined}),env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));}catch{res.writeHead(500);res.end('Preview failed');}}).listen(8787,'127.0.0.1',()=>console.log('Disposable local preview: http://localhost:8787/listing-work'));
