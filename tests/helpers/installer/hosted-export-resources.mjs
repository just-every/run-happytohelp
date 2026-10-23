import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {cloudflare} from '@runeditrun/rer/modules/deploy-kit/provider';
import {migrate} from '@runeditrun/rer/internal/modules/deploy-kit/migrations.mjs';

export function hostedSourceApi(source){
 assert.match(source.name,/^h2h-portability-[a-f0-9-]{12}$/);assert.equal(source.bucket,source.name+'-files');
 assert.equal(source.accountId,process.env.CLOUDFLARE_ACCOUNT_ID);
 return cloudflare({accountId:source.accountId,token:process.env.CLOUDFLARE_API_TOKEN,budgetMigrations:true});
}
export async function removeHostedSource(source){
 const api=hostedSourceApi(source);
 try{if(source.bucketCreated)await api.request('/r2/buckets/'+source.bucket,{method:'DELETE'})}
 finally{if(source.databaseId)await api.request('/d1/database/'+source.databaseId,{method:'DELETE'})}
}
/** Provider HTTP only; no app, workerd or browser process is started here. */
export async function prepareHostedSource(root,scratch){
 const name='h2h-portability-'+randomUUID().slice(0,12),source={name,bucket:name+'-files',accountId:process.env.CLOUDFLARE_ACCOUNT_ID,config:join(scratch,'live-hosted-target.json')},api=hostedSourceApi(source);
 try{
  console.log('Hosted portability: creating disposable staging storage.');
  source.databaseId=(await api.request('/d1/database',{method:'POST',body:{name}})).uuid;
  await api.request('/r2/buckets',{method:'POST',body:{name:source.bucket}});source.bucketCreated=true;
  const directory=join(root,'.generated/migrations'),migrations=[];
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
   const sql=await readFile(join(directory,name),'utf8');migrations.push({name,sql,sha256:createHash('sha256').update(sql).digest('hex')});
  }
  console.log('Hosted portability: applying the native migration ledger.');await migrate(api,source.databaseId,migrations);
  await writeFile(source.config,JSON.stringify({name,account_id:source.accountId,compatibility_date:'2026-09-08',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_id:source.databaseId,database_name:name,migrations_dir:directory,remote:true}],r2_buckets:[{binding:'FILES',bucket_name:source.bucket,remote:true}]}),{mode:0o600});
  return source;
 }catch(error){await removeHostedSource(source);throw error}
}
