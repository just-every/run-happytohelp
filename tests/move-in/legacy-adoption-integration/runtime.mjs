import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {applyMigrations} from '../../journeys/kit/app.mjs'
import {children,identifyWorkerd,assertOwnedWorkerd,assertWorkerdStopped} from '../owned-workerd.mjs'
import {isolateProfiler} from '../../helpers/legacy-worker/profiler.mjs'
const require=createRequire(import.meta.url),{Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}))
const hash=value=>createHash('sha256').update(value).digest('hex')
let compiled,starting=Promise.resolve()
/** Discover one new owned child at a time; migrations and journeys may overlap. */
async function startOwned(start){
 const prior=starting;let release
 starting=new Promise(resolve=>{release=resolve})
 await prior
 try{return await start()}finally{release()}
}
/** Same app Worker and migration kit, with an exposed inspector and owned PID. */
export async function runnerRuntime(){
 const directory=await mkdtemp(join(tmpdir(),'legacy-runner-')),outbound=[];let mf,db,pid,profiler
 const script=await (compiled??=build({entryPoints:[resolve('tests/move-in/legacy-adoption-integration/runtime-worker.ts')],bundle:true,write:false,format:'esm',platform:'node',conditions:['workerd'],target:'es2022',external:['node:*','cloudflare:*'],logLevel:'silent',banner:{js:"import {createRequire as kitRequire} from 'node:module';const require=kitRequire('/');"}}).then(result=>result.outputFiles[0].text))
 const start=()=>startOwned(async()=>{const before=await children();mf=new Miniflare(convertV4MiniflareOptions({name:'legacy-runner',cf:false,modules:true,script,inspectorPort:0,unsafeTriggerHandlers:true,compatibilityDate:'2026-09-14',compatibilityFlags:['nodejs_compat'],bindings:{H2H_TEST_CAPTURE_QUEUE:'1'},d1Databases:{DB:'legacy-runner'},r2Buckets:['FILES'],durableObjects:{CONVERSATIONS:'ConversationSocket'},queueProducers:{JOBS:'legacy-jobs'},queueConsumers:{'legacy-jobs':{maxBatchSize:1,maxRetries:0}},resourcePersistencePath:join(directory,'state'),resourceTmpPath:join(directory,'tmp'),outboundService:async request=>{outbound.push({hostname:new URL(request.url).hostname,method:request.method});throw new Error('Provider requests prohibited')}}));db=await mf.getD1Database('DB');pid=await identifyWorkerd(before);profiler=await isolateProfiler(mf)})
 await start();try{await applyMigrations(db)}catch(error){await mf.dispose();await rm(directory,{recursive:true,force:true});throw error}
 const request=(path,{token,body,raw=false,method=body===undefined?'GET':'POST',headers={}}={})=>mf.dispatchFetch('https://app.example'+path,{method,redirect:'manual',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)})
 const call=async(path,options={})=>{const response=await request(path,options);const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text};await response.waitUntil?.();if(options.status!==undefined)assert.equal(response.status,options.status,JSON.stringify({path,status:response.status,data}));return {status:response.status,data}}
 const take=async()=> (await call('/_test/queue/take')).data
 const step=async(jobs,headers)=>{const result=(await call('/_test/legacy/step',{body:jobs,headers,status:200})).data;assert.deepEqual(result.retried,[]);return result}
 const seed=async(projectId='p-legacy-runner',source)=>{
  const now=Date.now(),tokens={};await db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,?)').bind(projectId,source?.name??'Synthetic',source?.widget_key??source?.public_key??(source?projectId:'synthetic-widget'),source?new URL(source.allowed_origin||source.website||source.website_url||source.url).origin:'https://example.test',source?typeof source.created_at==='number'?source.created_at:Date.parse(source.created_at):1).run()
  for(const role of ['owner','admin','operator']){const id=`synthetic-${role}`,token=`synthetic-${role}-session`;tokens[role]=token;await db.batch([db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,1)').bind(id,`${role}@example.test`,role),db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(projectId,id,role),db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(hash(token),id,projectId,role,now+3600000),db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(hash(token),id,now)])}
  return {projectId,tokens}
 }
 const crash=async()=>{await profiler.close();await assertOwnedWorkerd(pid);process.kill(pid,'SIGKILL');await mf.dispose().catch(()=>{});await assertWorkerdStopped(pid);await start()}
 const pending=[]
 return {origin:'https://app.example',call,request,takeJobs:async()=>[...pending.splice(0),...await take()],runJobs:async(jobs,headers)=>{const r=await step(jobs,headers);pending.push(...r.queue);return r},first:(sql,...args)=>db.prepare(sql).bind(...args).first(),sql:async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results,seedWorkspace:async(key)=>{const s=await seed('p-'+key);return {...s,users:{owner:'synthetic-owner',admin:'synthetic-admin',operator:'synthetic-operator'}}},scheduled:async()=> (await call('/_test/scheduled',{body:{},status:200})).data,until:async(check,{message='condition',timeout=15000}={})=>{const end=Date.now()+timeout;for(;;){const value=await check();if(value)return value;if(Date.now()>end)throw new Error(message);await new Promise(r=>setTimeout(r,20))}},configure:crash,take,step,seed,outbound,async profile(run){return profiler.measure(run)},get db(){return db},get files(){return mf.getR2Bucket('FILES')},crash,async close(){await profiler.close();await mf.dispose();await assertWorkerdStopped(pid);await rm(directory,{recursive:true,force:true})}}
}
