import {createRequire} from 'node:module'
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes,createHash} from 'node:crypto'
import {build} from 'esbuild'

// The real application router (src/app) in workerd over real D1, R2, Durable
// Objects and a queue, with every migration applied. Network is the only fake:
// `outbound` answers the application's provider requests, which are recorded.
const require=createRequire(import.meta.url)
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}))
const root=resolve(new URL('../../..',import.meta.url).pathname)
const bundles=new Map()
const bundle=(entry='tests/journeys/kit/app-worker.ts')=>bundles.get(entry)??bundles.set(entry,build({entryPoints:[join(root,entry)],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['node:*','cloudflare:*'],loader:{'.sql':'text'},logLevel:'silent'}).then(result=>result.outputFiles[0].text)).get(entry)
let migrationSql
const migrations=()=>migrationSql??=(async()=>{const files=(await readdir(join(root,'migrations'))).filter(name=>name.endsWith('.sql')).sort();return Promise.all(files.map(async name=>{const source=(await readFile(join(root,'migrations',name),'utf8')).replace(/^\s*--[^\n]*$/gm,'');return {name,statements:[...source.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(match=>match[1]).filter(sql=>sql.trim()!==';')}}))})()
export const sha=value=>createHash('sha256').update(value).digest('hex')
// Every migration whose file name `select` accepts, in one atomic batch (a single D1 round trip).
export const applyMigrations=async(db,select=()=>true)=>db.batch((await migrations()).filter(migration=>select(migration.name)).flatMap(migration=>migration.statements).map(sql=>db.prepare(sql)))

export async function startApp({bindings={},outbound,origin='https://app.example',captureQueue=false,migrate=true,listen=false,entry,cf}={}){
 const directory=await mkdtemp(join(tmpdir(),'h2h-app-')),script=await bundle(entry),requests=[]
 let current={...bindings},mf,db,url,port=0
 const outboundService=async request=>{const body=request.method==='GET'||request.method==='HEAD'?'':await request.clone().text();const entry={url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body};requests.push(entry);if(!outbound)throw new Error('External calls prohibited: '+request.url);return outbound(request,entry)}
 const start=async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({name:'h2h-app',...(cf?{cf}:{}),...(listen?{host:'127.0.0.1',port}:{}),modules:true,script,unsafeTriggerHandlers:true,compatibilityDate:'2026-09-14',compatibilityFlags:['nodejs_compat'],bindings:{...(captureQueue?{H2H_TEST_CAPTURE_QUEUE:'1'}:{}),...Object.fromEntries(Object.entries(current).filter(([,value])=>value!==undefined))},d1Databases:{DB:'h2h-app'},r2Buckets:['FILES'],durableObjects:{CONVERSATIONS:'ConversationSocket'},queueProducers:{JOBS:'h2h-app-jobs'},queueConsumers:{'h2h-app-jobs':{maxBatchSize:1,maxRetries:0}},resourcePersistencePath:join(directory,'state'),resourceTmpPath:join(directory,'tmp'),outboundService}))
  console.info('app boot: before binding');db=await mf.getD1Database('DB');console.info('app boot: bound')
  if(listen){url=String(await mf.ready).replace(/\/$/,'');port=Number(new URL(url).port)}
 }
 console.info('app boot: starting');await start();console.info('app boot: started')
 // `migrate` may name the migrations to apply, so a test can stage prior state between them.
 try{console.info('app boot: migrating');if(migrate)await applyMigrations(db,typeof migrate==='function'?migrate:undefined);console.info('app boot: migrated')}catch(error){console.error('app boot migration failure',error.message);await mf.dispose();await rm(directory,{recursive:true,force:true});throw error}
 // A CF-IPCountry header is mirrored into request.cf, as Cloudflare's edge sets both.
 const request=(path,{body,token,method=body===undefined?'GET':'POST',headers={},raw=false,base=origin}={})=>mf.dispatchFetch(base+path,{method,redirect:'manual',...(headers['CF-IPCountry']?{cf:{country:headers['CF-IPCountry']}}:{}),headers:{...(body!==undefined&&!raw?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)})
 const call=async(path,options={})=>{const response=await request(path,options),text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}if(options.status!==undefined&&response.status!==options.status)throw new Error(`${options.method||(options.body===undefined?'GET':'POST')} ${path}: expected ${options.status}, got ${response.status}: ${text.slice(0,500)}`);return {status:response.status,headers:response.headers,data}}
 const sql=async(statement,...args)=>(await db.prepare(statement).bind(...args).all()).results
 const first=async(statement,...args)=>(await db.prepare(statement).bind(...args).first())
 // A workspace with an owner, admin and operator, each holding a live session token signed in just now.
 const seedWorkspace=async(key,{name='Workspace '+key,allowedOrigin=`https://${key}.example`,roles=['owner','admin','operator']}={})=>{
  const projectId='p-'+key,now=Date.now(),tokens={},users={}
  await db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at,verification_secret) VALUES(?,?,?,?,?,?)').bind(projectId,name,'widget-'+key,allowedOrigin,now,randomBytes(32).toString('hex')).run()
  for(const role of roles){const userId=`${role}-${key}`;users[role]=userId;tokens[role]=`${role}-token-${key}`;await db.batch([db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').bind(userId,`${role}-${key}@example.test`,`${role} ${key}`,now),db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(projectId,userId,role),db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(sha(tokens[role]),userId,projectId,role,now+3600000),db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(sha(tokens[role]),userId,now)])}
  return {projectId,name,tokens,users,widgetKey:'widget-'+key,allowedOrigin}
 }
 return {
  origin,request,call,sql,first,seedWorkspace,requests,directory,
  // The loopback HTTP origin when started with `listen`, for clients such as the local connector CLI.
  get url(){return url},
  async ok(path,options={}){const {status,data}=await call(path,options);if(status<200||status>299)throw new Error(`${path}: ${status} ${JSON.stringify(data).slice(0,500)}`);return data},
  get db(){return db},
  get files(){return mf.getR2Bucket('FILES')},
  get bindings(){return current},
  // Restart the same stored state with changed configuration, as a redeploy would.
  async configure(changes){await mf.dispose();current={...current,...changes};await start()},
  async takeJobs(){return (await call('/_test/queue/take')).data},
  async runJobs(jobs,headers){return (await call('/_test/queue/run',{body:jobs,status:200,headers})).data},
  async drainJobs(limit=200){let ran=0;for(;;){const jobs=await this.takeJobs();if(!jobs.length)return ran;if((ran+=jobs.length)>limit)throw new Error('queue did not settle');for(const job of jobs){const result=await this.runJobs([job]);if(result.retried.length)throw new Error('job retried: '+JSON.stringify(job))}}},
  // Inbound mail through the Worker's email entry, as Email Routing delivers it.
  async email(raw,{from,to,direct=false}){if(direct){const response=await mf.dispatchFetch(`http://localhost/_test/email?${new URLSearchParams({from,to})}`,{method:'POST',body:raw});const text=await response.text();return {status:response.status,text,...(response.ok?JSON.parse(text):{})}}const response=await mf.dispatchFetch(`http://localhost/cdn-cgi/local/email?${new URLSearchParams({from,to})}`,{method:'POST',body:raw});const text=await response.text();try{return {status:response.status,...JSON.parse(text)}}catch{return {status:response.status,text}}},
  async scheduled(headers,{after=0}={}){return (await call('/_test/scheduled',{body:{after},status:200,headers})).data},
  // A lead turned presence-based away off: the schedule and switch alone decide availability, as for a team that
  // answers without the dashboard open. Presence itself: tests/helpers/widget/presence.mjs.
  async presenceAwayOff(projectId){await db.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,json_object('is_presence_away_enabled',json('false')),?) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.is_presence_away_enabled',json('false'))`).bind(projectId,Date.now()).run()},
  async until(check,{timeout=10000,interval=25,message='condition'}={}){const deadline=Date.now()+timeout;for(;;){const value=await check();if(value)return value;if(Date.now()>deadline)throw new Error('Timed out waiting for '+message);await new Promise(done=>setTimeout(done,interval))}},
  async close(){await mf.dispose();await rm(directory,{recursive:true,force:true})},
 }
}
