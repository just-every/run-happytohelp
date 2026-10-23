import assert from 'node:assert/strict';
import {readFile,writeFile,stat,access,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseJsonc} from '@runeditrun/rer/jsonc';
import {fileRecords} from '@runeditrun/rer/modules/portability/files';
import {run} from '../rer-command.mjs';

/** The public command and seed hook run unchanged; only the D1 API and R2
 * network boundaries point at the stopped disposable native installation. */
export async function hostedExportJourney(root,scratch){
 const config=join(scratch,'hosted-target.json'),shim=join(scratch,'remote-bindings.mjs'),loader=join(scratch,'remote-loader.mjs'),r2=join(scratch,'remote-r2.mjs');
 await writeFile(config,JSON.stringify({account_id:'11111111111111111111111111111111',d1_databases:[{binding:'DB',database_id:'00000000-0000-4000-8000-000000000002',database_name:'synthetic-happytohelp-2'}],r2_buckets:[{binding:'FILES',bucket_name:'synthetic-happytohelp-3'}]}),{mode:0o600});
 const wrangler=pathToFileURL(join(root,'node_modules/wrangler/wrangler-dist/cli.js')).href;
 await writeFile(shim,`import {getPlatformProxy as real,unstable_splitSqlQuery} from ${JSON.stringify(wrangler)};
 import {readFile,writeFile} from 'node:fs/promises';
 import {parseJsonc} from ${JSON.stringify(pathToFileURL(join(root,'node_modules/@runeditrun/rer/cli/jsonc.mjs')).href)};
 let sourceProxy;const actualFetch=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  const url=new URL(typeof input==='string'?input:input.url);
  if(url.protocol==='http:'&&url.hostname==='127.0.0.1')return actualFetch(input,options);
  if(url.href!=='https://api.cloudflare.com/client/v4/accounts/11111111111111111111111111111111/d1/database/00000000-0000-4000-8000-000000000002/query'||options.method!=='POST'||options.headers.Authorization!=='Bearer synthetic-happytohelp-4'||!sourceProxy)throw Error('Unexpected hosted D1 network request');
  const body=JSON.parse(options.body),result=await sourceProxy.env.DB.batch(body.batch.map(({sql,params})=>sourceProxy.env.DB.prepare(sql).bind(...params.map(value=>Array.isArray(value)?Uint8Array.from(value).buffer:value))));
  return new Response(JSON.stringify({success:true,result},(_,value)=>value instanceof ArrayBuffer?Array.from(new Uint8Array(value)):ArrayBuffer.isView(value)?Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)):value),{headers:{'Content-Type':'application/json'}});
 };
 export {unstable_splitSqlQuery};
 export async function stoppedSource(){
  if(sourceProxy)return sourceProxy;
  const source=parseJsonc(await readFile(${JSON.stringify(join(root,'wrangler.jsonc'))},'utf8'));
  const path=${JSON.stringify(join(scratch,'stopped-source.json'))};
  await writeFile(path,JSON.stringify({name:source.name,compatibility_date:source.compatibility_date,compatibility_flags:source.compatibility_flags,d1_databases:source.d1_databases,r2_buckets:source.r2_buckets}),{mode:0o600});
  sourceProxy=await real({configPath:path,envFiles:[],persist:{path:${JSON.stringify(join(root,'.wrangler/state/v3'))}},remoteBindings:false});return sourceProxy;
 }
 `,{mode:0o600});
 await writeFile(r2,`import {stoppedSource} from ${JSON.stringify(pathToFileURL(shim).href)};
 export async function hostedR2(){const proxy=await stoppedSource();return {list:options=>proxy.env.FILES.list(options),get:(key,options)=>proxy.env.FILES.get(key,options),dispose:()=>proxy.dispose()}};
 `,{mode:0o600});
 await writeFile(loader,`import {registerHooks} from 'node:module';
 const hook=${JSON.stringify(pathToFileURL(await realpath(join(root,'scripts/installer/hosted-export.mjs'))).href)};
 registerHooks({resolve(specifier,context,next){if(context.parentURL===hook){if(specifier==='wrangler')return {url:${JSON.stringify(pathToFileURL(shim).href)},shortCircuit:true};if(specifier==='./hosted-r2.mjs')return {url:${JSON.stringify(pathToFileURL(r2).href)},shortCircuit:true}}return next(specifier,context)}});
 `,{mode:0o600});
 const env={H2H_EXPORT_CONFIG:config,H2H_EXPORT_WRITERS_STOPPED:'yes',CLOUDFLARE_API_TOKEN:'synthetic-happytohelp-4',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${pathToFileURL(loader).href}`].filter(Boolean).join(' ')};
 await run(root,['export','--target','remote','--output','exports/unacknowledged.rer'],1,{env:{...env,H2H_EXPORT_WRITERS_STOPPED:''}});
 await assert.rejects(access(join(root,'exports/unacknowledged.rer')));
 await run(root,['export','--target','remote','--output','exports/hosted.rer'],0,{env});
 assert.equal((await stat(join(root,'exports/hosted.rer'))).mode&0o777,0o600);
 const closing=async name=>{let found;for await(const item of fileRecords(join(root,'exports',name)))if(item.kind==='closing')found=item;assert.ok(found);return found};
 assert.equal((await closing('hosted.rer')).contentHash,(await closing('support.rer')).contentHash,'remote boundary exports every portable row and exact object byte of the stopped source');
 await run(root,['export','--target','remote','--output','exports/hosted.rer'],1,{env});
 console.log('Hosted export through rer: stopped-writer refusal, complete archive equality, private custody and existing-output refusal passed at a local remote-binding edge; no hosted provider receipt claimed.');
 if(process.env.H2H_LIVE_HOSTED_PORTABILITY==='yes')return (await import('./hosted-export-live.mjs')).hostedExportLive(root,scratch);
 return 'exports/hosted.rer';
}
