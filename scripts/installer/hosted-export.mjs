import {constants} from 'node:fs';
import {open,mkdtemp,writeFile,rm,link,lstat,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkArchiveSnapshot} from './durable-objects.mjs';
import {getPlatformProxy,unstable_splitSqlQuery} from 'wrangler';
import {parseJsonc} from '@runeditrun/rer/jsonc';
import {createPortability} from '@runeditrun/rer/modules/portability';
import {exportArchive,fileRecords} from '@runeditrun/rer/modules/portability/files';
import {appliedMigrations,platformMigrationPreflight} from '@runeditrun/rer/internal/cli/portability-migrations.mjs';
import {archivePolicy} from './portability-policy.mjs';
import {hostedD1} from './hosted-d1.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
class HostedExportRefusal extends Error {}
const failure=message=>new HostedExportRefusal(message);
const refuse=()=>failure('Hosted export refused. Use an owned 0600 H2H_EXPORT_CONFIG with explicit account, DB and FILES bindings; provide Cloudflare credentials privately and acknowledge stopped writers with H2H_EXPORT_WRITERS_STOPPED=yes. No archive was published.');
async function configuration(path){
 if(!path)throw refuse();
 const file=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const info=await file.stat();
  if(!info.isFile()||(info.mode&0o777)!==0o600||info.uid!==process.getuid())throw refuse();
  const config=parseJsonc(await file.readFile('utf8'));
  const db=config.d1_databases?.filter(item=>item.binding==='DB'),files=config.r2_buckets?.filter(item=>item.binding==='FILES');
  if(!config.account_id||db?.length!==1||files?.length!==1||!db[0].database_id||db[0].database_id==='local-only-requires-setup'||!files[0].bucket_name)throw refuse();
  // A private data-only selection: no application vars, queues, DO, assets or
  // dev settings enter the remote proxy. Resource identities are never derived.
  return {name:'happytohelp-native-export',account_id:config.account_id,compatibility_date:'2026-09-08',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:db[0].database_name,database_id:db[0].database_id,remote:true}],r2_buckets:[{binding:'FILES',bucket_name:files[0].bucket_name,remote:true}]};
 }finally{await file.close()}
}
async function inventory(bucket){
 const rows=[];let cursor;
 do{
  const page=await bucket.list({cursor,include:['httpMetadata','customMetadata']});
  rows.push(...page.objects.map(({key,size,etag,httpMetadata={},customMetadata={}})=>({key,size,etag,httpMetadata,customMetadata})));
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 return rows.sort((a,b)=>a.key.localeCompare(b.key));
}
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value}

/** Only Base transfer bookkeeping is written on the source: snapshot copies,
 * transfer parts and erasure epochs. No product rows, queues or R2 objects are
 * changed. Stop app, queue and cron writers before invoking this command. */
export async function hostedExport({output,configPath,stopped,origin}){
 if(stopped!=='yes'||!process.env.CLOUDFLARE_API_TOKEN||!output)throw refuse();
 if(origin&&new URL(origin).hostname==='app.happytohelp.com')throw refuse();
 const config=await configuration(configPath),destination=resolve(output);
 if(await lstat(destination).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error}))throw failure('Hosted export output already exists; choose a new private archive path.');
 await mkdir(dirname(destination),{recursive:true,mode:0o700});
 const temporary=await mkdtemp(join(dirname(destination),'.h2h-hosted-export-'));let proxy;
 try{
  const path=join(temporary,'bindings.json');await writeFile(path,JSON.stringify(config),{mode:0o600});
  proxy=await getPlatformProxy({configPath:path,envFiles:[],persist:false,remoteBindings:true});
  const DB=hostedD1({accountId:config.account_id,databaseId:config.d1_databases[0].database_id,token:process.env.CLOUDFLARE_API_TOKEN}),FILES=proxy.env.FILES;
  await promisify(execFile)(process.execPath,['scripts/migrations.mjs'],{cwd:root});
  await platformMigrationPreflight(root,DB,'DB',{},unstable_splitSqlQuery);
  const migrations=await appliedMigrations(root,DB,'DB',{},unstable_splitSqlQuery);
  // The source must carry a real, recognized migration ledger; never prepare a
  // remote installation or fabricate a ledger while exporting its prior data.
  if(!migrations.length)throw failure('Hosted source migration ledger is missing.');
  const before=await inventory(FILES);
  const service=await createPortability({db:DB,buckets:{FILES:{list:options=>FILES.list(options),get:(key,options)=>FILES.get(key,options)}},policy:archivePolicy});
  const staged=join(temporary,'support.rer');
  const receipt=await exportArchive(service,staged,['live websocket connections and alarms (business transcript and presence are in D1)','active sessions, provider secrets and connector execution authority']);
  await checkArchiveSnapshot(staged);
  const after=await inventory(FILES);
  if(JSON.stringify(canonical(before))!==JSON.stringify(canonical(after)))throw failure('Hosted attachment inventory changed; keep writers stopped and export again.');
  let manifest;for await(const record of fileRecords(staged))if(record.kind==='manifest')manifest=record;
  const fence=await DB.prepare('SELECT source_identity,epoch FROM rer_portability_state WHERE id=1').first();
  if(!manifest||fence?.source_identity!==manifest.sourceIdentity||fence.epoch!==manifest.epoch)throw failure('Hosted erasure fence changed; export again before restoring.');
  await mkdir(dirname(destination),{recursive:true,mode:0o700});await link(staged,destination);
  return {...receipt,target:'remote',durableObjects:{CONVERSATIONS:'lossless D1 reconstruction; transient sockets and alarms excluded'}};
 }finally{await proxy?.dispose();await rm(temporary,{recursive:true,force:true})}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {values}=parseArgs({options:{remote:{type:'boolean'},environment:{type:'string'},out:{type:'string'},origin:{type:'string'}}});
  if(!values.remote||values.environment!=='production')throw refuse();
  const receipt=await hostedExport({output:values.out,origin:values.origin,configPath:process.env.H2H_EXPORT_CONFIG,stopped:process.env.H2H_EXPORT_WRITERS_STOPPED});
  console.log(`Hosted archive complete: ${receipt.tables.length} tables, ${receipt.objects} objects; integrity verified. Sessions, secrets and live connector authority excluded.`);
 }catch(error){
  // Provider diagnostics, configuration and signed transport URLs are private.
  console.error(error instanceof HostedExportRefusal?error.message:'Hosted export failed; no archive was published. Check source configuration, migration history and stopped writers.');
  process.exitCode=1;
 }
}
