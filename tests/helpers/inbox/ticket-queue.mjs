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
 f.queueIds=ids
}
