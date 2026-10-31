import assert from 'node:assert/strict'
import {contextApp,model} from './app.mjs'
import {assertMonitoringAttribution} from './attribution.mjs'

const evidenceIds=body=>[...new Set(JSON.stringify(body).match(/action:[a-z0-9-]+/g)||[])]
const actions=(prefix,count,text)=>Array.from({length:count},(_,i)=>({localId:`${prefix}${i}`,action:`${text} ${i}`}))

// Proactive help from a consenting visitor's widget activity, through the widget events door and the queue.
export async function monitoringJourney(){
 const c=await contextApp(),{app,ai,p}=c
 const count=(table,where='1=1',...args)=>app.first(`SELECT count(*) n FROM ${table} WHERE ${where}`,...args).then(row=>row.n)
 const runAll=async(twice=false)=>{for(const job of await app.takeJobs()){await app.runJobs([job]);if(twice)await app.runJobs([job])}}
 try{
  const v=await c.visitor('Monitored visitor'),subject=v.contactId
  // Nothing is collected before the visitor consents; consent is the visitor's own decision.
  assert.equal((await v.widget('collector',actions('early',2,'Clicked'),200)).data.accepted,0)
  assert.equal((await v.widget('contextConsent',{consent:true},200)).data.monitoring.enabled,true)
  await c.context(`/${subject}/evidence`,{body:{source:'agent_message',content:'AGENT DRAFT NEVER IN MONITORING'},status:201})
  // Idle telemetry is not evidence; activity is counted once per local id and analysed once due.
  assert.equal((await v.widget('collector',[{localId:'idle',action:'Detected extended inactivity (120 seconds without interaction) - User may be hesitating.'}],200)).data.accepted,0)
  assert.equal((await v.widget('collector',actions('a',5,'Password reset failed step'),200)).data.job.reason,'awaiting_activity')
  assert.ok((await v.widget('collector',[{localId:'a5',action:'Password reset failed step 5'},{localId:'a6',action:'Password reset failed step 6'},{localId:'a0',action:'duplicate'}],200)).data.job.id)
  assert.equal((await app.first('SELECT actions_count FROM context_collectors WHERE subject_id=?',subject)).actions_count,7)
  // No insight: one analysis and one summary even when the job is delivered twice; activity compacts into the summary.
  ai.answer=name=>name==='context_summary'?{summary:'Seven password reset failures were observed.'}:{decision:'no_insight',help_type:null,evidence_ids:[],help:null}
  await runAll(true);assert.deepEqual(ai.calls.map(call=>call.name),['context_analysis','context_summary'])
  const analysis=JSON.stringify(ai.calls[0].body);assert.match(analysis,/untrusted/i,'activity is labelled untrusted for the model');assert.doesNotMatch(analysis,/AGENT DRAFT NEVER IN MONITORING/)
  assert.equal(await count('context_insights'),0,'no fabricated insight');assert.equal(await count('context_actions','subject_id=?',subject),0);assert.equal(await count('context_summaries','subject_id=?',subject),1)
  // A burst arriving just after a run waits for the schedule; the widget's concurrent retries then admit exactly one run.
  assert.equal((await v.widget('collector',actions('b',8,'Payment declined'),200)).data.job.reason,'schedule_gate')
  await app.db.prepare('UPDATE context_collectors SET last_run_at=0 WHERE subject_id=?').bind(subject).run();ai.calls.length=0
  const retries=await Promise.all([v.widget('pingAction',{},200),v.widget('pingAction',{},200)]);assert.equal(retries.filter(retry=>retry.data.job?.id).length,1,'one run for concurrent retries')
  assert.equal(await count('context_jobs',"state='queued'"),1)
  // The burst is analysed with the historical summary, and an attributable insight is offered to the visitor.
  ai.answer=(name,body)=>{const evidence=evidenceIds(body)[0];return name==='context_analysis'?{decision:'insight',help_type:'support',evidence_ids:[evidence],help:'Help with payment'}:name==='context_insight'?{content:'Would you like help with your payment?',buttons:[{text:'Yes, help me',action:'send'},{text:'Dismiss',action:'close'}],loading:null,evidence_ids:[evidence]}:{summary:'Payment errors were observed.'}}
  await runAll();assert.match(JSON.stringify(ai.calls[0].body),/Seven password reset failures were observed/,'the historical summary informs the next analysis')
  const offered=(await v.widget('insights',{},200)).data.insights;assert.equal(offered.length,1);assert.equal(offered[0].content,'Would you like help with your payment?')
  await assertMonitoringAttribution(c,subject,offered[0])
  // Choosing an offered response admits the insight and the visitor's reply as one pair, once; a forged response is refused.
  const use=(text,localId)=>app.call(`/api/conversations/${v.conversationId}/widget-events`,{token:v.token,body:{action:'useInsight',data:{insight_id:offered[0].id,text,local_id:localId,ai_message:{local_id:localId+'-ai'}}}})
  assert.equal((await use('Forged button','forged')).status,400)
  const pair=await use('Yes, help me','use-1');assert.equal(pair.status,200,JSON.stringify(pair.data));assert.equal(pair.data.messages.length,2)
  assert.equal((await use('Yes, help me','use-1')).data.duplicate,true);await app.takeJobs()
  const transcript=(await app.call(`/api/conversations/${v.conversationId}/messages`,{token:v.token,status:200})).data.messages.map(message=>message.content)
  assert.deepEqual(transcript.slice(-2),['Would you like help with your payment?','Yes, help me'])
  const displayed=(await app.call(`/api/dashboard/projects/${p}/conversations/${v.conversationId}/buckets`,{token:c.workspace.tokens.owner,status:200})).data.data
  assert.deepEqual(displayed.flatMap(bucket=>bucket.messages).filter(message=>pair.data.messages.some(admitted=>admitted.id===message.id)).map(message=>message.content),['Would you like help with your payment?','Yes, help me'])
  // A dismissed insight stays dismissed, and stops further model requests for that visitor.
  assert.equal((await v.widget('dismissInsight',offered[0].id,200)).data.dismissed,true);assert.deepEqual((await v.widget('insights',{},200)).data.insights,[])
  await app.db.prepare('UPDATE context_collectors SET last_run_at=0 WHERE subject_id=?').bind(subject).run();const calls=ai.calls.length
  await v.widget('collector',actions('c',8,'New issue'),200);await runAll();assert.equal(ai.calls.length,calls,'dismissal blocks model requests')
  // Page visits are tracked once; other event types and other visitors' conversations are refused.
  const page=[{localId:'page',type:'PAGE_VIEW',payload:{url:'/help'}},{localId:'ignored',type:'UNSUPPORTED',payload:{}}]
  assert.equal((await v.widget('saveEvents',page,200)).data.counts[0].count,1);assert.equal((await v.widget('saveEvents',page.slice(0,1),200)).data.counts[0].count,1)
  const other=await c.visitor('Other visitor')
  assert.equal((await app.call(`/api/conversations/${v.conversationId}/widget-events`,{token:other.token,body:{action:'collector',data:actions('x',1,'cross')}})).status,404)

  const packet=(await c.context(`/${subject}`,{status:200})).data
  assert.equal((await c.context(`/${subject}/profiles/contact`,{method:'PUT',body:{evidenceFingerprint:packet.evidence_fingerprint,profile:{user_type:{value:'Unsupported claim',confidence:90,evidence_status:'supported',evidence_ids:['foreign-evidence']}}}})).status,409)
  // The same customer's current evidence becomes an attributed profile. Re-reading
  // unchanged evidence is free, and withdrawal of consent fences a running answer.
  const fields=['upcoming_events','user_type','problem','solutions_needed','job','role','risk_profile','personality']
  const unknown={value:null,confidence:null,evidence_status:'unknown',evidence_ids:[]}
  const profile=async()=>JSON.parse((await app.first("SELECT profile FROM context_profiles WHERE subject_id=? AND type='contact'",subject))?.profile||'null')
  const generate=async()=>(await c.context(`/${subject}/generate/contact`,{body:{model},status:202})).data
  const evidence=(await c.context(`/${subject}/evidence`,{body:{source:'customer_message',content:'I am a developer'},status:201})).data.id
  const answer=(body,value,status='supported')=>Object.fromEntries(fields.map(key=>[key,key==='user_type'?{value,confidence:value?90:null,evidence_status:status,evidence_ids:[`message:${evidence}`]}:unknown]))
  ai.answer=(_,body)=>answer(body,'developer')
  assert.ok((await generate()).id);await runAll(true)
  assert.equal((await profile()).user_type.value,'developer')
  const used=ai.calls.length;assert.equal((await generate()).reason,'unchanged_evidence');assert.equal(ai.calls.length,used)
  await app.db.prepare("UPDATE context_evidence SET content='I am not a developer' WHERE id=?").bind(evidence).run()
  await app.db.prepare("UPDATE context_profiles SET started_at=0 WHERE subject_id=? AND type='contact'").bind(subject).run()
  ai.answer=(_,body)=>answer(body,null,'contradicted')
  assert.ok((await generate()).id);await runAll();assert.equal((await profile()).user_type,undefined)
  await app.db.prepare("UPDATE context_evidence SET content='New fact' WHERE id=?").bind(evidence).run()
  await app.db.prepare("UPDATE context_profiles SET started_at=0 WHERE subject_id=? AND type='contact'").bind(subject).run()
  ai.answer=async(_,body)=>{await v.widget('contextConsent',{consent:false},200);return answer(body,'developer')}
  const withdrawn=await generate();await runAll()
  assert.equal((await app.first('SELECT state FROM context_jobs WHERE id=?',withdrawn.id)).state,'superseded')
  assert.equal((await profile()).user_type,undefined)
  await v.widget('contextConsent',{consent:true},200)
  await app.db.prepare("UPDATE context_profiles SET started_at=0 WHERE subject_id=? AND type='contact'").bind(subject).run()
  const interrupted=await generate(),[wake]=await app.takeJobs()
  await app.db.prepare("UPDATE context_jobs SET state='running',started_at=0,provider_started=1 WHERE id=?").bind(interrupted.id).run()
  await app.scheduled();const beforeReplay=ai.calls.length;await app.runJobs([wake])
  assert.equal(ai.calls.length,beforeReplay)
  assert.equal((await app.first('SELECT state FROM context_jobs WHERE id=?',interrupted.id)).state,'uncertain')
  assert.equal((await c.context(`/${subject}/jobs/${interrupted.id}/abandon`,{body:{reason:'Provider outcome reviewed'},status:200})).data.abandoned,true)
  const inventory=(await c.context('/insights',{status:200})).data
  assert.ok(!JSON.stringify(inventory).includes('Other visitor'))
  assert.equal((await app.call(`/api/customer-context/${p}/insights`,{token:other.token})).status,403)
  await c.context(`/${other.contactId}/evidence`,{body:{source:'customer_message',content:'I run a shop'},status:201})
  await other.widget('contextConsent',{consent:true},200)
  await app.configure({AI_DAILY_CEILINGS:JSON.stringify({contextRunsPerProject:1})})
  const limited=(await other.widget('collector',actions('limited',7,'Needs help'),200)).data
  assert.equal(limited.job.reason,'daily_ceiling');assert.equal(ai.calls.length,beforeReplay)
  const last=(await c.context(`/${other.contactId}/generate/contact`,{body:{model},status:202})).data;assert.ok(last.id)
  const deletedWork=await app.takeJobs(),beforeDeletion=ai.calls.length
  await app.call(`/api/management/projects/${p}`,{token:c.workspace.tokens.owner,method:'DELETE',status:200})
  await app.runJobs(deletedWork);assert.equal(ai.calls.length,beforeDeletion)
 }finally{await c.close()}
}
