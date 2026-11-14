import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runnerRuntime} from '../../move-in/legacy-adoption-integration/runtime.mjs'
import {fakeZendesk} from '../../move-in/zendesk-pull-fixture.mjs'
import {prepareAcceptedAdoption,createNativeRehearsal} from './legacy-fixture.mjs'
import {prepareAcceptedZendesk,finishZendeskDay,drainZendesk} from './zendesk.mjs'

/** Rehearsal uses the same real pull/child importer, with only Zendesk at the network edge. */
export async function zendeskRehearsalJourney(){
 const zendesk=fakeZendesk({attachments:true}),directory=await mkdtemp(join(tmpdir(),'rehearsal-zendesk-'))
 let holdSource=false,arrive,release
 const arrived=new Promise(resolve=>{arrive=resolve}),released=new Promise(resolve=>{release=resolve})
 const app=await runnerRuntime({bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'},network:async request=>{
  const response=await zendesk.handler(request)
  if(holdSource&&new URL(request.url).pathname==='/api/v2/ticket_fields.json'){holdSource=false;arrive();await released}
  return response
 }})
 try{
  const fixture=await prepareAcceptedAdoption(app,directory),{owner,setup,origin}=fixture
  const base=await prepareAcceptedZendesk(app,{setup,token:owner.token,zendesk}),copy=await createNativeRehearsal(app,{...fixture,zendeskProjectId:setup,zendeskPullId:base.id}),machine=copy.root+'/copy/zendesk'
  const before=await app.first('SELECT (SELECT count(*) FROM users) users,(SELECT count(*) FROM memberships) memberships,(SELECT count(*) FROM sessions) sessions')
  const day=new Date(Date.now()-86400000).toISOString().slice(0,10),accepted=(await app.call(machine,{token:copy.credential,status:200})).data.data
  assert.equal((await app.call(machine+'/pulls',{token:owner.token,body:{day,cursor:accepted.acceptedCursor}})).status,401,'native owner session is not machine consent')
  assert.equal((await app.call(machine+'/pulls',{token:'hhr_'+'1'.repeat(64),body:{day,cursor:accepted.acceptedCursor},headers:{'X-Agent-Id':'synthetic-rehearsal-copier'}})).status,401,'a caller name grants no authority')
  assert.equal((await app.call(machine+'/pulls',{token:copy.credential,body:{day,cursor:{tickets:'synthetic-foreign-cursor'}}})).status,409)
  assert.equal((await app.call(machine+'/pulls',{token:copy.credential,body:{day,cursor:accepted.acceptedCursor,subdomain:'synthetic-foreign'}})).status,400)
  const sessionHash=createHash('sha256').update(owner.token).digest('hex')
  await app.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(Date.now()-1000,sessionHash).run()
  await app.db.prepare('UPDATE move_in_zendesk_connections SET access_expires_at=? WHERE project_id=?').bind(Date.now()-1000,setup).run()
  const generation=(await app.first('SELECT generation FROM move_in_zendesk_connections WHERE project_id=?',setup)).generation
  zendesk.state.repeat=true
  const requestStart=zendesk.state.requests.length,result=await finishZendeskDay(app,{...copy,day})
  assert.equal((await app.first('SELECT zendesk_connection_generation FROM rehearsal_grants WHERE id=?',copy.grant.id)).zendesk_connection_generation,generation+1,'required OAuth rotation advances consent and connection atomically')
  assert.ok(zendesk.state.requests.slice(requestStart).every(r=>r.method==='GET'||r.method==='POST'&&r.path==='/oauth/tokens'))
  const modes=await app.sql('SELECT authority_mode,session_hash,rehearsal_id,rehearsal_generation FROM move_in_runs WHERE rehearsal_id=?',copy.grant.id)
  assert.ok(modes.length);assert.ok(modes.every(r=>r.authority_mode==='rehearsal'&&r.session_hash===''&&r.rehearsal_generation===copy.grant.generation))
  assert.deepEqual(await app.first('SELECT (SELECT count(*) FROM users) users,(SELECT count(*) FROM memberships) memberships,(SELECT count(*) FROM sessions) sessions'),before,'copies create no native accounts, memberships or sessions')
  await app.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(Date.now()+3600000,sessionHash).run()
  const child=await app.first('SELECT id FROM move_in_runs WHERE rehearsal_id=? AND state=\'completed\' LIMIT 1',copy.grant.id)
  assert.equal((await app.call(`/api/move-in/projects/${setup}/imports/${child.id}/undo`,{token:owner.token,body:{}})).status,403,'interactive routes cannot turn copy-only children into undo authority')
  await app.call(copy.root+'/stop',{token:owner.token,body:{},headers:{Origin:app.origin},status:202})
  const recreated=(await app.call(`/api/move-in/projects/${setup}/rehearsals`,{token:owner.token,headers:{Origin:app.origin},body:{originManifestSha256:origin.manifestSha256,zendeskProjectId:setup,zendeskPullId:base.id,copierId:'synthetic-rehearsal-copier',expiresAt:Date.now()+3600000},status:201})).data.data
  const nextRoot=`/api/move-in/projects/${setup}/rehearsals/${recreated.grant.id}`,next=nextRoot+'/copy/zendesk',cursor=(await app.call(next,{token:recreated.credential,status:200})).data.data.acceptedCursor
  const active=(await app.call(next+'/pulls',{token:recreated.credential,body:{day:new Date().toISOString().slice(0,10),cursor},status:202})).data.data
  const jobs=await app.takeJobs(),reads=zendesk.state.requests.length
  holdSource=true
  const wake=app.runJobs(jobs)
  await Promise.race([arrived,new Promise((_,reject)=>setTimeout(()=>reject(new Error('source barrier not reached')),10000))])
  await app.call(nextRoot+'/stop',{token:owner.token,body:{},headers:{Origin:app.origin},status:202})
  release();await wake
  await drainZendesk(app)
  assert.equal((await app.first('SELECT count(*) n FROM move_in_zendesk_staged WHERE pull_id=?',active.id)).n,0,'a dispatched read cannot stage after Stop')
  assert.equal(zendesk.state.requests.length,reads+1,'Stop fences the next source dispatch')
  assert.equal((await app.first('SELECT count(*) n FROM move_in_runs WHERE rehearsal_id=?',recreated.grant.id)).n,0)
  const version=(await app.first('SELECT version FROM move_in_zendesk_pulls WHERE id=?',active.id)).version
  await app.runJobs([{type:'move-in.zendesk',id:active.id,projectId:setup}])
  assert.equal((await app.first('SELECT version FROM move_in_zendesk_pulls WHERE id=?',active.id)).version,version,'old wakes never reopen the pull')
  assert.equal((await app.call(next+'/pulls/'+active.id+'/resume',{token:recreated.credential,body:{}})).status,401)
  assert.equal(result.work.unchanged,true)
 }finally{release();await app.close();await rm(directory,{recursive:true,force:true})}
}
