import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database(filename=':memory:'){
 const db=new DatabaseSync(filename);for(const n of ['0001.sql','0002_executor.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 return {close:()=>db.close(),raw:db,prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)??null;},async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};}};}};
}
