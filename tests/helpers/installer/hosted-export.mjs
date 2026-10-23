import assert from 'node:assert/strict';
import {readFile,writeFile,stat,access} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseJsonc} from '@runeditrun/rer/jsonc';
import {fileRecords} from '@runeditrun/rer/modules/portability/files';
import {run} from '../rer-command.mjs';

/** The public rer command and seed hook run unchanged. Only Wrangler's remote
 * binding boundary is redirected to the stopped disposable source installation. */
export async function hostedExportJourney(root,scratch){
 const config=join(scratch,'hosted-target.json'),shim=join(scratch,'remote-bindings.mjs'),loader=join(scratch,'remote-loader.mjs');
 await writeFile(config,JSON.stringify({account_id:'synthetic-happytohelp-1',d1_databases:[{binding:'DB',database_id:'synthetic-happytohelp-2',database_name:'synthetic-happytohelp-2'}],r2_buckets:[{binding:'FILES',bucket_name:'synthetic-happytohelp-3'}]}),{mode:0o600});
 const wrangler=pathToFileURL(join(root,'node_modules/wrangler/wrangler-dist/cli.js')).href;
 await writeFile(shim,`import {getPlatformProxy as real,unstable_splitSqlQuery} from ${JSON.stringify(wrangler)};
 import {readFile,writeFile} from 'node:fs/promises';
 import {parseJsonc} from ${JSON.stringify(pathToFileURL(join(root,'node_modules/@runeditrun/rer/cli/jsonc.mjs')).href)};
 export {unstable_splitSqlQuery};
 export async function getPlatformProxy(options){
  const selected=JSON.parse(await readFile(options.configPath,'utf8'));
  if(!options.remoteBindings||selected.d1_databases[0].remote!==true||selected.r2_buckets[0].remote!==true)throw Error('Remote binding selection missing');
  const source=parseJsonc(await readFile(${JSON.stringify(join(root,'wrangler.jsonc'))},'utf8'));
  const path=${JSON.stringify(join(scratch,'stopped-source.json'))};
  await writeFile(path,JSON.stringify({name:source.name,compatibility_date:source.compatibility_date,compatibility_flags:source.compatibility_flags,d1_databases:source.d1_databases,r2_buckets:source.r2_buckets}),{mode:0o600});
  const proxy=await real({configPath:path,envFiles:[],persist:{path:${JSON.stringify(join(root,'.wrangler/state/v3'))}},remoteBindings:false});
  const mode=process.env.H2H_HOSTED_EDGE_CHANGE,db=proxy.env.DB,bucket=proxy.env.FILES;let inventories=0;
  // These changes represent a remote writer or erasure racing the transfer.
  // Keep the disposable source intact while exercising the real publication guard.
  if(mode==='objects')proxy.env.FILES={get:(...args)=>bucket.get(...args),list:async options=>{
   const page=await bucket.list(options);inventories++;
   return inventories>1?{...page,objects:[...page.objects,{key:'synthetic-happytohelp-5',size:1,etag:'changed'}]}:page;
  }};
  if(mode==='erasure')proxy.env.DB={prepare:sql=>{
   const statement=db.prepare(sql);
   return sql==='SELECT source_identity,epoch FROM rer_portability_state WHERE id=1'?{first:async()=>{const row=await statement.first();return {...row,epoch:row.epoch+1}}}:statement;
  },batch:statements=>db.batch(statements),exec:sql=>db.exec(sql)};
  return proxy;
 }
 `,{mode:0o600});
 await writeFile(loader,`import {registerHooks} from 'node:module';
 const hook=${JSON.stringify(pathToFileURL(join(root,'scripts/installer/hosted-export.mjs')).href)};
 registerHooks({resolve(specifier,context,next){return specifier==='wrangler'&&context.parentURL===hook?{url:${JSON.stringify(pathToFileURL(shim).href)},shortCircuit:true}:next(specifier,context)}});
 `,{mode:0o600});
 const env={H2H_EXPORT_CONFIG:config,H2H_EXPORT_WRITERS_STOPPED:'yes',CLOUDFLARE_API_TOKEN:'synthetic-happytohelp-4',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${pathToFileURL(loader).href}`].filter(Boolean).join(' ')};
 await run(root,['export','--target','remote','--output','exports/unacknowledged.rer'],1,{env:{...env,H2H_EXPORT_WRITERS_STOPPED:''}});
 await assert.rejects(access(join(root,'exports/unacknowledged.rer')));
 await run(root,['export','--target','remote','--output','exports/hosted.rer'],0,{env});
 assert.equal((await stat(join(root,'exports/hosted.rer'))).mode&0o777,0o600);
 const closing=async name=>{let found;for await(const item of fileRecords(join(root,'exports',name)))if(item.kind==='closing')found=item;assert.ok(found);return found};
 assert.equal((await closing('hosted.rer')).contentHash,(await closing('support.rer')).contentHash,'remote boundary exports every portable row and exact object byte of the stopped source');
 await run(root,['export','--target','remote','--output','exports/hosted.rer'],1,{env});
 for(const mode of ['objects','erasure']){
  const name='exports/changed-'+mode+'.rer';
  await run(root,['export','--target','remote','--output',name],1,{env:{...env,H2H_HOSTED_EDGE_CHANGE:mode}});
  await assert.rejects(access(join(root,name)),'a changing hosted source publishes no archive');
 }
 console.log('Hosted export through rer: stopped-writer, changing-object, changing-erasure and overwrite refusals, complete archive equality and private custody passed at a local remote-binding edge; no hosted provider receipt claimed.');
}
