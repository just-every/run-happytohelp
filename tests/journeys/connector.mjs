import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {chmod,mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createInterface} from 'node:readline'
import {startApp} from './kit/app.mjs'
import {LocalAgentApi} from '../../local-agent/lib/api.mjs'
import {strictOutput} from '../provider-helpers/fixture.mjs'
import {checkUnmarkedFailures} from '../provider-helpers/unmarked-failures.mjs'

// The shipped connector CLI against the real application over loopback HTTP. Only
// the paid provider CLIs (codex, claude) are scripted fixtures on the PATH.
let app,ws,scratch,conversations=0
before(async()=>{app=await startApp({listen:true});ws=await app.seedWorkspace('connector',{allowedOrigin:'http://127.0.0.1'});await app.presenceAwayOff(ws.projectId);scratch=await mkdtemp(join(tmpdir(),'h2h-connector-'))})
after(async()=>{await app?.close();if(scratch)await rm(scratch,{recursive:true,force:true})})

async function computer(name,scenario={},{provider='codex',chatgpt=false}={}){
 const directory=join(scratch,name),bin=join(directory,'bin');await mkdir(bin,{recursive:true})
 for(const tool of ['codex','claude']){const target=resolve(`tests/provider-helpers/${tool}.mjs`);await chmod(target,0o755);await symlink(target,join(bin,tool))}
 const scenarioPath=join(directory,'scenario.json');await writeFile(scenarioPath,JSON.stringify(scenario))
 const env={PATH:bin+':'+process.env.PATH,HOME:directory,TMPDIR:process.env.TMPDIR,H2H_LOCAL_CONFIG:join(directory,'config','connector.json'),H2H_PROVIDER_SCENARIO:scenarioPath,...(provider==='claude'?{ANTHROPIC_API_KEY:'test-only-no-network'}:{})}
 if(chatgpt){const home=join(directory,'chatgpt-home');await mkdir(home,{mode:0o700});await writeFile(join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'test-only-chatgpt-token'}}),{mode:0o600});env.CODEX_HOME=home}
 const children=new Set()
 const start=args=>{const child=spawn(process.execPath,[resolve('local-agent/bin/h2h-local.mjs'),...args],{cwd:directory,env,stdio:['pipe','pipe','pipe'],detached:true});children.add(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const done=new Promise((done,fail)=>{child.once('error',fail);child.once('exit',code=>{children.delete(child);done({code,output})})});return {child,done,get output(){return output}}}
 const cli=async(...args)=>start(args).done
 return {directory,env,scenarioPath,start,cli,configPath:env.H2H_LOCAL_CONFIG,async config(){return JSON.parse(await readFile(env.H2H_LOCAL_CONFIG,'utf8'))},async scenario(value){await writeFile(scenarioPath,JSON.stringify(value))},async close(){for(const child of children){const group=signal=>{try{process.kill(-child.pid,signal)}catch{}};group('SIGTERM');await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(()=>group('SIGKILL'),3000).unref()})}}}
}
const pairingCode=async()=>(await app.ok(`/api/projects/${ws.projectId}/local-agents/pairings`,{body:{},token:ws.tokens.owner})).data.code
async function conversation(){
 const visitor=(await app.call('/api/identity/widget/session',{body:{widgetKey:ws.widgetKey},headers:{Origin:'http://127.0.0.1'},status:201})).data
 const created=(await app.call('/api/conversations',{body:{projectId:ws.projectId},token:visitor.token,status:201})).data
 await app.call(`/api/conversations/${created.id}/messages`,{body:{localId:'report-'+(++conversations),content:'Please check my account settings.',expectedRevision:0},token:visitor.token,status:200})
 return created.id
}
const delegations=conversationId=>`/api/projects/${ws.projectId}/conversations/${conversationId}/delegations`
const delegate=async(conversationId,deviceId,mode='investigate',instructions='Inspect the account setting; do not send anything.')=>(await app.ok(delegations(conversationId),{body:{device_id:deviceId,mode,instructions,request_id:randomUUID()},token:ws.tokens.owner})).data
const job=async(conversationId,id)=>(await app.ok(delegations(conversationId),{token:ws.tokens.owner})).data.find(row=>row.id===id)
const devices=async()=>(await app.ok(`/api/projects/${ws.projectId}/local-agents`,{token:ws.tokens.owner})).data

