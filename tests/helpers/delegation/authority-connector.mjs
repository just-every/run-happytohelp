import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {customerFixture} from '../delegation-journey/fixture.mjs'
import {connector} from '../delegation-journey/connector.mjs'
import {client,newVisitor,until} from '../delegation-journey/case.mjs'

// The shipped CLI observes withdrawal itself, while its provider holds a real
// read-only connection to the disposable system. No cancellation is invented.
export async function connectorAuthorityOutcomes(){
 const app=await startApp({listen:true}),fixture=await customerFixture()
 const scratch=await mkdtemp(join(tmpdir(),'h2h-authority-'))
 try{
  for(const scenario of ['device','membership']){
   fixture.reset()
   const ws=await app.seedWorkspace('authority-'+scenario,{allowedOrigin:app.url})
   const actor={id:ws.users.operator,projectId:ws.projectId},api=client(app.url,ws.tokens.operator),owner=client(app.url,ws.tokens.owner)
   await app.presenceAwayOff(ws.projectId)
   const visitor=await newVisitor({origin:app.url,api,projectId:ws.projectId})
   const queuedVisitor=await newVisitor({origin:app.url,api,projectId:ws.projectId})
   const c=visitor.session.conversationId,q=queuedVisitor.session.conversationId
   const path=`/api/projects/${ws.projectId}/conversations/${c}/delegations`
   const jobs=async()=>(await owner(path)).data
   const job=async id=>(await jobs()).find(j=>j.id===id)
   const counts=async()=>({jobs:(await app.first('SELECT COUNT(*) n FROM local_jobs WHERE project_id=?',ws.projectId)).n,messages:(await visitor.transcript()).messages.length+(await queuedVisitor.transcript()).messages.length,reads:fixture.events.filter(e=>e.method==='GET').length,writes:fixture.events.filter(e=>e.method==='POST').length})
   assert.deepEqual(await counts(),{jobs:0,messages:2,reads:0,writes:0})
   const code=(await api(`/api/projects/${ws.projectId}/local-agents/pairings`,{})).data.code
   const worker=await connector({origin:app.url,directory:join(scratch,scenario),code})
   const config=async()=>JSON.parse(await readFile(join(worker.directory,'connector.json'),'utf8'))
   const device=client(app.url,worker.token)
   const command={device_id:worker.deviceId,mode:'resolve',instructions:'Read Spanish setting and wait; do not change it or send.',request_id:randomUUID()}
   try{
    const initial=(await api(path,command)).data
    assert.equal((await api(path,command)).data.id,initial.id)
    assert.deepEqual(await counts(),{jobs:1,messages:2,reads:0,writes:0})
    const execution=await worker.run({phase:'hold',fixture:fixture.origin,conversationId:c,projectId:ws.projectId},{background:true})
    await until(()=>readFile(join(worker.directory,'started.json'),'utf8').then(JSON.parse).catch(()=>null),Boolean,'connector began work')
    const active=await job(initial.id);assert.equal(active.status,'running');assert.equal(active.operator_id,actor.id)
    const queuedPath=`/api/projects/${ws.projectId}/conversations/${q}/delegations`
    const queued=(await api(queuedPath,{...command,request_id:randomUUID()})).data
    assert.deepEqual(await counts(),{jobs:2,messages:2,reads:1,writes:0})
    if(scenario==='device')await api(`/api/projects/${ws.projectId}/local-agents/${worker.deviceId}`,undefined,{method:'DELETE'})
    else await owner(`/api/management/projects/${ws.projectId}/agents/${actor.id}`,undefined,{method:'DELETE'})
    const heartbeat=await device('/api/local-agents/heartbeat',{},scenario==='device'?{status:401}:{})
    if(scenario==='membership')assert.deepEqual(heartbeat.data.active_jobs,[])
    const withdrawn=await job(initial.id)
    assert.equal(withdrawn.status,'revoked');assert.equal(withdrawn.delivery_state,scenario==='device'?'authority_revoked':'membership_lost')
    assert.equal(withdrawn.cancel_requested,true);assert.ok(withdrawn.completed_at);assert.equal(withdrawn.result,null)
    const denied=scenario==='device'?401:403
    await device(`/api/local-agents/jobs/${initial.id}/context?run_id=${active.run_id}`,undefined,{status:denied})
    await device(`/api/local-agents/jobs/${initial.id}/progress`,{run_id:active.run_id,event_id:'late-progress',message:'Late'},{status:denied})
    await device(`/api/local-agents/jobs/${initial.id}/result`,{run_id:active.run_id,event_id:'late-result',status:'cancelled',result:{summary:'Late',actions:[],verified:false}},{status:denied})
    await until(config,value=>scenario==='device'?value.activeJobs?.[initial.id]?.phase==='revoked_unknown':!value.activeJobs?.[initial.id],'connector observes withdrawn authority')
    // The boundary deliberately never acknowledges turn/start. End only the
    // test-owned process after inspecting its durable local authority state.
    await worker.close();await execution.done
    if(scenario==='device'){
     assert.ok((await config()).revokedAt)
     assert.equal((await owner(queuedPath)).data.find(j=>j.id===queued.id).status,'cancelled')
     await worker.run({phase:'hold'},{expected:1})
    }else{
     assert.equal((await device('/api/local-agents/claim',{claim_id:'withdrawn-claim'})).data,null)
     assert.equal((await owner(queuedPath)).data.find(j=>j.id===queued.id).status,'cancelled')
    }
    assert.equal((await job(initial.id)).status,'revoked');assert.equal((await job(initial.id)).result,null)
    assert.equal((await app.first("SELECT COUNT(*) n FROM local_events WHERE job_id=? AND kind='result'",initial.id)).n,0)
    assert.deepEqual(await counts(),{jobs:2,messages:2,reads:1,writes:0});assert.equal(fixture.enabled,false)
   }finally{await worker.close()}
  }
  assert.deepEqual(app.requests,[])
 }finally{await app.close();await fixture.close();await rm(scratch,{recursive:true,force:true})}
}
