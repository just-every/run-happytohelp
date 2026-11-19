import {link,mkdir,open,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {privateDirectory,running} from './scratch.mjs';

/** A PID marker preserves compatibility with older importers. SQLite's
 * process-owned lock serializes stale-marker recovery between current importers. */
async function localLock(directory){
  const marker=path.join(directory,'.legacy-import.lock'),mutex=path.join(directory,'.legacy-import-mutex.sqlite');
  const busy=()=>Error('Another legacy import holds the local persistence lock; finish it before applying again');
  await (await open(mutex,'a',0o600)).close();
  const gate=new DatabaseSync(mutex,{timeout:0});
  try{
    try{gate.exec('BEGIN IMMEDIATE');}catch(error){if(error.errcode===5)throw busy();throw error;}
    const prior=await readFile(marker,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(prior!==null){
      const recordedPid=prior.trim(),pid=Number(recordedPid);
      if(!/^[1-9]\d*$/.test(recordedPid)||!Number.isSafeInteger(pid)||pid>0x7fffffff||running(pid))throw busy();
      await unlink(marker);
    }
    const pending=marker+'.'+randomUUID();
    await writeFile(pending,String(process.pid),{mode:0o600,flag:'wx'});
    try{await link(pending,marker);}catch(error){if(error.code==='EEXIST')throw busy();throw error;}
    finally{await unlink(pending);}
  }catch(error){gate.close();throw error;}
  return async()=>{try{await unlink(marker);}finally{gate.close();}};
}

/** A local Wrangler/rer persistence directory. Parallel applies to the same
 * directory are refused before any write. */
export async function localTarget(directory){
  await mkdir(directory,{recursive:true});
  const unlock=await localLock(path.resolve(directory));
  try{
    // Local D1/R2 do not need request geography. Use Miniflare's built-in data
    // even on a fresh machine without a Cloudflare metadata cache.
    process.env.CLOUDFLARE_CF_FETCH_ENABLED='false';
    const {getPlatformProxy}=await import('wrangler');
    const proxy=await getPlatformProxy({remoteBindings:false,persist:{path:path.join(directory,'v3')}});
    return {env:proxy.env,label:'local '+directory,async close(){try{await proxy.dispose();}finally{await unlock();}}};
  }catch(error){await unlock();throw error;}
}

// Wrangler's remote bindings (4.129) open local connections for every binding call
// and keep about one of them open until the session ends, while the rest close
// into TIME_WAIT. A long import therefore paces its calls and renews its session
// between waves of work, so it never runs the machine out of ephemeral ports.
const callsPerSession=500,callsPerSecond=25;

/** A deployed installation's own D1 database and R2 bucket, reached through
 * Wrangler remote bindings with the operator's Cloudflare API token. Only the
 * DB and FILES bindings exist: no queue, mail, AI or other binding is created,
 * and the installation's Worker is never invoked. */
export async function remoteTarget({database,bucket}){
  const api=cloudflareApi();
  if(!database||!bucket)throw Error('A remote import names the installation\'s D1 database (--database) and R2 bucket (--bucket)');
  const d1=await d1Database(api,database);
  const found=await api.get(`r2/buckets/${encodeURIComponent(bucket)}`);if(found.name!==bucket)throw Error(`R2 bucket ${bucket} was not found in this account`);
  const directory=await privateDirectory('remote'),configPath=path.join(directory,'wrangler.json');
  await writeFile(configPath,JSON.stringify({name:'happytohelp-legacy-import',compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',database_name:database,database_id:d1.uuid,remote:true}],r2_buckets:[{binding:'FILES',bucket_name:bucket,remote:true}]}),{mode:0o600});
  const {getPlatformProxy}=await import('wrangler');
  let proxy,env,calls=0,sessions=0;const pace=pacer(callsPerSecond);
  const connect=async()=>{proxy=await getPlatformProxy({configPath,remoteBindings:true,persist:false});env=paced(proxy.env,n=>{calls+=n;return pace(n);});calls=0;sessions++;};
  try{await connect();}catch(error){await rm(directory,{recursive:true,force:true});throw error;}
  return {
    get env(){return env;},label:`remote ${database} + ${bucket}`,database:d1.uuid,
    get sessions(){return sessions;},
    async renew(){if(calls<callsPerSession)return;await proxy.dispose();await connect();},
    async close(){await proxy.dispose();await rm(directory,{recursive:true,force:true});},
  };
}
/** Read-only Cloudflare REST calls with the operator's deploy credentials. */
export function cloudflareApi(){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!account||!token)throw Error('A remote import needs the installation\'s deploy credentials: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  const call=async(url,init)=>{const response=await fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,...init?.headers}});const body=await response.json().catch(()=>({}));if(!response.ok||body.success===false||body.errors?.length)throw Error(`Cloudflare API ${new URL(url).pathname.split('/').slice(-2).join('/')} returned ${response.status}`);return body;};
  return {account,get:async route=>(await call(`https://api.cloudflare.com/client/v4/accounts/${account}/${route}`)).result,
    graphql:async(query,variables)=>(await call('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{account,...variables}})})).data};
}
/** The account's D1 database of that exact name. */
export async function d1Database(api,name){
  const matches=(await api.get(`d1/database?name=${encodeURIComponent(name)}&per_page=100`)).filter(row=>row.name===name);
  if(matches.length!==1)throw Error(`D1 database ${name} was not found in this account`);
  return matches[0];
}
/** Wait so that calls average no more than `rate` per second, in arrival order. */
function pacer(rate){let next=0;return n=>{const now=Date.now(),start=Math.max(now,next);next=start+n*1000/rate;return start>now?new Promise(resolve=>setTimeout(resolve,start-now)):undefined;};}
// Synchronous calls (prepare, bind) are counted and paid for at the next asynchronous
// call. Wrapped statements are unwrapped before they reach batch().
function paced(env,spend){
  let owed=0;const real=new WeakMap(),pay=async n=>{const due=n+owed;owed=0;await spend(due);};
  const statement=inner=>{const outer=new Proxy(inner,{get(object,key){const value=object[key];if(typeof value!=='function')return value;
    if(key==='bind')return (...args)=>{owed++;return statement(value.apply(object,args));};
    if(['first','all','run','raw'].includes(key))return async(...args)=>{await pay(1);return value.apply(object,args);};
    return value.bind(object);}});real.set(outer,inner);return outer;};
  const DB=new Proxy(env.DB,{get(object,key){const value=object[key];if(typeof value!=='function')return value;
    if(key==='prepare')return sql=>{owed++;return statement(value.call(object,sql));};
    if(key==='batch')return async statements=>{await pay(1);return value.call(object,statements.map(s=>real.get(s)??s));};
    return value.bind(object);}});
  const FILES=new Proxy(env.FILES,{get(object,key){const value=object[key];if(typeof value!=='function')return value;
    if(['head','get','put','delete','createMultipartUpload'].includes(key))return async(...args)=>{await pay(1);return value.apply(object,args);};
    return value.bind(object);}});
  return {DB,FILES};
}
