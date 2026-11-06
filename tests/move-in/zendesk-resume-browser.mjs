import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

// Real upload/review/apply creates the batch custody. Only the historical pull
// linkage, old review metadata and a historical run error are seeded, with the emitted Worker stopped.
// Resume then uses the ordinary HTTP route, queue and planning engine.
export async function zendeskResumeBrowserFlow({page,runtime,project:originalProject,inspect}){
 const origin=runtime.origin,created=await page.request.post(origin+'/api/management/projects',{data:{name:'Northstar support history',allowedOrigin:origin}})
 assert.equal(created.status(),201)
 const project=(await created.json()).id,base=`/projects/${project}`,api=`/api/move-in/projects/${project}`,pullId=randomUUID()
 const switchProject=async id=>{const response=await page.request.post(origin+'/api/identity/switch-project',{data:{projectId:id}});assert.equal(response.status(),200)}
 const get=async path=>{const response=await page.request.get(origin+path);assert.equal(response.status(),200);return (await response.json()).data}
 const until=async(read,accept)=>{const deadline=Date.now()+120000;let value;do{value=await read();if(accept(value))return value;assert.equal(value.error,null);await new Promise(resolve=>setTimeout(resolve,250))}while(Date.now()<deadline);assert.fail('Zendesk batch did not reach its expected review state')}
 const readPull=()=>get(`${api}/zendesk/pulls/${pullId}`),readRun=id=>get(`${api}/imports/${id}`)
 const summary={tickets:1,ticketsNew:1,ticketsRefused:0,replies:0,users:1,organizations:0,articles:{published:0,draft:0,heldBack:0},refused:0}
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'"
 await switchProject(project)
 try{
  const runs=[]
  for(let n=0;n<4;n++){
   const id=9100+n,dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}
   const records=[{user:{id,role:'end-user',name:`Northstar customer ${n+1}`,email:`northstar-${n+1}@example.test`,...dates}},{ticket:{id,requester_id:id,subject:['Shipment tracking','Refund receipt','Delivery instructions','Order confirmation'][n],status:'open',comments:[{id:id*10,author_id:id,body:'Please help with this order.',public:true,...dates}],...dates}}]
   const uploaded=await page.request.post(origin+api+'/imports?vendor=zendesk',{headers:{'Content-Type':'application/octet-stream','X-Import-Filename':`northstar-batch-${n+1}.jsonl`},data:records.map(JSON.stringify).join('\n')})
   assert.equal(uploaded.status(),201)
   const {data}=await uploaded.json();runs.push(await until(()=>readRun(data.id),r=>r.state==='ready'))
  }
  const currentRevision=runs[0].plan.mappingRevision
  assert.ok(currentRevision>1)
  // One already approved/imported batch is reused by the pull; it must stay put.
  const applied=await page.request.post(origin+api+`/imports/${runs[3].id}/apply`,{data:{fingerprint:runs[3].plan.fingerprint}})
  assert.equal(applied.status(),202)
  await until(()=>readRun(runs[3].id),r=>r.state==='completed')
  const oldRevision=currentRevision-1,now=Date.now(),ids=runs.map(r=>quote(r.id))
  await runtime.restart(()=>runtime.execute(`
   UPDATE move_in_runs SET source='zendesk-pull' WHERE id IN (${ids.join(',')});
   UPDATE move_in_runs SET plan_json=json_set(plan_json,'$.mappingRevision',${oldRevision}) WHERE id IN (${ids[0]},${ids[3]});
   UPDATE move_in_runs SET plan_json=json_remove(plan_json,'$.mappingRevision') WHERE id=${ids[1]};
   INSERT INTO move_in_zendesk_pulls(id,project_id,actor_id,session_hash,subdomain,state,phase,counts_json,created_at,updated_at)
    SELECT ${quote(pullId)},project_id,actor_id,session_hash,'northstar','ready','review',${quote(JSON.stringify({source:{tickets:4,deleted:0,replies:0,users:4,organizations:0,ticketFields:0,articles:0}}))},${now},${now} FROM move_in_runs WHERE id=${ids[0]};
   ${runs.map((r,i)=>`INSERT INTO move_in_zendesk_pull_runs(pull_id,ordinal,run_id,summary_json) VALUES(${quote(pullId)},${i},${quote(r.id)},${quote(JSON.stringify(summary))});`).join('\n')}
  `))
  await page.goto(origin+base+'/move-in')
  const region=page.getByRole('region',{name:'Zendesk pull',exact:true}),resume=region.getByRole('button',{name:'Resume pull',exact:true})
  await resume.waitFor()
  const stale=await readPull()
  assert.deepEqual([stale.state,stale.error,stale.approvedAt,stale.needsReplan],['ready',null,null,true])
  assert.equal((await get(api+'/zendesk/pulls'))[0].needsReplan,true,'the page list exposes old unapproved reviews')
  const capture=async state=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await inspect(`zendesk-resume-${state}-${width}`)}await page.setViewportSize({width:1440,height:1000})}
  await capture('older-review')
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`${api}/zendesk/pulls/${pullId}/resume`&&r.request().method()==='POST')
  await resume.click()
  const resumed=await response
  assert.equal(resumed.status(),202)
  const replanning=(await resumed.json()).data
  assert.equal(replanning.state,'reviewing')
  assert.ok(replanning.batches.slice(0,2).every(b=>b.state==='planning'&&b.summary===null),'both old reviews return to planning')
  for(const run of runs.slice(0,2)){
   const reviewed=await until(()=>readRun(run.id),r=>r.state==='ready'&&r.plan?.mappingRevision===currentRevision)
   assert.equal(reviewed.plan.mappingRevision,currentRevision,'the real planner writes the deployed mapping revision')
  }
  const current=await until(readPull,p=>p.state==='ready')
  assert.equal(current.needsReplan,false)
  assert.equal((await readRun(runs[2].id)).plan.fingerprint,runs[2].plan.fingerprint,'a current unapproved batch keeps its review')
  assert.deepEqual([(await readRun(runs[3].id)).state,(await readRun(runs[3].id)).plan.mappingRevision],['completed',oldRevision],'an older approved batch is never replanned')
  await resume.waitFor({state:'hidden'})
  await region.getByRole('heading',{name:'Ready for your approval',exact:true}).waitFor()
  await capture('current-review')
  await page.reload();await region.waitFor()
  assert.equal(await resume.count(),0,'a current pull has no mapping recovery action after reload')
  assert.equal((await get(api+'/zendesk/pulls'))[0].needsReplan,false)
  // A ready batch can carry an error left by an earlier delivery even though its
  // review is current and the pull itself has no error. The list is the page's
  // initial status source; no application response is intercepted or replaced.
  const runError='step_conflict'
  await runtime.restart(()=>runtime.execute(`UPDATE move_in_runs SET error=${quote(runError)} WHERE id=${ids[2]};`))
  await page.reload()
  const errored=await readPull(),listed=(await get(api+'/zendesk/pulls'))[0]
  assert.deepEqual([errored.state,errored.error,errored.approvedAt,errored.needsReplan],['ready',null,null,false])
  assert.equal(errored.batches[2].error,runError)
  assert.equal(listed.batches[2].error,runError,'the page list exposes the batch run error')
  await resume.waitFor()
  await capture('run-error')
  const recoveryResponse=page.waitForResponse(r=>new URL(r.url()).pathname===`${api}/zendesk/pulls/${pullId}/resume`&&r.request().method()==='POST')
  await resume.click()
  const recovering=await recoveryResponse
  assert.equal(recovering.status(),202)
  const recovery=(await recovering.json()).data
  assert.equal(recovery.state,'reviewing')
  assert.deepEqual([recovery.batches[2].state,recovery.batches[2].summary,recovery.batches[2].error],['planning',null,null],'the errored current review goes back to planning')
  const recoveredRun=await until(()=>readRun(runs[2].id),r=>r.state==='ready'&&r.plan?.mappingRevision===currentRevision)
  assert.equal(recoveredRun.error,null,'the real planner leaves the recovered run error-free')
  const recovered=await until(readPull,p=>p.state==='ready')
  assert.equal(recovered.error,null)
  assert.equal(recovered.needsReplan,false)
  assert.ok(recovered.batches.every(b=>b.error===null),'all batch run errors have cleared')
  assert.ok(recovered.batches.slice(0,3).every(b=>b.covered),'every unapproved batch is covered by the next approval')
  assert.deepEqual([(await readRun(runs[3].id)).state,(await readRun(runs[3].id)).plan.mappingRevision],['completed',oldRevision],'run-error recovery leaves the approved batch alone')
  await resume.waitFor({state:'hidden'})
  await region.getByRole('button',{name:/^Approve/}).waitFor()
  await capture('recovered')
  await page.reload();await region.waitFor()
  assert.equal(await resume.count(),0,'an error-free current pull has no recovery action after reload')
 }finally{
  await switchProject(originalProject)
  await page.goto(origin+`/projects/${originalProject}/move-in`)
 }
}
