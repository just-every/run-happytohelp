import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
export const allScopes=['conversations:read','conversations:write','messages:write','contacts:read','contacts:write','articles:read','articles:write'];
export const body=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
export const sha=value=>createHash('sha256').update(value).digest('hex');
export async function harness({beforeIntegrations,rateLimits}={}){
 const directory=await mkdtemp(join(tmpdir(),'connections-'));let mf,server,external=0,receiverVerifier=null;const sessions={},received=[],responses=[],inboundToken=randomBytes(32).toString('hex');
 try{
 server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const receipt={path:req.url,headers:req.headers,body:Buffer.concat(chunks)};received.push(receipt);const response=receiverVerifier&&!receiverVerifier(receipt)?{status:401,body:''}:responses.shift()||{status:204,body:''};if(response.delay)await new Promise(resolve=>setTimeout(resolve,response.delay));if(res.destroyed)return;res.writeHead(response.status,response.headers||{});if(response.chunks){for(const chunk of response.chunks)res.write(chunk);res.end()}else res.end(response.body||'')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port;
 await build({entryPoints:['tests/connections/worker.ts'],bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:*'],outfile:join(directory,'worker.mjs'),logLevel:'silent'});
 const options=convertV4MiniflareOptions({name:'connections-check',port:0,modules:true,script:await readFile(join(directory,'worker.mjs'),'utf8'),compatibilityDate:'2026-09-14',compatibilityFlags:['nodejs_compat'],bindings:{...(rateLimits?{RATE_LIMITS:JSON.stringify(rateLimits)}:{}),INBOUND_EMAIL_TOKEN:inboundToken,INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},d1Databases:{DB:'connections-check'},r2Buckets:['FILES'],durableObjects:{CONVERSATIONS:'ConversationSocket'},resourcePersistencePath:join(directory,'state'),resourceTmpPath:join(directory,'tmp'),outboundService:async req=>{
  const url=new URL(req.url);if(url.origin!=='https://receiver.example.com'&&url.origin!=='https://hooks.slack.com'&&url.href!=='https://slack.com/api/chat.postMessage'){external++;throw Error('Test transport refused destination')}
  return fetch(endpoint+'/'+url.hostname+url.pathname,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:await req.arrayBuffer()}),redirect:'manual'})
 }});mf=new Miniflare(options);
 let db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  if(file==='114_integrations_core.sql'&&beforeIntegrations)await beforeIntegrations(db)
  const sql=(await readFile(join('migrations',file),'utf8')).replace(/^\s*--[^\n]*$/gm,'');await db.batch([...sql.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(([,statement])=>db.prepare(statement)))
 }
 for(const [project,user] of [['p','owner'],['q','foreign']]){await db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,1)').bind(project,project,'widget-'+project,'https://app.example').run();await db.prepare('INSERT INTO users VALUES(?,?,?,1)').bind(user,user+'@example.test',user).run();await db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").bind(project,user).run();await session(user,project,user,'owner')}
 async function session(name,project,actor,role='contact'){sessions[name]=randomBytes(32).toString('hex');await db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,?,?,?,?,?)').bind(sha(sessions[name]),actor,project,role,role==='contact'?actor:null,Date.now()+3600000).run();if(role!=='contact')await db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(sha(sessions[name]),actor,Date.now()).run()}
 async function raw(path,{actor='owner',token,headers={},...options}={}){const response=await mf.dispatchFetch('https://app.example'+path,{...options,headers:{...(token===null?{}:{Authorization:'Bearer '+(token??sessions[actor])}),...headers}});const bytes=await response.arrayBuffer();return new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers})}
 async function call(path,options){const response=await raw(path,options),data=await response.json();assert.ok(response.ok,'Expected success at '+path+'; HTTP '+response.status);return data}
 async function issue(scopes=allScopes,project='p',input={}){return call(`/api/management/projects/${project}/connections/tokens`,{actor:project==='p'?'owner':'foreign',...body({name:'Test integration',scopes,...input})})}
 async function contact(id='visitor',project='p'){await db.prepare('INSERT INTO contacts(id,project_id,name,created_at) VALUES(?,?,?,1)').bind(id,project,'Visitor '+id).run();await session(id,project,id);return id}
 async function conversation(id='visitor',project='p'){return call('/api/conversations',{actor:id,...body({projectId:project})})}
 const dispatch=(projectId='p')=>call('/_test/dispatch',body({projectId}));
 let url=await mf.ready;
 async function restart(){await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB');url=await mf.ready}
 return {get db(){return db},raw,call,issue,session,contact,conversation,dispatch,file:async key=>(await mf.getR2Bucket('FILES')).get(key),received,responses,restart,setReceiverVerifier:verify=>{receiverVerifier=verify},inbound:data=>call('/api/integrations/email/inbound',{token:inboundToken,...body(data)}),get url(){return String(url)},sessionToken:name=>sessions[name],get external(){return external},async close(){await mf.dispose();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}}
 }catch(e){if(mf)await mf.dispose();if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});throw e}
}
