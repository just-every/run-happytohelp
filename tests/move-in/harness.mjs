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
export async function nativeHarness({beforeMoveIn,afterMoveIn,beforeIdentityAudit,afterIdentityAudit,beforeRuntimeUpgrade,afterRuntimeUpgrade,vars={},vendorOrigin}={}){
 const directory=await mkdtemp(join(tmpdir(),'move-in-check-'));let mf,db,outbound=0,maxStatements=0,lastWrites=0,workerdPid;
 const queued=[],tokens={},integrationKey=randomBytes(32).toString('base64');
 await build({entryPoints:['tests/move-in/worker.ts'],bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:*'],outfile:join(directory,'worker.mjs'),logLevel:'silent'});
 const script=await readFile(join(directory,'worker.mjs'),'utf8');
 async function start(){const before=await children();mf=new Miniflare(convertV4MiniflareOptions({name:'move-in-check',modules:true,script,compatibilityDate:'2026-09-14',compatibilityFlags:['nodejs_compat'],bindings:{INTEGRATION_ENCRYPTION_KEY:integrationKey,...vars,EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:randomBytes(32).toString('hex'),EMAIL_FROM:'test@example.test',OPENAI_API_KEY:randomBytes(32).toString('hex')},d1Databases:{DB:'move-in-check'},r2Buckets:['FILES'],resourcePersistencePath:join(directory,'state'),resourceTmpPath:join(directory,'tmp'),outboundService:async request=>{if(vendorOrigin&&new URL(request.url).origin===vendorOrigin)return fetch(request);outbound++;throw new Error('External calls prohibited')}}));try{db=await mf.getD1Database('DB');workerdPid=await identifyWorkerd(before)}catch(error){await mf.dispose();throw error}}
 await start();
 const applyMigration=async file=>{const source=(await readFile(join('migrations',file),'utf8')).replace(/^\s*--[^\n]*$/gm,'');await db.batch([...source.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(([,sql])=>db.prepare(sql)))};
 // Historical audit fixtures must run at the actual111 boundary. Apply later
 // additive ledgers only after their preserved prior-schema assertions.
 const migrations=(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort(),auditIndex=migrations.indexOf('111_move_in_identity_audit.sql');
 assert.ok(auditIndex>=0);
 try{for(const file of migrations){if(file==='0110_move_in.sql'&&beforeMoveIn)await beforeMoveIn(db,directory);if(beforeIdentityAudit&&migrations.indexOf(file)>=auditIndex)continue;if(file==='118_import_kit_runtime.sql'&&beforeRuntimeUpgrade)await beforeRuntimeUpgrade(db,directory);await applyMigration(file);if(file==='118_import_kit_runtime.sql'&&afterRuntimeUpgrade)await afterRuntimeUpgrade(db,directory);if(file==='0110_move_in.sql'&&afterMoveIn)await afterMoveIn(db,directory)}
 for(const [project,user,role] of [['p','owner','owner'],['p','operator','operator'],['q','foreign','owner']]){if(role==='owner')await db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,1)').bind(project,project,`widget-${project}`,'https://example.test').run();await db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,1)').bind(user,`${user}@example.test`,user).run();await db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(project,user,role).run();const token=randomBytes(32).toString('hex');tokens[user]=token;await db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),user,project,role,Date.now()+86400000).run()}
 if(beforeIdentityAudit){await beforeIdentityAudit(db,directory,await mf.getR2Bucket('FILES'));await applyMigration('111_move_in_identity_audit.sql');if(afterIdentityAudit)await afterIdentityAudit(db,directory);for(const file of migrations.slice(auditIndex+1))await applyMigration(file)}
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
 return {download:async(path)=>{const response=await mf.dispatchFetch('https://app.example'+path,{headers:{Authorization:`Bearer ${tokens.owner}`}});assert.equal(response.status,200);return new Uint8Array(await response.arrayBuffer())},call,raw,step,drain,snapshot,crashDuringStep,contactSession,queued,get db(){return db},get files(){return mf.getR2Bucket('FILES')},get maxStatements(){return maxStatements},get lastWrites(){return lastWrites},get outbound(){return outbound},async close(){await mf.dispose();await assertWorkerdStopped(workerdPid);await rm(directory,{recursive:true,force:true})}}
}