test('the shipped CLI refuses remote HTTP servers and unsigned-in Codex, pairs once into owner-only private config under a lock, and never overwrites an active pairing',async()=>{
 const remote=await computer('remote')
 const refused=await remote.cli('connect','--server','http://support.example.test','--code','unused','--provider','codex','--name','Remote','--workdir',remote.directory)
 assert.notEqual(refused.code,0);assert.match(refused.output,/HTTPS|loopback|server/i);await assert.rejects(stat(remote.configPath))
 const signedOut=await computer('signed-out',{loggedOut:true}),code=await pairingCode()
 const login=await signedOut.cli('connect','--server',app.url,'--code',code,'--provider','codex','--name','Signed out','--workdir',signedOut.directory)
 assert.notEqual(login.code,0);assert.match(login.output,/codex login|not signed in|login/i);await assert.rejects(stat(signedOut.configPath),'an unsigned-in provider is never paired as a worker')
 assert.ok(!(await devices()).some(device=>device.name==='Signed out'))
 const local=await computer('primary',{chatgptLogin:true,output:strictOutput,notification:false},{chatgpt:true})
 try{
  const paired=await local.cli('connect','--server',app.url,'--code',code,'--provider','codex','--name','Primary computer','--workdir',local.directory,'--model','gpt-6.1-sol')
  assert.equal(paired.code,0,paired.output);assert.match(paired.output,/Paired this computer with HappyToHelp/)
  const config=await local.config();assert.equal(config.server,app.url);assert.equal(config.codexAuth.authenticated,true);assert.equal(config.model,'gpt-6.1-sol')
  assert.equal((await stat(local.configPath)).mode&0o777,0o600,'the credential file is private to its owner');assert.equal((await stat(join(local.directory,'config'))).mode&0o777,0o700)
  assert.doesNotMatch(JSON.stringify(config),/test-only-chatgpt-token/,'the provider login never enters the connector config')
  const listed=(await devices()).find(device=>device.id===config.device.id);assert.ok(listed);assert.ok(listed.capabilities.includes('direct_runner'))
  assert.equal((await local.cli('connect','--server',app.url,'--code',code,'--provider','codex','--name','Reuse','--workdir',local.directory)).code,1,'a used code is refused')
  const second=await local.cli('connect','--server',app.url,'--code',await pairingCode(),'--provider','codex','--name','Replacement','--workdir',local.directory)
  assert.notEqual(second.code,0);assert.match(second.output,/already paired/);assert.equal((await local.config()).device.id,config.device.id,'the existing credential is unchanged')
  // A long-running worker holds the connector lock; a second process on the same config cannot share it.
  const worker=local.start(['run'])
  await app.until(()=>/Ready|Listening/.test(worker.output),{timeout:20000,message:'worker ready'})
  const contender=await local.cli('status');assert.notEqual(contender.code,0);assert.match(contender.output,/lock|another/i)
  worker.child.kill('SIGTERM');await worker.done
  const status=await local.cli('status');assert.equal(status.code,0,status.output);assert.match(status.output,/ready/i)
 }finally{await local.close();await signedOut.close();await remote.close()}
})

