import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {parseJsonc} from '@runeditrun/rer/jsonc';
import {catalogue,policy} from '@runeditrun/rer/modules/portability/catalogue';
import {archivePolicy} from '../../scripts/installer/portability-policy.mjs';

// Open real D1/R2 only after rer has stopped its application owner.
export async function archiveStorage(root,visit){
 const {getPlatformProxy}=createRequire(join(root,'package.json'))('wrangler');
 const proxy=await getPlatformProxy({configPath:join(root,'wrangler.jsonc'),envFiles:[],remoteBindings:false,persist:{path:join(root,'.wrangler/state/v3')}});
 try{return await visit(proxy.env)}finally{await proxy.dispose()}
}
export async function archiveSnapshot(root){return archiveStorage(root,async({DB,FILES})=>{
 const config=policy(archivePolicy),inventory=await catalogue(DB,config),rows={};
 // Use the package's excludedTables policy, including all migration ledgers.
 // Bound each read batch while retaining every table and row in the oracle.
 for(let offset=0;offset<inventory.tables.length;offset+=50){
  const tables=inventory.tables.slice(offset,offset+50),results=await DB.batch(tables.map(({name})=>DB.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`)));
  for(const [index,{name}] of tables.entries())rows[name]=results[index].results.map(source=>{const row=archivePolicy.exportRow?archivePolicy.exportRow(name,source):source;for(const column of config.secretColumns[name]??[])row[column]=null;return JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))}).sort();
 }
 const objects=[];let cursor;do{const page=await FILES.list({...(cursor?{cursor}:{})});for(const {key} of page.objects){const object=await FILES.get(key);objects.push({key,bytes:Array.from(new Uint8Array(await object.arrayBuffer())),httpMetadata:object.httpMetadata,customMetadata:object.customMetadata})}cursor=page.truncated?page.cursor:undefined}while(cursor);
 return {rows,objects:objects.sort((a,b)=>a.key.localeCompare(b.key)),excludedTables:inventory.excludedTables};
})}
export async function retainHistoricalLedger(root){return archiveStorage(root,async({DB})=>{
 const config=parseJsonc(await readFile(join(root,'wrangler.jsonc'),'utf8')),directory=config.d1_databases.find(x=>x.binding==='DB').migrations_dir;
 const rows=(await DB.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all()).results;
 await DB.prepare("CREATE TABLE _rer_deploy_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('applying','applied')))").run();
 for(const row of rows){const sql=await readFile(join(root,directory,row.name));await DB.prepare("INSERT INTO _rer_deploy_migrations VALUES (?,?,'applied')").bind(row.name,createHash('sha256').update(sql).digest('hex')).run()}
 return rows;
})}
export async function assertHistoricalLedger(root,expected){return archiveStorage(root,async({DB})=>{
 assert.deepEqual((await DB.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all()).results,expected);
 assert.equal((await DB.prepare('SELECT count(*) n FROM _rer_deploy_migrations').first()).n,expected.length);
})}
export function compareArchive(before,after,added=[]){
 for(const name of added){assert.deepEqual(after.rows[name],[]);delete after.rows[name]}
 for(const name of new Set([...Object.keys(before.rows),...Object.keys(after.rows)]))if(JSON.stringify(before.rows[name])!==JSON.stringify(after.rows[name]))console.log(JSON.stringify({proof:'archive-difference',table:name,beforeRows:before.rows[name]?.length??0,afterRows:after.rows[name]?.length??0}));
 assert.deepEqual(after.rows,before.rows,'all portable D1 rows including import custody and erasure fences survive');
 assert.deepEqual(after.objects,before.objects,'all R2 bytes and metadata survive');
}

// Native session admission advances authority once; every business row remains unchanged.
export function compareDevEntryArchive(before,after){
 const expected=structuredClone(before);
 const previous=before.rows.integration_authority_epoch.map(JSON.parse),next=after.rows.integration_authority_epoch.map(JSON.parse);
 assert.deepEqual(next,previous.map(row=>({...row,revision:row.revision+1})));
 expected.rows.integration_authority_epoch=after.rows.integration_authority_epoch;
 compareArchive(expected,after);
}
