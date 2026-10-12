import { readFile } from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
if(!config.d1_databases?.[0]?.database_id || config.d1_databases[0].database_id==='REPLACE_WITH_CREATED_D1_ID')throw Error('Create the D1 database and configure its verified ID before deploying.');
