import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {getPlatformProxy,unstable_splitSqlQuery} from 'wrangler';
import {cloudflare} from '@runeditrun/rer/modules/deploy-kit/provider';
import {migrate} from '@runeditrun/rer/internal/modules/deploy-kit/migrations.mjs';
import {createPortability} from '@runeditrun/rer/modules/portability';
import {importArchive,fileRecords} from '@runeditrun/rer/modules/portability/files';
import {migrationReplay} from '@runeditrun/rer/modules/portability/migration-history';
import {appliedMigrations} from '@runeditrun/rer/internal/cli/portability-migrations.mjs';
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs';
import {run} from '../rer-command.mjs';

// Opt-in qualification against owned, disposable staging resources. The source
// has no deployed Worker, queue or cron; no production installation is selected.
export async function hostedExportLive(root,scratch,input='exports/support.rer'){
 const token=process.env.CLOUDFLARE_API_TOKEN,accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
 assert.ok(token&&accountId,'live hosted export requires the held staging credential');
 const api=cloudflare({accountId,token,budgetMigrations:true}),name='h2h-portability-'+randomUUID().slice(0,12),bucket=name+'-files';
 let database,bucketCreated=false,ownsObjects=false,proxy;
 const output='exports/hosted-live.rer',config=join(scratch,'live-hosted-target.json');
 try{
  database=await api.request('/d1/database',{method:'POST',body:{name}});
  await api.request('/r2/buckets',{method:'POST',body:{name:bucket}});bucketCreated=true;
  const directory=join(root,'.generated/migrations'),migrations=[];
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
   const sql=await readFile(join(directory,name),'utf8');migrations.push({name,sql,sha256:createHash('sha256').update(sql).digest('hex')});
  }
  await migrate(api,database.uuid,migrations);
  await writeFile(config,JSON.stringify({name,account_id:accountId,compatibility_date:'2026-09-08',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_id:database.uuid,database_name:name,migrations_dir:directory,remote:true}],r2_buckets:[{binding:'FILES',bucket_name:bucket,remote:true}]}),{mode:0o600});
  proxy=await getPlatformProxy({configPath:config,envFiles:[],persist:false,remoteBindings:true});
  const {DB,FILES}=proxy.env;
  const service=await createPortability({db:DB,buckets:{FILES},policy:archivePolicy,migrations:async()=>migrationReplay(await appliedMigrations(root,DB,'DB',{},unstable_splitSqlQuery),archivePolicy,{})});
  ownsObjects=true;await importArchive(service,join(root,input),[]);
  await proxy.dispose();proxy=undefined;
  await run(root,['export','--target','remote','--output',output],0,{env:{H2H_EXPORT_CONFIG:config,H2H_EXPORT_WRITERS_STOPPED:'yes',CLOUDFLARE_API_TOKEN:token}});
  const closing=async path=>{let found;for await(const record of fileRecords(path))if(record.kind==='closing')found=record;assert.ok(found);return found};
  assert.equal((await closing(join(root,output))).contentHash,(await closing(join(root,input))).contentHash,'real hosted D1 rows and R2 bytes match the complete native source archive');
  assert.equal((await stat(join(root,output))).mode&0o777,0o600);
  console.log('Live hosted portability passed: public rer export, full native archive equality and private custody; disposable source is removed before restore.');
  return output;
 }finally{
  try{
   if(ownsObjects){
    proxy??=await getPlatformProxy({configPath:config,envFiles:[],persist:false,remoteBindings:true});
    let cursor;do{const page=await proxy.env.FILES.list({cursor});if(page.objects.length)await proxy.env.FILES.delete(page.objects.map(row=>row.key));cursor=page.truncated?page.cursor:undefined}while(cursor);
   }
  }finally{
   await proxy?.dispose();
   try{if(bucketCreated)await api.request('/r2/buckets/'+bucket,{method:'DELETE'})}
   finally{if(database)await api.request('/d1/database/'+database.uuid,{method:'DELETE'})}
  }
 }
}
