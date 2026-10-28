import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {snapshotDatabase} from './snapshot.mjs';
import {children,identifyWorkerd,assertOwnedWorkerd,assertWorkerdStopped} from './owned-workerd.mjs';
const require=createRequire(import.meta.url),{Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
let workerBundle
const compiledWorker=()=>workerBundle??=build({entryPoints:['tests/move-in/worker.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['node:*','cloudflare:*'],logLevel:'silent'}).then(result=>result.outputFiles[0].text)
export async function nativeHarness({withConversations=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'move-in-check-'));let mf,db,outbound=0,maxStatements=0,lastWrites=0,workerdPid;
 const queued=[],tokens={},outboundRequests=[];
 const script=await compiledWorker();
 async function start(){const before=await children();mf=new Miniflare(convertV4MiniflareOptions({name:'move-in-check',modules:true,script,compatibilityDate:'2026-09-14',compatibilityFlags:['nodejs_compat'],bindings:{EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:randomBytes(32).toString('hex'),EMAIL_FROM:'test@example.test',OPENAI_API_KEY:randomBytes(32).toString('hex')},d1Databases:{DB:'move-in-check'},r2Buckets:['FILES'],...(withConversations?{durableObjects:{CONVERSATIONS:'ConversationSocket'}}:{}),resourcePersistencePath:join(directory,'state'),resourceTmpPath:join(directory,'tmp'),outboundService:async request=>{outbound++;outboundRequests.push({hostname:new URL(request.url).hostname,method:request.method});throw new Error('External calls prohibited')}}));try{db=await mf.getD1Database('DB');workerdPid=await identifyWorkerd(before)}catch(error){await mf.dispose();throw error}}
 await start();
 const applyMigration=async file=>{const source=(await readFile(join('migrations',file),'utf8')).replace(/^\s*--[^\n]*$/gm,'');await db.batch([...source.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(([,sql])=>db.prepare(sql)))};
 try{for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql')).sort())await applyMigration(file);
 for(const [project,user,role] of [['p','owner','owner'],['p','operator','operator'],['q','foreign','owner']]){if(role==='owner')await db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,1)').bind(project,project,`widget-${project}`,'https://example.test').run();await db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,1)').bind(user,`${user}@example.test`,user).run();await db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(project,user,role).run();const token=randomBytes(32).toString('hex');tokens[user]=token;await db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),user,project,role,Date.now()+86400000).run()}
 // The teammates signed in just now, once every migration (including two-factor) is in place.
 await db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) SELECT token_hash,actor_id,'password',? FROM sessions WHERE role<>'contact'").bind(Date.now()).run()
 }catch(error){await mf.dispose();await rm(directory,{recursive:true,force:true});throw error}
 async function raw(path,{method='GET',body,actor='owner',headers={}}={}){const response=await mf.dispatchFetch('https://app.example'+path,{method,headers:{Authorization:`Bearer ${tokens[actor]}`,...headers},body}),data=await response.json();maxStatements=Math.max(maxStatements,Number(response.headers.get('X-Test-Statements')||0));lastWrites=Number(response.headers.get('X-Test-Writes')||0);queued.push(...JSON.parse(response.headers.get('X-Test-Queued')||'[]'));return {response,data}}
 async function call(path,options){const {response,data}=await raw(path,options);assert.ok(response.ok,JSON.stringify({status:response.status,data}));return data}
 async function step(jobs=queued.splice(0,1)){const result=await call('/_test/queue',{method:'POST',body:JSON.stringify(jobs),headers:{'Content-Type':'application/json'}});maxStatements=Math.max(maxStatements,result.statements);queued.push(...result.queue);return result}
 async function drain(){let i=0;while(queued.length){assert.ok(i++<4000);const result=await step();assert.deepEqual(result.effects,{widget:0});assert.deepEqual(result.retried,[])}}
 async function snapshot(){return (await snapshotDatabase(directory,db)).tables}
 async function crashDuringStep(){await assertOwnedWorkerd(workerdPid);const pending=step().catch(()=>null);await new Promise(resolve=>setTimeout(resolve,5));await assertOwnedWorkerd(workerdPid);process.kill(workerdPid,'SIGKILL');await Promise.race([pending,new Promise(resolve=>setTimeout(resolve,1000))]);await mf.dispose().catch(()=>{});await assertWorkerdStopped(workerdPid);queued.length=0;await start()}
 async function contactSession(name,project,contact){const token=randomBytes(32).toString('hex');tokens[name]=token;await db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,?,?,'contact',?,?)").bind(createHash('sha256').update(token).digest('hex'),contact,project,contact,Date.now()+3600000).run()}
 assert.deepEqual(await call('/_test/configured'),{mail:true,model:true});
 async function login(actor,password){const signedIn=await call('/api/identity/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:actor+'@example.test',password,projectId:'p'})});tokens[actor]=signedIn.token}
 async function download(path,actor='owner'){const response=await mf.dispatchFetch('https://app.example'+path,{headers:{Authorization:`Bearer ${tokens[actor]}`}});return {status:response.status,bytes:Buffer.from(await response.arrayBuffer())}}
 return {login,download,call,raw,step,drain,snapshot,crashDuringStep,contactSession,queued,get db(){return db},get files(){return mf.getR2Bucket('FILES')},get maxStatements(){return maxStatements},get lastWrites(){return lastWrites},get outbound(){return outbound},get outboundRequests(){return outboundRequests},async close(){await mf.dispose();await assertWorkerdStopped(workerdPid);await rm(directory,{recursive:true,force:true})}}
}
