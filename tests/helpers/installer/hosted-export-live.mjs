import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {getPlatformProxy,unstable_splitSqlQuery} from 'wrangler';
import {prepareHostedSource,removeHostedSource,hostedSourceApi} from './hosted-export-resources.mjs';
import {hostedSourceD1} from './hosted-source-d1.mjs';
import {createPortability} from '@runeditrun/rer/modules/portability';
import {importArchive,fileRecords} from '@runeditrun/rer/modules/portability/files';
import {migrationReplay} from '@runeditrun/rer/modules/portability/migration-history';
import {appliedMigrations} from '@runeditrun/rer/internal/cli/portability-migrations.mjs';
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs';
import {run} from '../rer-command.mjs';

// Opt-in qualification against owned, disposable staging resources. The source
// has no deployed Worker, queue or cron; no production installation is selected.
export async function hostedExportLive(root,scratch,input='exports/support.rer',prepared){
 const token=process.env.CLOUDFLARE_API_TOKEN,accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
 assert.ok(token&&accountId,'live hosted export requires the held staging credential');
 const source=prepared??await prepareHostedSource(root,scratch),config=source.config;hostedSourceApi(source);
 let ownsObjects=false,proxy;
 const output='exports/hosted-live.rer';
 try{
  proxy=await getPlatformProxy({configPath:config,envFiles:[],persist:false,remoteBindings:true});
  const DB=hostedSourceD1(source),FILES=proxy.env.FILES;
  const service=await createPortability({db:DB,buckets:{FILES},policy:archivePolicy,migrations:async()=>migrationReplay(await appliedMigrations(root,DB,'DB',{},unstable_splitSqlQuery),archivePolicy,{})});
  console.log('Hosted portability: copying the populated native archive into staging storage.');ownsObjects=true;await importArchive(service,join(root,input),[],undefined,progress=>{
   if(progress.phase==='staging'&&progress.parts%25===0)console.log(`Hosted portability: ${progress.parts}/${progress.total} parts staged.`);
  });
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
   try{await proxy?.dispose()}finally{await removeHostedSource(source)}
  }
 }
}