test('a direct worker runs delegated jobs through each provider CLI: Codex with the customer ChatGPT login and chosen model, Claude with structured output first, results recorded once',async()=>{
 const codex=await computer('codex-runner',{chatgptLogin:true,output:strictOutput,notification:false},{chatgpt:true})
 const claude=await computer('claude-runner',{events:[{type:'assistant',message:{content:[{type:'text',text:'{"summary":"display text must not win"}'}]}},{type:'result',subtype:'success',result:'display text',structured_output:{...strictOutput,summary:'Structured output wins.'}}]},{provider:'claude'})
 try{
  assert.equal((await codex.cli('connect','--server',app.url,'--code',await pairingCode(),'--provider','codex','--name','Codex runner','--workdir',codex.directory,'--model','gpt-6.1-sol')).code,0)
  const codexDevice=(await codex.config()).device.id,conversationId=await conversation(),queued=await delegate(conversationId,codexDevice,'resolve','Check the fixture state.')
  const ran=await codex.cli('run','--once');assert.equal(ran.code,0,ran.output)
  const done=await job(conversationId,queued.id);assert.equal(done.status,'completed');assert.equal(done.result.verified,true);assert.equal(done.result.summary,strictOutput.summary)
  for(const suffix of ['.thread-request','.request']){const request=JSON.parse(await readFile(codex.scenarioPath+suffix,'utf8'));assert.equal(request.params.model,'gpt-6.1-sol');assert.equal(request.params.modelProvider,undefined)}
  assert.equal((await readFile(codex.scenarioPath+'.calls','utf8')).trim(),'turn/start')
  assert.equal((await codex.cli('run','--once')).code,0);assert.equal((await readFile(codex.scenarioPath+'.calls','utf8')).trim(),'turn/start','an idle run starts no provider turn')
  const events=await app.sql("SELECT payload FROM local_events WHERE job_id=? AND kind='result'",queued.id);assert.equal(events.length,1)
  assert.doesNotMatch(JSON.stringify([done,events,app.requests]),/test-only-chatgpt-token/,'the ChatGPT login never reaches HappyToHelp')
  assert.equal((await claude.cli('connect','--server',app.url,'--code',await pairingCode(),'--provider','claude','--name','Claude runner','--workdir',claude.directory)).code,0)
  const claudeJob=await delegate(conversationId,(await claude.config()).device.id,'investigate')
  const claudeRun=await claude.cli('run','--once');assert.equal(claudeRun.code,0,claudeRun.output)
  const claudeDone=await job(conversationId,claudeJob.id);assert.equal(claudeDone.status,'completed');assert.equal(claudeDone.result.summary,'Structured output wins.')
  assert.equal((await app.first("SELECT count(*) n FROM messages WHERE conversation_id=? AND actor_role!='contact'",conversationId)).n,0,'an investigation sends nothing to the customer')
 }finally{await codex.close();await claude.close()}
})

test('provider failures are recorded once with only the provider reason and real status, redacted and bounded; the native boundary refuses malformed reports and never sends or replays',async()=>{
 const codex=await computer('failing-codex',{})
 try{
  assert.equal((await codex.cli('connect','--server',app.url,'--code',await pairingCode(),'--provider','codex','--name','Failing runner','--workdir',codex.directory)).code,0)
  const config=await codex.config(),conversationId=await conversation()
  for(const status of [400,401,429,500,503]){
   await codex.scenario({beforeResponse:true,error:{message:'Invalid schema: Missing attachment_ids. api_key=PRIVATE_API\nprompt: PRIVATE_CONTEXT',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:status}},additionalDetails:'PRIVATE_DETAILS'},stderr:'Bearer PRIVATE_STDERR',rawNotifications:[{method:'rawResponse/completed',params:{threadId:'provider-thread',turnId:'provider-turn',responseId:'test-response',usage:null,usageMetadata:{amount:null,metadata:'PRIVATE_RAW_ACCOUNTING'}}}]})
   await rm(codex.scenarioPath+'.calls',{force:true})
   const queued=await delegate(conversationId,config.device.id,'resolve_reply','Inspect only; do not send')
   const failed=await codex.cli('run','--once');assert.notEqual(failed.code,0);assert.doesNotMatch(failed.output,/PRIVATE_/)
   assert.equal((await codex.cli('run','--once')).code,0,'the failure is not replayed');assert.equal((await readFile(codex.scenarioPath+'.calls','utf8')).trim(),'turn/start')
   const row=await job(conversationId,queued.id);assert.equal(row.status,'failed');assert.equal(row.result.verified,false);assert.equal(row.result.provider_error.http_status,status);assert.match(row.result.provider_error.message,/Missing attachment_ids/)
   const events=await app.sql("SELECT event_id,payload FROM local_events WHERE job_id=? AND kind='result'",queued.id);assert.equal(events.length,1)
   const run=await app.first('SELECT run_id FROM local_jobs WHERE id=?',queued.id)
   assert.equal((await app.call(`/api/local-agents/jobs/${queued.id}/result`,{body:{...JSON.parse(events[0].payload),run_id:run.run_id,event_id:events[0].event_id},token:config.token})).status,200,'the same result event is idempotent')
   assert.doesNotMatch(JSON.stringify([row,events,await codex.config()]),/PRIVATE_/)
  }
  // An untrusted connector cannot smuggle private content, proposals or effects through a failure report.
  const api=new LocalAgentApi(config),request=async(path,body,bearer=ws.tokens.owner,method=body===undefined?'GET':'POST')=>{const response=await app.call(path,{body,token:bearer,method});return {status:response.status,...(response.data&&typeof response.data==='object'?response.data:{})}}
  const db=app.db
  const queued=await delegate(conversationId,config.device.id,'resolve_reply','Untrusted connector test'),claim=await api.claim({claim_id:'malicious'}),endpoint=`/api/local-agents/jobs/${queued.id}/result`
  const body={run_id:claim.run_id,event_id:'malicious',status:'failed',result:{summary:'PRIVATE_SUMMARY',actions:[{description:'PRIVATE_ACTION',evidence:'PRIVATE_EVIDENCE'}],verified:false,reply_draft:'PRIVATE_REPLY',replies:[{id:'send',body:'PRIVATE_PROPOSAL'}],unexpected:'PRIVATE_EXTRA',provider_error:{provider:'codex',http_status:400,message:'Invalid schema. https://PRIVATE_USER:PRIVATE_PASSWORD@example.test/api?token=PRIVATE_QUERY#PRIVATE_HASH\nBearer PRIVATE_BEARER\nCookie: PRIVATE_COOKIE\n'+'x'.repeat(900)+'\nprompt: PRIVATE_PROMPT'}}}
  for(const invalid of [{http_status:'400'},{http_status:99},{http_status:600},{provider:'untrusted'},{message:'x'.repeat(8001)},{extra:'PRIVATE_EXTRA'}]){const attempted=structuredClone(body);Object.assign(attempted.result.provider_error,invalid);assert.equal((await request(endpoint,attempted,config.token)).status,422)}
  assert.equal((await request(endpoint,{...body,status:'completed'},config.token)).status,422);assert.equal((await request(endpoint,{...body,run_id:'wrong'},config.token)).status,409);assert.equal((await request(endpoint,body,'wrong-device')).status,401)
  const admitted=await request(endpoint,body,config.token);assert.equal(admitted.status,200);assert.doesNotMatch(JSON.stringify(admitted),/PRIVATE_/);assert.ok(admitted.data.result.provider_error.message.length<=600)
  assert.doesNotMatch(JSON.stringify(await app.sql('SELECT result FROM local_jobs WHERE id=?',queued.id))+JSON.stringify(await app.sql('SELECT payload FROM local_events WHERE job_id=?',queued.id)),/PRIVATE_/)
  for(const table of ['local_receipts','local_result_effects'])assert.equal((await app.first(`SELECT COUNT(*) n FROM ${table} WHERE job_id=?`,queued.id)).n,0,table)
  await checkUnmarkedFailures({request,api,db,jobsPath:delegations(conversationId),device:config.device.id,token:config.token})
  assert.equal((await app.first("SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND actor_role!='contact'",conversationId)).n,0,'no failure report reached the customer')
 }finally{await codex.close()}
})

