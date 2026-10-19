import assert from 'node:assert/strict'

export async function ticketQueue(f){
 const {app,w,foreign,ok,call,get,patch,create}=f
 const ids=[]
 for(let i=0;i<37;i++){const id=await create(i+1);ids.push(id);await patch(id,{subject:`Order ${i}`,priority:i%2?'high':'normal',fields:{[f.fields[1].id]:i+1}})}
 const filters=[{field:'status_category',operator:'ne',value:'closed'},{field:'custom:'+f.fields[1].id,operator:'gte',value:1}],sort=[{field:'custom:'+f.fields[1].id,direction:'asc'}]
 const view=await ok('/ticket-views',{name:'Returns by pair count',visibility:'shared',filters,sort})
 const page=async n=>ok(`/conversations?saved_view=${view.id}&page=${n}`)
 const first=await page(1),second=await page(2)
 assert.equal(first.length,30);assert.equal(second.length,7)
 assert.deepEqual([...first,...second].map(t=>t.fields[f.fields[1].id]),Array.from({length:37},(_,i)=>i+1))
 const personal=await ok('/ticket-views',{name:'My urgent work',visibility:'personal',filters:[{field:'priority',operator:'eq',value:'urgent'}],sort:[]},'operator')
 assert.equal((await call('/ticket-views/'+personal.id)).status,404)
 assert.equal((await call('/ticket-views',{name:'Forbidden shared',visibility:'shared',filters:[],sort:[]},'operator')).status,403)
 const restricted=await ok('/ticket-views',{name:'Private address',visibility:'shared',filters:[{field:'custom:'+f.privateField.id,operator:'eq',value:'Dana private return address'}],sort:[]})
 const restrictedRead=(await call('/ticket-views/'+restricted.id,undefined,'operator')).data
 assert.ok(!JSON.stringify(restrictedRead).includes('Dana private return address'))
 assert.equal((await call(`/conversations?saved_view=${restricted.id}`,undefined,'operator')).status,403)
 const tag=await ok(`/conversations/${ids[3]}/tags`,{name:'Needs replacement'})
 const selected=await Promise.all(ids.slice(0,2).map(async id=>({id,expected_version:(await get(id)).ticket_version})))
 const stranger=(await app.ok('/api/identity/widget/session',{body:{widgetKey:foreign.widgetKey},headers:{Origin:foreign.allowedOrigin}}))
 const foreignTicket=await app.ok('/api/conversations',{body:{projectId:foreign.projectId},token:stranger.token})
 const body={tickets:[...selected,{id:foreignTicket.id,expected_version:0}],changes:{assigned_to:w.users.operator,priority:'urgent',status_id:'pending',add_tags:[tag.id]}}
 const before=(await get(ids[0])).priority
 const preview=await ok('/tickets/bulk/preview',body)
 assert.deepEqual(preview.results.map(r=>r.status),['ready','ready','forbidden']);assert.equal((await get(ids[0])).priority,before)
 await patch(ids[1],{subject:'Changed while preview was open'})
 const result=await ok('/tickets/bulk/apply',body)
 assert.deepEqual(result.results.map(r=>r.status),['applied','stale','forbidden'])
 assert.equal((await get(ids[0])).priority,'urgent');assert.equal((await get(ids[0])).status_category,'pending')
 assert.equal((await get(ids[1])).priority,'high');assert.equal((await app.first('SELECT status_category FROM conversations WHERE id=?',foreignTicket.id)).status_category,'new')
 assert.ok(await app.first('SELECT 1 FROM conversation_tags WHERE conversation_id=? AND tag_id=?',ids[0],tag.id))
 // A later audit failure rolls back its ticket, while earlier committed
 // tickets retain both their change and receipt in the per-ticket response.
 const auditTickets=await Promise.all(ids.slice(4,6).map(async id=>({id,expected_version:(await get(id)).ticket_version})))
 const untouched=await get(auditTickets[1].id)
 await app.db.prepare(`CREATE TRIGGER refuse_bulk_receipt BEFORE INSERT ON audit_events WHEN NEW.action='ticket.bulk.apply' AND NEW.target_id='${auditTickets[1].id}' BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END`).run()
 try{
  const response=await call('/tickets/bulk/apply',{tickets:auditTickets,changes:{priority:'urgent'}})
  assert.equal(response.status,200)
  assert.deepEqual(response.data.data.results.map(r=>r.status),['applied','failed'])
  assert.equal((await get(auditTickets[0].id)).priority,'urgent')
  assert.equal((await get(auditTickets[1].id)).ticket_version,untouched.ticket_version)
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.bulk.apply' AND target_id=? AND outcome='succeeded'",auditTickets[0].id)).n,1)
 }finally{await app.db.prepare('DROP TRIGGER refuse_bulk_receipt').run()}
 const resumed=await ok('/tickets/bulk/apply',{tickets:[auditTickets[1]],changes:{priority:'urgent'}})
 assert.equal(resumed.results[0].status,'applied')
 assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.bulk.apply' AND target_id=? AND outcome='succeeded'",auditTickets[1].id)).n,1)
 // Overflow is a durable queue continuation, with the same native guards and
 // stable receipts when the queue redelivers an already completed chunk.
 const overflow=Array.from({length:100},(_,i)=>({id:`overflow-bulk-${i}`,expected_version:0}))
 await app.db.batch(overflow.map(ticket=>app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,subject,created_at,updated_at) SELECT ?,project_id,contact_id,?,created_at,updated_at FROM conversations WHERE id=?').bind(ticket.id,'Replacement batch '+ticket.id,ids[0])))
 const overflowResult=await ok('/tickets/bulk/apply',{tickets:overflow,changes:{assigned_to:w.users.operator}})
 assert.ok(overflowResult.results.every(r=>['applied','queued'].includes(r.status)),JSON.stringify(overflowResult))
 const continuationJobs=(await app.takeJobs()).filter(job=>job.type==='ticket.batch')
 for(const job of continuationJobs){const ran=await app.runJobs([job]);assert.deepEqual(ran.retried,[]);const replayed=await app.runJobs([job]);assert.deepEqual(replayed.retried,[])}
 for(const ticket of overflow){
  assert.equal((await get(ticket.id)).assigned_to,w.users.operator)
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.bulk.apply' AND target_id=? AND outcome='succeeded'",ticket.id)).n,1)
 }
 // Failure rows stay in this journey: each starts with real request overflow,
 // commits two queued tickets, then loses one statement or the invocation.
 for(const [index,{fault,recovery}] of [
  {fault:'db-once',recovery:'queue'},{fault:'db-once',recovery:'cron'},
  {fault:'db-interrupt',recovery:'queue'},{fault:'db-interrupt',recovery:'cron'},
 ].entries()){
  const selection=await app.sql('SELECT id,ticket_version expected_version FROM conversations WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',JSON.stringify(overflow.map(ticket=>ticket.id)))
  const priority=index%2?'urgent':'high'
  const accepted=await ok('/tickets/bulk/apply',{tickets:selection,changes:{priority}})
  const queued=accepted.results.filter(result=>result.status==='queued')
  assert.ok(queued.length>3,'the fault runs after overflow has durably queued several tickets')
  const batchId=queued[0].batch_id,wake=(await app.takeJobs()).find(job=>job.type==='ticket.batch'&&job.id===batchId)
  assert.ok(wake,'durable acceptance also emits its queue wakeup')
  const read=()=>app.first('SELECT * FROM ticket_batch_jobs WHERE id=?',batchId)
  const original=await read(),pending=JSON.parse(original.selection_json)
  assert.equal(original.state,'pending');assert.equal(original.cursor,0)
  const failedRun=await app.runJobs([wake],{'x-test-fault':fault,'x-test-statement':fault==='db-once'?'INSERT INTO ticket_history':'UPDATE ticket_batch_jobs SET cursor=cursor\\+1','x-test-statement-at':fault==='db-once'?'3':'2'})
  assert.deepEqual(failedRun.retried,fault==='db-interrupt'?[0]:[])
  const partial=await read(),outcomes=JSON.parse(partial.results_json),pendingIds=new Set(pending.map(ticket=>ticket.id))
  const progressed=outcomes.filter(result=>pendingIds.has(result.id)&&result.status==='applied')
  assert.equal(partial.state,'pending');assert.ok(partial.cursor>=2)
  assert.ok(progressed.length>=2&&progressed.length<pending.length,'the failure happens after queued progress and before completion')
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.bulk.apply' AND target_id=? AND outcome='succeeded' AND json_extract(detail_json,'$.batch_id')=?",pending[0].id,batchId)).n,1)
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.batch' AND target_id=?",batchId)).n,0,'a pending job has no terminal receipt')
  if(fault==='db-once'){
   assert.equal(outcomes.find(result=>result.id===pending[2].id).status,'retry')
   assert.equal(outcomes.find(result=>result.id===pending[2].id).attempts,1)
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.bulk.apply' AND target_id=? AND outcome='succeeded' AND json_extract(detail_json,'$.batch_id')=?",pending[2].id,batchId)).n,0,'the transient failure rolls back its ticket receipt')
   assert.ok(pending.slice(3).some(ticket=>outcomes.find(result=>result.id===ticket.id).status==='applied'),'the transient failure does not abandon later tickets')
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.batch.failed' AND target_id=? AND outcome='failed' AND json_extract(detail_json,'$.batch_id')=? AND json_extract(detail_json,'$.retryable')=1",pending[2].id,batchId)).n,1)
  }
  if(recovery==='cron'){
   await app.configure({})
   assert.deepEqual(await app.takeJobs(),[],'the restarted Worker has lost every in-memory wakeup')
  }
  for(let attempt=0;attempt<32&&(await read()).state==='pending';attempt++){
   if(recovery==='cron')assert.equal((await app.scheduled()).ran,true)
   else assert.deepEqual((await app.runJobs([wake])).retried,[],'queue redelivery uses the original message')
  }
  const completed=await read()
  assert.equal(completed.state,'complete',`${fault} resumes through ${recovery}`)
  assert.ok(JSON.parse(completed.results_json).every(result=>result.status==='applied'))
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.batch' AND target_id=? AND outcome='succeeded'",batchId)).n,1)
  assert.deepEqual((await app.runJobs([wake])).retried,[])
  for(const ticket of selection){
   assert.equal((await get(ticket.id)).priority,priority)
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.bulk.apply' AND target_id=? AND outcome='succeeded' AND json_extract(detail_json,'$.batch_id')=?",ticket.id,batchId)).n,1,'recovery preserves exactly one native ticket receipt')
  }
 }
 // Lost wakeups force cron to finish the selection near its own statement
 // ceiling. Assignment delivery must still commit every inbox/mail outcome.
 for(const [size,assignee] of [[92,w.users.admin],[100,w.users.operator]]){
  await app.configure({EMAIL_PROVIDER:'development',EMAIL_API_KEY:undefined,EMAIL_FROM:undefined})
  if(size===100)for(const ticket of overflow.slice(92))await patch(ticket.id,{assigned_to:w.users.admin})
  const selected=await app.sql('SELECT id,ticket_version expected_version FROM conversations WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',JSON.stringify(overflow.slice(0,size).map(ticket=>ticket.id)))
  const prior=new Set((await app.sql("SELECT id FROM operator_notifications WHERE kind='assignment'")).map(row=>row.id))
  await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'bulk-provider-fixture',EMAIL_FROM:'support@example.test'})
  const accepted=await ok('/tickets/bulk/apply',{tickets:selected,changes:{assigned_to:assignee}})
  const queued=accepted.results.filter(row=>row.status==='queued')
  assert.ok(queued.length>0,'the request durably overflows before cron takes over')
  const batchId=queued[0].batch_id
  assert.ok((await app.takeJobs()).some(job=>job.type==='ticket.batch'&&job.id===batchId))
  const read=()=>app.first('SELECT * FROM ticket_batch_jobs WHERE id=?',batchId)
  for(let tick=0;tick<8&&(await read()).state==='pending';tick++){
   const result=await app.scheduled();assert.equal(result.refused,0);assert.equal(result.pruned,true)
   assert.ok(Object.values(result.consumers).every(consumer=>consumer.completed))
   await app.takeJobs()
  }
  assert.equal((await read()).state,'complete');assert.ok((await read()).recovery_ticks>=2)
  for(let tick=0;tick<3;tick++){const result=await app.scheduled();assert.equal(result.refused,0);await app.takeJobs()}
  const assignments=(await app.sql("SELECT o.id,n.state,n.inbox FROM operator_notifications o LEFT JOIN notification_inbox n ON n.id=o.id WHERE o.kind='assignment'")).filter(row=>!prior.has(row.id))
  assert.equal(assignments.length,size)
  for(const notice of assignments){
   assert.equal(notice.inbox,1);assert.equal(notice.state,'sent')
   assert.equal(f.notices.filter(mail=>mail.key===notice.id).length,1,'each assignment reaches the provider exactly once')
  }
  for(const ticket of selected){
   assert.equal((await get(ticket.id)).assigned_to,assignee)
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.bulk.apply' AND target_id=? AND outcome='succeeded' AND json_extract(detail_json,'$.batch_id')=?",ticket.id,batchId)).n,1)
  }
 }
 f.queueIds=ids
}
