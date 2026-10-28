import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {chmod,mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createInterface} from 'node:readline'
import {startApp} from './kit/app.mjs'
import {strictOutput} from '../provider-helpers/fixture.mjs'

// The shipped connector CLI against the real application over loopback HTTP. Only
// the paid Codex CLI is a scripted network boundary on the PATH.
let app,ws,scratch,conversations=0
before(async()=>{app=await startApp({listen:true});ws=await app.seedWorkspace('connector',{allowedOrigin:'http://127.0.0.1'});await app.presenceAwayOff(ws.projectId);scratch=await mkdtemp(join(tmpdir(),'h2h-connector-'))})
after(async()=>{await app?.close();if(scratch)await rm(scratch,{recursive:true,force:true})})

async function computer(name,scenario={},{chatgpt=false}={}){
 const directory=join(scratch,name),bin=join(directory,'bin');await mkdir(bin,{recursive:true})
 for(const tool of ['codex']){const target=resolve(`tests/provider-helpers/${tool}.mjs`);await chmod(target,0o755);await symlink(target,join(bin,tool))}
 const scenarioPath=join(directory,'scenario.json');await writeFile(scenarioPath,JSON.stringify(scenario))
 const env={PATH:bin+':'+process.env.PATH,HOME:directory,TMPDIR:process.env.TMPDIR,H2H_LOCAL_CONFIG:join(directory,'config','connector.json'),H2H_PROVIDER_SCENARIO:scenarioPath}
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

test('a private paired connector runs a chosen model once, retains failed and interrupted outcomes without replay, then serves only scoped assignment tools until revocation',async()=>{
 const local=await computer('primary',{chatgptLogin:true,output:strictOutput,notification:false},{chatgpt:true})
 let bridge
 try{
  const code=await pairingCode(),connect=()=>local.cli('connect','--server',app.url,'--code',code,'--provider','codex','--name','Primary computer','--workdir',local.directory,'--model','gpt-6.1-sol')
  const connected=await connect();assert.equal(connected.code,0,connected.output)
  const config=await local.config(),deviceId=config.device.id,conversationId=await conversation()
  assert.equal((await stat(local.configPath)).mode&0o777,0o600);assert.equal((await stat(join(local.directory,'config'))).mode&0o777,0o700)
  assert.doesNotMatch(JSON.stringify(config),/test-only-chatgpt-token/)
  assert.notEqual((await connect()).code,0);assert.equal((await local.config()).device.id,deviceId)
  const ready=async()=>(await devices()).find(d=>d.id===deviceId)?.worker_ready
  assert.equal(await ready(),false)
  const queued=await delegate(conversationId,deviceId,'resolve')
  const ran=await local.cli('run','--once');assert.equal(ran.code,0,ran.output)
  const completed=await job(conversationId,queued.id);assert.equal(completed.status,'completed');assert.equal(completed.result.summary,strictOutput.summary)
  const providerRequest=JSON.parse(await readFile(local.scenarioPath+'.request','utf8'));assert.equal(providerRequest.params.model,config.model)
  const paid=await readFile(local.scenarioPath+'.calls','utf8')
  assert.equal((await local.cli('run','--once')).code,0);assert.equal(await readFile(local.scenarioPath+'.calls','utf8'),paid,'completed work never starts another model turn')

  // One real provider refusal, with private diagnostics present only at the paid edge.
  await local.scenario({beforeResponse:true,error:{message:'Invalid schema. api_key=PRIVATE_API\nprompt: PRIVATE_CONTEXT',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:400}},additionalDetails:'PRIVATE_DETAILS'},stderr:'Bearer PRIVATE_STDERR'})
  const failedJob=await delegate(conversationId,deviceId,'resolve_reply')
  const failed=await local.cli('run','--once');assert.notEqual(failed.code,0);assert.doesNotMatch(failed.output,/PRIVATE_/)
  const stored=await job(conversationId,failedJob.id);assert.equal(stored.status,'failed');assert.equal(stored.result.verified,false);assert.equal(stored.result.provider_error.http_status,400)
  assert.doesNotMatch(JSON.stringify(stored),/PRIVATE_/)
  const afterFailure=await readFile(local.scenarioPath+'.calls','utf8')
  assert.equal((await local.cli('run','--once')).code,0);assert.equal(await readFile(local.scenarioPath+'.calls','utf8'),afterFailure)

  // Laptop loss after dispatch leaves an unknown local attempt. A new process refuses replay;
  // only the operator's explicit cancellation frees the connector for subsequent assignments.
  await local.scenario({hang:true});const interrupted=await delegate(conversationId,deviceId,'resolve')
  const worker=local.start(['run'])
  await app.until(async()=>(await readFile(local.scenarioPath+'.calls','utf8')).length>afterFailure.length,{timeout:20000,message:'model turn dispatched'})
  process.kill(-worker.child.pid,'SIGKILL');await worker.done
  await local.scenario({output:strictOutput})
  const refused=await local.cli('run','--once');assert.notEqual(refused.code,0);assert.match(refused.output,/will not be replayed/)
  const interruptedCalls=await readFile(local.scenarioPath+'.calls','utf8');assert.equal((await job(conversationId,interrupted.id)).status,'running')
  await app.ok(`${delegations(conversationId)}/${interrupted.id}/cancel`,{body:{},token:ws.tokens.owner})
  assert.equal((await local.cli('run','--once')).code,0);assert.equal(await readFile(local.scenarioPath+'.calls','utf8'),interruptedCalls)

  // The same computer changes to an MCP assignment session; this does not invent desktop or
  // browser authority. A second process cannot share its private connector lock.
  bridge=local.start(['mcp']);let id=0;const pending=new Map()
  createInterface({input:bridge.child.stdout}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id)})
  const rpc=(method,params)=>new Promise(done=>{const key=++id;pending.set(key,done);bridge.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n')})
  const tool=async(name,args={})=>{const response=await rpc('tools/call',{name,arguments:args});return {error:!!response.result.isError,value:response.result.isError?response.result.content[0].text:JSON.parse(response.result.content[0].text)}}
  assert.ok((await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'journey',version:'1'}})).result.serverInfo)
  const tools=(await rpc('tools/list',{})).result.tools
  assert.ok(tools.some(t=>t.name==='h2h_result'));assert.ok(tools.every(t=>t.name.startsWith('h2h_')&&!/desktop|browser|computer/.test(t.name)))
  assert.equal((await tool('h2h_claim')).error,false);assert.equal(await ready(),true)
  const contender=await local.cli('status');assert.notEqual(contender.code,0);assert.match(contender.output,/lock|another/i)
  const next=await delegate(conversationId,deviceId)
  const claimed=await tool('h2h_await',{wait_ms:5000});assert.equal(claimed.error,false);assert.equal((claimed.value.job||claimed.value).id,next.id)
  const context=await tool('h2h_context',{job_id:next.id});assert.equal(context.error,false);assert.equal((context.value.context||context.value).conversation.id,conversationId)
  assert.equal((await tool('h2h_progress',{job_id:next.id,message:'Reading account settings.'})).error,false)
  const submitted=await tool('h2h_result',{job_id:next.id,status:'completed',result:strictOutput});assert.equal(submitted.error,false,JSON.stringify(submitted));assert.equal((await job(conversationId,next.id)).status,'completed')
  const withdrawn=await delegate(conversationId,deviceId,'resolve');assert.equal((await tool('h2h_claim')).error,false)
  await app.ok(`/api/projects/${ws.projectId}/local-agents/${deviceId}`,{method:'DELETE',token:ws.tokens.owner})
  const revoked=await job(conversationId,withdrawn.id);assert.equal(revoked.status,'revoked');assert.equal(revoked.delivery_state,'authority_revoked');assert.equal(revoked.result,null)
  assert.equal((await tool('h2h_input',{job_id:withdrawn.id})).error,true)
  bridge.child.stdin.end();await bridge.done;assert.equal(await ready(),false)
  const transcript=(await app.call(`/api/conversations/${conversationId}/messages`,{token:ws.tokens.owner,status:200})).data
  assert.ok(transcript.messages.every(m=>m.actor_role==='contact'),'investigations, failures and revocation never sent a reply')
  assert.doesNotMatch(JSON.stringify([await job(conversationId,next.id),app.requests]),/test-only-chatgpt-token/)
 }finally{bridge?.child.kill('SIGTERM');await local.close()}
})
