import assert from 'node:assert/strict'
import {contextApp,model} from './app.mjs'

const fields=['upcoming_events','user_type','problem','solutions_needed','job','role','risk_profile','personality']
const claim=id=>({value:'developer',confidence:90,evidence_status:'supported',evidence_ids:[id]})
const profile=entry=>Object.fromEntries(fields.map(key=>[key,key==='user_type'?entry:{value:null,confidence:null,evidence_status:'unknown',evidence_ids:[]}]))
const packet=body=>{
 const user=body.input.filter(item=>item.role==='user').at(-1)
 const text=typeof user.content==='string'?user.content:user.content.map(part=>part.text??'').join('')
 assert.match(text,/^(evidence_packet|observed_activity): \{/)
 return JSON.parse(text.slice(text.indexOf('{')))
}

export async function assertMonitoringAttribution(c,subject,offered){
 const analysis=c.ai.calls.find(call=>call.name==='context_analysis')
 const source=packet(analysis.body)
 assert.equal(source.version,'monitoring-v1')
 assert.equal(source.direct_observations.length,8)
 assert.ok(source.direct_observations.every(item=>item.source==='direct_observation'&&item.text.startsWith('Payment declined')))
 assert.ok(source.historical_summaries.some(item=>item.source==='historical_summary'&&item.text==='Seven password reset failures were observed.'))
 assert.ok(source.direct_observations.every(item=>source.eligible_evidence_ids.includes(item.evidence_id)))
 const insights=(await c.context(`/${subject}/insights`,{status:200})).data
 const saved=insights.find(item=>item.id===offered.id)
 assert.equal(saved.content,offered.content)
 assert.deepEqual(JSON.parse(saved.evidence_ids),[source.direct_observations[0].evidence_id],'the delivered insight keeps its observed source attribution')
 const inventory=(await c.context('/insights',{status:200})).data.data.find(item=>item.id===offered.id)
 assert.deepEqual(inventory.evidence_ids,JSON.parse(saved.evidence_ids))
 assert.equal(inventory.subject_id,subject)
}

// Exercise missing CONTEXT-001 outcomes on the real native router and queue.
// Model output is supplied only at the provider network edge, including invalid answers.
export async function attributionJourney(){
 const c=await contextApp(),{app,ai,p}=c
 const read=async subject=>(await c.context(`/${subject}`,{status:200})).data
 const jobs=async subject=>(await c.context(`/${subject}/jobs`,{status:200})).data
 const run=async()=>{for(const job of await app.takeJobs())await app.runJobs([job])}
 const generate=async subject=>(await c.context(`/${subject}/generate/contact`,{body:{model},status:202})).data
 const evidence=async(subject,content,source='customer_message')=>(await c.context(`/${subject}/evidence`,{body:{source,content},status:201})).data.id
 const visitor=async name=>{const v=await c.visitor(name);await v.widget('contextConsent',{consent:true},200);return v}
 try{
  const v=await visitor('Attributed customer'),subject=v.contactId
  const id=await evidence(subject,'I am a developer'),attributed=claim(`message:${id}`)
  const before=await read(subject)
  assert.equal(before.version,'profile-evidence.v3');assert.equal(before.subjectId,subject);assert.equal(before.consent,true)
  assert.deepEqual(before.evidence.map(({id,source,content,visibility})=>({id,source,content,visibility})),[{id,source:'customer_message',content:'I am a developer',visibility:'private_operational_evidence'}])
  ai.answer=name=>{assert.equal(name,'context_profile');return profile(attributed)}
  const generated=await generate(subject);assert.ok(generated.id);await run()
  assert.equal((await jobs(subject)).find(job=>job.id===generated.id).state,'completed')
  const current=await read(subject)
  assert.deepEqual(current.profiles.contact.user_type,attributed,'native reads retain the generated claim and its exact source ID')
  assert.deepEqual(current.approved_broad_personalization,[{key:'user_type',value:'developer'}])
  assert.equal(current.profiles.contact._profile_meta.evidence_version,'profile-evidence.v3')
  assert.match(current.profiles.contact._profile_meta.evidence_fingerprint,/^[a-f0-9]{64}$/)

  const foreign=await app.seedWorkspace('context-foreign')
  const foreignPath=`/api/customer-context/${foreign.projectId}/${subject}`
  const foreignEvidence=(await app.call(`${foreignPath}/evidence`,{token:foreign.tokens.operator,body:{source:'customer_message',content:'FOREIGN PRIVATE MESSAGE'},status:201})).data.id
  // Both reads and writes require this project's current native operator authority.
  for(const [suffix,options] of [
   ['',{}],['/jobs',{}],['/insights',{}],
   ['/evidence',{body:{source:'customer_message',content:'cross-project write'}}],
   ['/consent',{method:'PUT',body:{consent:true}}],
   ['/monitoring',{method:'PUT',body:{enabled:true,helpTypes:['support']}}],
   ['/generate/contact',{body:{model}}],
   ['/profiles/contact',{method:'PUT',body:{profile:profile(attributed),evidenceFingerprint:before.evidence_fingerprint}}],
   ['/insights',{body:{content:'cross-project insight'}}],
  ])assert.equal((await app.call(foreignPath+suffix,{token:c.operator,...options})).status,403,suffix||'packet')
  assert.doesNotMatch(JSON.stringify(await read(subject)),/FOREIGN PRIVATE MESSAGE/)
  assert.equal((await c.context(`/${subject}/evidence`,{body:{source:'unapproved_source',content:'do not admit'}})).status,400)

  // Valid-shaped claims with invented or another project's IDs are ungrounded.
  // Invalid provider schemas must also fail before any profile is made usable.
  for(const [name,entry,error] of [
   ['invented evidence',claim('message:missing'),/unsupported evidence/i],
   ['foreign evidence',claim(`message:${foreignEvidence}`),/unsupported evidence/i],
   ['invalid schema',{...attributed,confidence:101},/confidence|100/],
  ]){
   const invalid=await visitor(name);await evidence(invalid.contactId,'I am a developer')
   ai.answer=()=>profile(entry)
   const queued=await generate(invalid.contactId);assert.ok(queued.id);await run()
   const result=(await jobs(invalid.contactId)).find(job=>job.id===queued.id)
   assert.equal(result.state,'uncertain',name);assert.match(result.error,error,name)
   assert.deepEqual((await read(invalid.contactId)).profiles.contact,{},'invalid output never becomes usable context')
  }

  // Bound the evidence the model actually receives, not just a pure builder result.
  const bounded=await visitor('Bounded customer'),ids=[]
  for(let i=0;i<26;i++)ids.push(await evidence(bounded.contactId,`Observation ${i}: I am a developer. `+'x'.repeat(1800)))
  let sent
  ai.answer=(_,body)=>{sent=packet(body);return profile(claim(sent.evidence.at(-1).id))}
  assert.ok((await generate(bounded.contactId)).id);await run()
  assert.equal(sent.evidence.length,24)
  assert.deepEqual(new Set(sent.evidence.map(item=>item.id)),new Set(ids.slice(-24).map(id=>`message:${id}`)))
  assert.ok(sent.evidence.every(item=>item.source==='customer_message'&&item.visibility==='private_operational_evidence'&&item.content.length<=1001))
  assert.doesNotMatch(JSON.stringify(sent),/FOREIGN PRIVATE MESSAGE/)
  const boundedPacket=await read(bounded.contactId)
  assert.ok(boundedPacket.evidence.every(item=>item.content.length<=1000))
  assert.deepEqual(boundedPacket.profiles.contact.user_type.evidence_ids,[sent.evidence.at(-1).id])

  // Contact profiling needs consent; approved public categories disappear on withdrawal.
  await v.widget('contextConsent',{consent:false},200)
  const calls=ai.calls.length
  assert.equal((await generate(subject)).reason,'consent_or_bot_disabled')
  const withdrawn=await read(subject);assert.equal(withdrawn.consent,false);assert.deepEqual(withdrawn.approved_broad_personalization,[])
  assert.equal(ai.calls.length,calls)

  // Invalid analysis and insight output cannot be delivered as proactive help.
  for(const invalidStage of ['analysis','insight']){
   const invalid=await visitor(`Invalid ${invalidStage}`)
   let selected
   ai.answer=(name,body)=>{
    if(name==='context_analysis'){
     const input=packet(body);selected=input.eligible_evidence_ids[0]
     assert.ok(input.direct_observations.every(item=>item.source==='direct_observation'))
     return {decision:'insight',help_type:invalidStage==='analysis'?'unconfigured':'support',evidence_ids:[selected],help:'Help with checkout'}
    }
    assert.equal(name,'context_insight')
    return {content:'Help with checkout?',buttons:[{text:'Dismiss',action:'close'}],loading:null,evidence_ids:[`action:${foreignEvidence}`]}
   }
   const queued=(await invalid.widget('collector',Array.from({length:7},(_,i)=>({localId:`bad-${i}`,action:`Checkout error ${i}`})),200)).data.job
   assert.ok(queued.id);await run()
   const result=(await jobs(invalid.contactId)).find(job=>job.id===queued.id)
   assert.equal(result.state,'uncertain');assert.match(result.error,invalidStage==='analysis'?/help_type|support/:/evidence|observations/i)
   assert.deepEqual((await invalid.widget('insights',{},200)).data.insights,[])
   assert.deepEqual((await c.context(`/${invalid.contactId}/insights`,{status:200})).data,[])
  }
 }finally{await c.close()}
}
