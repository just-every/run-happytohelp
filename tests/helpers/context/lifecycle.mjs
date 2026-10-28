import assert from 'node:assert/strict'
import {contextApp,model} from './app.mjs'

const fields=['upcoming_events','user_type','problem','solutions_needed','job','role','risk_profile','personality']
const unknown={value:null,confidence:null,evidence_status:'unknown',evidence_ids:[]}
const messageEvidence=body=>JSON.stringify(body).match(/message:[0-9a-f-]{36}/)[0]
const actionEvidence=body=>[...new Set(JSON.stringify(body).match(/action:[a-z0-9-]+/g)||[])]
const actions=(prefix,n)=>Array.from({length:n},(_,i)=>({localId:prefix+i,action:`Payment failed on checkout, attempt ${i}`}))

// A single customer's consent, evidence, profile and proactive offer move through
// the same persisted context. Rejected output and later revocation cannot replace it.
export async function contextLifecycle(){
 const c=await contextApp(),{app,ai,p,context}=c
 const run=async()=>{for(const job of await app.takeJobs()){await app.runJobs([job]);await app.runJobs([job])}}
 try{
  const v=await c.visitor('Avery'),subject=v.contactId
  const generate=()=>context(`/${subject}/generate/contact`,{body:{model}})
  const profile=async()=>JSON.parse((await app.first("SELECT profile FROM context_profiles WHERE subject_id=? AND type='contact'",subject))?.profile||'null')
  assert.equal((await generate()).data.reason,'consent_or_bot_disabled')
  assert.equal((await v.widget('collector',actions('unconsented',8),200)).data.accepted,0)
  await v.widget('contextConsent',{consent:true},200)
  const evidence=(await context(`/${subject}/evidence`,{body:{source:'customer_message',content:'I am a developer'},status:201})).data.id
  const answer=claim=>Object.fromEntries(fields.map(key=>[key,key==='user_type'?claim:unknown]))
  ai.answer=(_,body)=>answer({value:'developer',confidence:90,evidence_status:'supported',evidence_ids:[messageEvidence(body)]})
  await generate();await run()
  assert.equal((await profile()).user_type.value,'developer')
  const calls=ai.calls.length
  assert.equal((await generate()).data.reason,'unchanged_evidence');assert.equal(ai.calls.length,calls)
  // The same evidence is corrected. Unsupported output cannot turn a guess into a fact.
  await app.db.prepare("UPDATE context_evidence SET content='I am not a developer' WHERE id=?").bind(evidence).run()
  const age=()=>app.db.prepare("UPDATE context_profiles SET started_at=0 WHERE subject_id=? AND type='contact'").bind(subject).run()
  const job=async id=>(await context(`/${subject}/jobs`,{status:200})).data.find(row=>row.id===id)
  const knownProfile=await profile()
  await age();ai.answer=()=>({invented:'not a profile'})
  const invalid=(await generate()).data;assert.ok(invalid.id);await run()
  assert.deepEqual(await profile(),knownProfile,'schema-invalid output leaves the last usable profile intact')
  // The paid attempt already started before schema validation failed. Its
  // uncertain outcome holds this customer's next run until an operator reviews
  // and abandons it; resetting the cooldown alone cannot authorize another call.
  assert.equal((await job(invalid.id)).state,'uncertain')
  assert.equal((await context(`/${subject}/jobs/${invalid.id}/abandon`,{body:{reason:'Reviewed provider response: schema-invalid profile'},status:200})).data.abandoned,true)
  await age();ai.answer=(_,body)=>answer({value:null,confidence:null,evidence_status:'contradicted',evidence_ids:[messageEvidence(body)]})
  const corrected=(await generate()).data;assert.ok(corrected.id);await run()
  assert.equal((await job(corrected.id)).state,'completed')
  assert.equal((await profile()).user_type,undefined)

  // Operator drafts never enter monitoring packets. An attributable offer uses
  // only the consenting customer's selected activity and admits one reply pair.
  await context(`/${subject}/evidence`,{body:{source:'agent_message',content:'PRIVATE OPERATOR DRAFT'},status:201})
  ai.answer=(name,body)=>{
   const cited=actionEvidence(body)[0]
   return name==='context_analysis'?{decision:'insight',help_type:'support',evidence_ids:[cited],help:'Help with checkout'}:name==='context_insight'?{content:'Would you like help with checkout?',buttons:[{text:'Yes, help me',action:'send'},{text:'Dismiss',action:'close'}],loading:null,evidence_ids:[cited]}:{summary:'Checkout failures were observed.'}
  }
  await v.widget('collector',actions('checkout',8),200);await run()
  const analysis=ai.calls.findLast(call=>call.name==='context_analysis')
  assert.doesNotMatch(JSON.stringify(analysis.body),/PRIVATE OPERATOR DRAFT/)
  assert.match(JSON.stringify(analysis.body),/untrusted/i)
  const offered=(await v.widget('insights',{},200)).data.insights
  assert.equal(offered.length,1)
  const inventory=(await context('/insights',{status:200})).data.data
  assert.ok(inventory.some(row=>row.id===offered[0].id))
  const foreign=await app.seedWorkspace('foreign-context')
  assert.equal((await app.call(`/api/customer-context/${foreign.projectId}/insights`,{token:c.operator})).status,403)
  const other=await c.visitor('Other visitor')
  assert.equal((await app.call(`/api/conversations/${v.conversationId}/widget-events`,{token:other.token,body:{action:'insights',data:{}}})).status,404)
  const use=(text,localId)=>v.widget('useInsight',{insight_id:offered[0].id,text,local_id:localId,ai_message:{local_id:localId+'-ai'}})
  assert.equal((await use('Forged choice','forged')).status,400)
  assert.equal((await use('Yes, help me','accepted')).status,200)
  assert.equal((await use('Yes, help me','accepted')).data.duplicate,true)
  await app.takeJobs()
  const transcript=(await app.ok(`/api/conversations/${v.conversationId}/messages`,{token:v.token})).messages
  assert.deepEqual(transcript.slice(-2).map(m=>m.content),[offered[0].content,'Yes, help me'])
  await v.widget('dismissInsight',offered[0].id,200)
  assert.deepEqual((await v.widget('insights',{},200)).data.insights,[])

  // Analysis sees recent activity; compaction drains the oldest bounded window
  // and retains every unselected row, including actions with equal timestamps.
  await other.widget('contextConsent',{consent:true},200)
  ai.answer=name=>name==='context_summary'?{summary:'Repeated checkout failures.'}:{decision:'no_insight',help_type:null,evidence_ids:[],help:null}
  const start=ai.calls.length,total=70
  await other.widget('collector',actions('bounded',total),200)
  const retainedActions=()=>app.sql('SELECT id,action FROM context_actions WHERE project_id=? AND subject_id=? ORDER BY occurred_at,id',p,other.contactId)
  const collected=await retainedActions();assert.equal(collected.length,total)
  await run()
  const packets=ai.calls.slice(start).filter(call=>['context_analysis','context_summary'].includes(call.name))
  assert.deepEqual(packets.map(packet=>packet.name),['context_analysis','context_summary'])
  const analysed=actionEvidence(packets[0].body),compacted=actionEvidence(packets[1].body)
  for(const selected of [analysed,compacted])assert.ok(selected.length>0&&selected.length<total,'each request has a bounded evidence window')
  const evidenceIds=rows=>rows.map(row=>'action:'+row.id)
  assert.deepEqual(analysed,evidenceIds(collected.slice(-analysed.length)),'analysis receives the newest observed activity in deterministic order')
  assert.deepEqual(compacted,evidenceIds(collected.slice(0,compacted.length)),'summary receives the oldest observed activity in deterministic order')
  assert.deepEqual(await retainedActions(),collected.slice(compacted.length),'compaction removes exactly its selected rows and preserves all remaining action data')
  const summaries=await app.sql('SELECT evidence_ids FROM context_summaries WHERE project_id=? AND subject_id=?',p,other.contactId)
  assert.equal(summaries.length,1)
  assert.deepEqual(JSON.parse(summaries[0].evidence_ids),compacted,'the saved summary attributes exactly the evidence it received')

  // A profile finishing after withdrawal writes nothing. An interrupted paid
  // attempt stays uncertain and its queued redelivery makes no provider request.
  await age();await app.db.prepare("UPDATE context_evidence SET content='A new customer fact' WHERE id=?").bind(evidence).run()
  ai.answer=async(_,body)=>{await context(`/${subject}/consent`,{method:'PUT',body:{consent:false},status:200});return answer({value:'developer',confidence:90,evidence_status:'supported',evidence_ids:[messageEvidence(body)]})}
  const stale=(await generate()).data;await run()
  assert.equal((await app.first('SELECT state FROM context_jobs WHERE id=?',stale.id)).state,'superseded')
  assert.equal((await profile()).user_type,undefined)
  await context(`/${subject}/consent`,{method:'PUT',body:{consent:true},status:200});await age()
  const pending=(await generate()).data,queued=await app.takeJobs()
  await app.db.prepare("UPDATE context_jobs SET state='running',started_at=0,provider_started=1 WHERE id=?").bind(pending.id).run()
  const beforeRecovery=ai.calls.length;await app.scheduled();await app.runJobs(queued)
  assert.equal(ai.calls.length,beforeRecovery)
  assert.equal((await app.first('SELECT state FROM context_jobs WHERE id=?',pending.id)).state,'uncertain')
  assert.equal((await context(`/${subject}/jobs/${pending.id}/abandon`,{body:{reason:'Reviewed provider history'},status:200})).data.abandoned,true)
 }finally{await c.close()}
}