test('the MCP bridge offers only assignment tools, is ready only while its session lives, submits a result before clearing its job, and a revoked device ends work without a pretend cancellation',async()=>{
 const desktop=await computer('mcp',{output:strictOutput})
 let bridge
 try{
  assert.equal((await desktop.cli('connect','--server',app.url,'--code',await pairingCode(),'--provider','codex','--name','Desktop session','--workdir',desktop.directory)).code,0)
  const config=await desktop.config(),ready=async()=>(await devices()).find(device=>device.id===config.device.id)?.worker_ready
  assert.equal(await ready(),false,'a paired computer is not ready until a worker or session runs')
  bridge=desktop.start(['mcp']);let id=0;const pending=new Map()
  createInterface({input:bridge.child.stdout}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id)})
  const rpc=(method,params)=>new Promise(done=>{const key=++id;pending.set(key,done);bridge.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n')})
  const tool=async(name,args={})=>{const response=await rpc('tools/call',{name,arguments:args});return {error:!!response.result.isError,value:response.result.isError?response.result.content[0].text:JSON.parse(response.result.content[0].text)}}
  assert.equal((await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.serverInfo.name,'happytohelp-local-agent')
  const names=(await rpc('tools/list',{})).result.tools.map(tool=>tool.name).sort()
  assert.deepEqual(names,['h2h_await','h2h_claim','h2h_context','h2h_input','h2h_progress','h2h_recover','h2h_result','h2h_upload','h2h_wait_for_assignment'],'no desktop, browser or computer capability is fabricated')
  const idle=await tool('h2h_claim');assert.equal(idle.error,false,JSON.stringify(idle))
  assert.equal(await ready(),true,'an active MCP session is ready')
  const conversationId=await conversation(),queued=await delegate(conversationId,config.device.id,'investigate')
  const claimed=await tool('h2h_await',{wait_ms:5000});assert.equal(claimed.error,false);const claimedJob=claimed.value.job||claimed.value;assert.equal(claimedJob.id,queued.id)
  const context=await tool('h2h_context',{job_id:queued.id});assert.equal(context.error,false);assert.equal((context.value.context||context.value).conversation.id,conversationId)
  assert.equal((await tool('h2h_progress',{job_id:queued.id,message:'Reading the account setting.'})).error,false)
  const submitted=await tool('h2h_result',{job_id:queued.id,status:'completed',result:{summary:'Account setting is correct.',actions:[{description:'Read setting',evidence:'enabled=true'}],verified:true,question:null,reply_draft:'',attachment_ids:[],replies:[],follow_up_actions:[]}})
  assert.equal(submitted.error,false,JSON.stringify(submitted));assert.equal((await job(conversationId,queued.id)).status,'completed')
  assert.equal((await app.sql("SELECT event_id FROM local_events WHERE job_id=? AND kind='result'",queued.id)).length,1)
  // A device revoked mid-assignment loses authority; the bridge reports nothing on its behalf.
  const second=await delegate(conversationId,config.device.id,'resolve','Hold the fixture.');assert.equal((await tool('h2h_claim')).error,false)
  await app.ok(`/api/projects/${ws.projectId}/local-agents/${config.device.id}`,{method:'DELETE',token:ws.tokens.owner})
  const withdrawn=await job(conversationId,second.id);assert.equal(withdrawn.status,'revoked');assert.equal(withdrawn.delivery_state,'authority_revoked');assert.equal(withdrawn.result,null)
  const after=await tool('h2h_input',{job_id:second.id});assert.equal(after.error,true,'the revoked bridge cannot continue')
  assert.equal((await job(conversationId,second.id)).result,null,'no cancellation result is invented for the revoked run')
  bridge.child.stdin.end();await bridge.done
  assert.equal(await ready(),false,'stopping the bridge clears readiness')
 }finally{bridge?.child.kill('SIGTERM');await desktop.close()}
})

test('a direct worker killed mid-run leaves an uncertain job that no later start replays; the operator cancel clears it without restarting the provider',async()=>{
 const codex=await computer('interrupted',{hang:true})
 try{
  assert.equal((await codex.cli('connect','--server',app.url,'--code',await pairingCode(),'--provider','codex','--name','Interrupted runner','--workdir',codex.directory)).code,0)
  const config=await codex.config(),conversationId=await conversation(),queued=await delegate(conversationId,config.device.id,'resolve','Change the fixture setting.')
  const worker=codex.start(['run'])
  await app.until(async()=>(await readFile(codex.scenarioPath+'.calls','utf8').catch(()=>'')).includes('turn/start'),{timeout:20000,message:'provider turn started'})
  assert.equal((await job(conversationId,queued.id)).status,'running')
  // The whole worker process group dies at once, as when a laptop loses power.
  process.kill(-worker.child.pid,'SIGKILL');await worker.done
  // Whatever the provider did is unknown: a fresh start refuses to dispatch it again.
  await codex.scenario({output:strictOutput})
  for(const attempt of [1,2]){const again=await codex.cli('run','--once');assert.notEqual(again.code,0,`attempt ${attempt}`);assert.match(again.output,/will not be replayed/)}
  assert.equal((await readFile(codex.scenarioPath+'.calls','utf8')).trim(),'turn/start','the provider is never started again for the uncertain run')
  assert.equal((await job(conversationId,queued.id)).status,'running','the server keeps the job open; nobody invents an outcome')
  await app.ok(`${delegations(conversationId)}/${queued.id}/cancel`,{body:{},token:ws.tokens.owner})
  const cleared=await codex.cli('run','--once');assert.equal(cleared.code,0,cleared.output)
  assert.equal((await readFile(codex.scenarioPath+'.calls','utf8')).trim(),'turn/start');assert.equal((await job(conversationId,queued.id)).status,'cancelled')
  const next=await delegate(conversationId,config.device.id,'investigate');assert.equal((await codex.cli('run','--once')).code,0)
  assert.equal((await job(conversationId,next.id)).status,'completed','after the operator decision the worker takes new work')
 }finally{await codex.close()}
})
