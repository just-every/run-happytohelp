import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
export const json=body=>({method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
// A team that answers without the dashboard open: presence-based away is off (presence: tests/helpers/widget/presence.mjs).
export async function presenceAwayOff(h){await h.db.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{"is_presence_away_enabled":false}',?) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.is_presence_away_enabled',json('false')),updated_at=excluded.updated_at`).bind(Date.now()).run()}
export async function optIntoProactiveHelp(h,conversationId){
 // Insight admission requires the workspace policy and the visitor's own consent.
 await h.db.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{"is_contact_tracking_enabled":true,"proactive_help_enabled":true}',?) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.is_contact_tracking_enabled',json('true'),'$.proactive_help_enabled',json('true')),updated_at=excluded.updated_at`).bind(Date.now()).run();
 await h.call('/api/conversations/'+conversationId+'/widget-events',{...json({action:'contextConsent',data:{consent:true}}),actor:'visitor'});
}
export async function harness({beforeOutcomes,bindings={}}={}){
 const directory=await mkdtemp(join(tmpdir(),'reports-'));let mf,external=0;const tokens={};
 try{
 await build({entryPoints:['tests/reports/worker.ts'],bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:*'],outfile:join(directory,'worker.mjs'),logLevel:'silent'});
 mf=new Miniflare(convertV4MiniflareOptions({name:'reports-check',modules:true,script:await readFile(join(directory,'worker.mjs'),'utf8'),compatibilityDate:'2026-09-14',compatibilityFlags:['nodejs_compat'],bindings,d1Databases:{DB:'reports-check'},r2Buckets:['FILES'],durableObjects:{CONVERSATIONS:'ConversationSocket'},resourcePersistencePath:join(directory,'state'),resourceTmpPath:join(directory,'tmp'),outboundService:async()=>{external++;throw Error('External requests prohibited')}}));
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()){
  if(file==='112_conversation_outcomes.sql'&&beforeOutcomes)await beforeOutcomes(db)
  const sql=(await readFile(join('migrations',file),'utf8')).replace(/^\s*--[^\n]*$/gm,'');await db.batch([...sql.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(([,statement])=>db.prepare(statement)))
 }
 for(const [project,user] of [['p','owner'],['q','foreign']]){await db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,1)').bind(project,project,'widget-'+project,'https://app.example').run();await db.prepare('INSERT INTO users VALUES(?,?,?,1)').bind(user,user+'@example.test',user).run();await db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").bind(project,user).run();await session(user,project,user,'owner')}
 async function session(name,project,actor,role='contact'){tokens[name]=randomBytes(32).toString('hex');await db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,?,?,?,?,?)').bind(createHash('sha256').update(tokens[name]).digest('hex'),actor,project,role,role==='contact'?actor:null,Date.now()+3600000).run();if(role!=='contact')await db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(createHash('sha256').update(tokens[name]).digest('hex'),actor,Date.now()).run()}
 async function raw(path,{actor='owner',headers={},...options}={}){return mf.dispatchFetch('https://app.example'+path,{...options,headers:{Authorization:'Bearer '+tokens[actor],...headers}})}
 async function call(path,options){const response=await raw(path,options),data=await response.json();assert.ok(response.ok,JSON.stringify({status:response.status,data}));return data}
 async function contact(id='visitor',project='p'){await db.prepare('INSERT INTO contacts(id,project_id,created_at) VALUES(?,?,1)').bind(id,project).run();await session(id,project,id);return id}
 async function conversation(contactId='visitor'){return call('/api/conversations',{...json({projectId:'p'}),actor:contactId})}
 async function send(id,content,authoring={kind:'human'},actor='owner',resolve=false){const current=await db.prepare('SELECT revision FROM conversations WHERE id=?').bind(id).first();return call('/api/conversations/'+id+'/messages',{...json({content,localId:randomBytes(10).toString('hex'),expectedRevision:current.revision,resolve,...(authoring?{authoring}:{})}),actor})}
 const transition=(id,body)=>call('/api/dashboard/projects/p/conversations/'+id,{...json(body),method:'PUT'})
 return {db,raw,call,session,contact,conversation,send,transition,get external(){return external},tokenHash:name=>createHash('sha256').update(tokens[name]).digest('hex'),async close(){await mf.dispose();await rm(directory,{recursive:true,force:true})}}
 }catch(error){if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});throw error}
}
