import {nativeSnapshot,assertRepeatSurvival} from '../helpers/zendesk-diagnostics/snapshot.mjs'
import {diagnosticsAuthority} from '../helpers/zendesk-diagnostics/authority.mjs'
import {linkageObservations} from '../helpers/zendesk-diagnostics/linkage.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {nativeHarness} from '../move-in/harness.mjs'
import {rows} from '../move-in/journey-kit.mjs'
import {assertCutoverCounts,assertCutoverDerived} from '../helpers/cutover/oracle.mjs'
import {cutoverRebuildSql} from '../../scripts/installer/cutover-bounds-sql.mjs'
import {fakeZendesk,largeComments,SUBDOMAIN,CLIENT_ID,PATH_TOKEN,QUERY_TOKEN,ATTACHMENT_BYTES} from '../move-in/zendesk-pull-fixture.mjs'

const api='/api/move-in/projects/p',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const secretish=/synthetic-(?:access|refresh|code)-\d|synthetic-hh-(?:path|query)-token/
// Steps every queued job; a pull waiting on Zendesk's Retry-After or its incremental window has a persisted next_at.
// hold sets jobs aside until the rest have run, as a slow queue would deliver them; retries
// allows a job that fails outright (the queue retries it).
async function drain(h,{hold,retries=false}={}){
 let steps=0,maxStatements=0;const held=[]
 while(h.queued.length){
  assert.ok(steps++<3000,'pull finishes in bounded steps')
  const job=h.queued[0]
  if(hold?.(job)){held.push(h.queued.shift());continue}
  if(job.type==='move-in.zendesk'){const [pull]=await rows(h,'SELECT next_at FROM move_in_zendesk_pulls WHERE id=?',job.id);const wait=(pull?.next_at??0)-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait+20))}
  const result=await h.step();assert.deepEqual(result.effects,{widget:0});if(!retries)assert.deepEqual(result.retried,[]);maxStatements=Math.max(maxStatements,result.statements)
 }
 h.queued.push(...held)
 return {steps,maxStatements}
}
const pullOf=async(h,id)=>(await h.call(`${api}/zendesk/pulls/${id}`)).data
const sourceIds=async h=>(await rows(h,'SELECT source_id,COUNT(*) n FROM move_in_conversations GROUP BY source_id ORDER BY CAST(source_id AS INTEGER)')).map(r=>[r.source_id,r.n])
// Every ticket the pull saw is deleted in Zendesk, imported, refused, already imported or kept as imported.
const accounted=(t,kept)=>t.deleted+t.imported+t.refused+t.alreadyImported+kept.tickets
async function connect(h,zendesk){
 const consent=zendesk.consent((await h.call(`${api}/zendesk/connect`,post({subdomain:SUBDOMAIN,clientId:CLIENT_ID}))).url)
 assert.equal((await h.raw(`/api/move-in/zendesk/callback?${new URLSearchParams({code:consent.code,state:consent.state})}`)).response.status,302)
}
// A transient D1 failure while work runs: the statement the trigger names fails, as on a
// database hiccup, and the import engine records it on the batch's run.
async function failing(h,when,work){
 await h.db.prepare(`CREATE TRIGGER synthetic_d1_failure ${when} BEGIN SELECT RAISE(ABORT,'synthetic transient failure'); END`).run()
 try{return await work()}finally{await h.db.prepare('DROP TRIGGER synthetic_d1_failure').run()}
}
const whileParsing=filename=>`BEFORE INSERT ON move_in_records WHEN (SELECT filename FROM move_in_runs WHERE id=NEW.run_id)='${filename}'`
// The reviewer's session ends, then the reviewer signs in again with a new one.
const endSession=(h,actor='owner')=>h.db.prepare("UPDATE sessions SET revoked_at=? WHERE actor_id=? AND revoked_at IS NULL").bind(Date.now(),actor).run()
async function signIn(h,actor='owner',role='owner'){
 const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex')
 await h.db.batch([h.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,'p',?,?)").bind(hash,actor,role,Date.now()+86400000),h.db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(hash,actor,Date.now())])
 h.rememberSession(actor,token)
}
// Another member of the workspace, signed in.
async function addMember(h,actor,role){
 await h.db.batch([h.db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,1)').bind(actor,`${actor}@example.test`,actor),h.db.prepare("INSERT INTO memberships VALUES('p',?,?)").bind(actor,role)])
 await signIn(h,actor,role)
}

test('an owner connects Zendesk with PKCE, pulls the whole account, approves once, finds tickets by id, catches up new replies and tickets, and pulls again after an undo',{timeout:600_000},async()=>{
 const zendesk=fakeZendesk(),h=await nativeHarness({network:zendesk.handler,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'}})
 try{
  const empty=await nativeSnapshot(h)
  assert.ok(empty.complete);assert.deepEqual(empty.tickets,[]);assert.deepEqual(empty.articles,[])
  assert.ok(Object.values(empty.summary).every(value=>value===0))
  await diagnosticsAuthority(h,{addMember,endSession,signIn})

  // Connect: a public PKCE client, a single-use state bound to this session and workspace.
  assert.equal((await h.raw(`${api}/zendesk/connect`,{...post({subdomain:SUBDOMAIN,clientId:CLIENT_ID}),actor:'operator'})).response.status,403)
  const {url}=await h.call(`${api}/zendesk/connect`,post({subdomain:SUBDOMAIN.toUpperCase(),clientId:CLIENT_ID}))
  const consent=zendesk.consent(url)
  assert.equal(consent.redirectUri,'https://app.example/api/move-in/zendesk/callback')
  const callback=query=>`/api/move-in/zendesk/callback?${new URLSearchParams(query)}`
  assert.equal((await h.raw(callback({code:consent.code,state:'synthetic-forged-state'}))).response.status,403)
  assert.equal((await h.raw(callback({code:consent.code,state:consent.state}),{actor:'foreign'})).response.status,403)
  const connected=await h.raw(callback({code:consent.code,state:consent.state}))
  assert.equal(connected.response.status,302);assert.equal(connected.response.headers.get('Location'),'/projects/p/move-in?zendesk=connected')
  assert.equal((await h.raw(callback({code:consent.code,state:consent.state}))).response.status,403,'state is single use')
  const [exchange]=zendesk.state.tokenRequests
  assert.deepEqual(Object.keys(exchange).sort(),['client_id','code','code_verifier','expires_in','grant_type','redirect_uri','refresh_token_expires_in','scope'])
  assert.equal(exchange.grant_type,'authorization_code')
  const status=await h.call(`${api}/zendesk/connection`)
  assert.deepEqual({...status,accessExpiresAt:typeof status.accessExpiresAt,refreshExpiresAt:typeof status.refreshExpiresAt},{connected:true,state:'connected',subdomain:SUBDOMAIN,clientKind:'public',scopes:['read','hc:read'],accessExpiresAt:'number',refreshExpiresAt:'number'})
  const [custody]=await rows(h,'SELECT * FROM move_in_zendesk_connections')
  assert.doesNotMatch(JSON.stringify(custody),secretish,'tokens are stored only as ciphertext')
  assert.equal((await h.raw(`${api}/zendesk/connect`,post({subdomain:'synthetic-other',clientId:CLIENT_ID}))).response.status,200,'no imports yet: another account may still be chosen')

  // Pull everything: archived, deleted and complete, with a 429 honoured.
  const started=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  assert.equal((await h.raw(`${api}/zendesk/pulls`,post({}))).response.status,409,'one pull at a time')
  const first=await drain(h)
  let pull=await pullOf(h,started.id)
  assert.equal(pull.state,'ready',JSON.stringify({error:pull.error,phase:pull.phase}))
  assert.equal(zendesk.state.tokenRequests[1].grant_type,'refresh_token','the short first token is refreshed before reading')
  assert.ok(zendesk.state.requests.filter(r=>r.path==='/api/v2/tickets/101/comments.json').length>=2,'429 is retried after Retry-After')
  assert.deepEqual(pull.totals.tickets,{seen:5,deleted:1,imported:0,refused:0,alreadyImported:0})
  assert.deepEqual(pull.totals.articles,{seen:3,published:1,draft:1,heldBack:1})
  assert.equal(pull.totals.users,5);assert.equal(pull.totals.organizations,1)
  const refusedOnly=pull.batches.filter(b=>b.summary.refused&&!b.covered)
  assert.deepEqual(refusedOnly.map(b=>[b.summary.refused,b.nothingToImport]),[[2,true]],'only the field definitions batch, whose every record was refused, has nothing to import')
  assert.ok(pull.batches.filter(b=>!b.nothingToImport).every(b=>b.covered),'the approval covers every batch with something to import')
  assert.deepEqual(pull.refusals.filter(r=>r.kind==='ticket_field').map(r=>[r.sourceId,r.reason]),[['71','field_type_not_supported'],['72','field_permissions_require_native_review']])
  assert.doesNotMatch(JSON.stringify(pull),secretish)
  const conversationsBefore=(await rows(h,'SELECT COUNT(*) n FROM conversations'))[0].n
  assert.equal(conversationsBefore,0,'review alone has no native effect')

  // One approval binds every reviewed batch; each batch with something to import then applies by itself.
  assert.equal((await h.raw(`${api}/zendesk/pulls/${pull.id}/approve`,post({fingerprint:'stale'}))).response.status,409)
  await h.call(`${api}/zendesk/pulls/${pull.id}/approve`,post({fingerprint:pull.fingerprint}))
  const applying=await drain(h)
  pull=await pullOf(h,started.id)
  assert.equal(pull.state,'applied',JSON.stringify({error:pull.error}))
  assert.equal(pull.totals.tickets.imported,4)
  assert.equal(pull.batches.find(b=>b.nothingToImport).state,'ready','a batch whose every record was refused has nothing to apply')
  assert.ok(Math.max(first.maxStatements,applying.maxStatements)<=980,'every invocation stays inside the D1 statement budget')

  const imported=await rows(h,'SELECT s.source_id,c.id,c.assigned_to FROM move_in_conversations s JOIN conversations c ON c.id=s.conversation_id ORDER BY CAST(s.source_id AS INTEGER)')
  assert.deepEqual(imported.map(r=>r.source_id),['101','102','104','105'],'deleted ticket 103 is a tombstone, not imported')
  assert.ok(imported.every(r=>r.assigned_to===null),'imports assign nobody')
  const large=imported.find(r=>r.source_id==='104').id
  const sanitizedBytes=Buffer.byteLength(JSON.stringify({ticket:{...zendesk.tickets[104].record,comments:largeComments()}}))
  assert.ok(sanitizedBytes>=400*1024,`large ticket is ${sanitizedBytes} bytes`)
  const [{messages}]=await rows(h,'SELECT COUNT(*) messages FROM messages WHERE conversation_id=?',large),[{notes}]=await rows(h,'SELECT COUNT(*) notes FROM move_in_notes WHERE conversation_id=?',large)
  assert.deepEqual([messages,notes],[200,100],'300 comments: public as messages, private as notes, in one conversation')
  const order=await rows(h,'SELECT local_id,actor_role,revision FROM messages WHERE conversation_id=? ORDER BY revision',large)
  assert.deepEqual(order.slice(0,2).map(m=>[m.local_id,m.actor_role]),[['import:40000','contact'],['import:40001','operator']],'source order and authors kept')
  const [archived]=await rows(h,"SELECT COUNT(*) n FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='102'")
  assert.equal(archived.n,2,'an archived ticket arrives with both comment pages')
  const articles=await rows(h,'SELECT title,status FROM knowledge_articles ORDER BY title')
  assert.deepEqual(articles.map(a=>[a.title,a.status]),[['Synthetic draft guide','draft'],['Synthetic public guide','published']],'the restricted article creates nothing')
  const everything=JSON.stringify(await h.snapshot())
  assert.doesNotMatch(everything,secretish,'no token, code, path token or signed link is persisted')
  assert.doesNotMatch(everything,new RegExp(PATH_TOKEN));assert.doesNotMatch(everything,new RegExp(QUERY_TOKEN))

  // Search finds an imported ticket by its exact Zendesk id, with and without #.
  for(const term of ['104','#104']){const found=await h.call(`/api/dashboard/projects/p/conversations?view=all&search=${encodeURIComponent(term)}`);assert.deepEqual(found.data.map(c=>c.id),[large],term)}

  const nativeBefore=await nativeSnapshot(h)
  assert.ok(nativeBefore.complete)
  assert.deepEqual(nativeBefore.sourceIds,['101','102','104','105'])
  assert.equal(nativeBefore.summary.mappingRows,nativeBefore.summary.distinctSourceIds)
  assert.equal(nativeBefore.summary.duplicateSourceGroups,0)
  assert.equal(nativeBefore.summary.companyOrigins,1)
  assert.deepEqual([nativeBefore.summary.publishedArticleOrigins,nativeBefore.summary.draftArticleOrigins],[1,1])
  assert.ok(!nativeBefore.articles.some(row=>row.sourceId==='803'),'restricted source has no origin')
  for(const row of nativeBefore.tickets){
   const sample=zendesk.tickets[row.sourceId]
   assert.equal(row.messageCount,sample.comments.filter(comment=>comment.public).length)
   assert.equal(row.noteCount,sample.comments.filter(comment=>!comment.public).length)
   assert.ok(row.contactLinked&&row.nativePresent)
   assert.equal((await h.raw(`/api/dashboard/projects/p/conversations/${row.conversationId}`)).response.status,200)
  }
  const diagnosticsOutbound=h.outbound
  await nativeSnapshot(h)
  assert.equal(h.outbound,diagnosticsOutbound,'census makes no provider request')

  // Another account is refused once this workspace holds Zendesk history.
  assert.equal((await h.raw(`${api}/zendesk/connect`,post({subdomain:'synthetic-other',clientId:CLIENT_ID}))).response.status,409)

  // A repeat pull reads only what is new or changed, and every source id keeps one conversation.
  // Ticket 101 gained a reply and a private note, ticket 102 changed status, person 3 was renamed and the
  // organization changed: what an earlier import holds is kept as imported and counted, the
  // reply imports onto 101's conversation, and new tickets 106 and 107 import, 107 linked to
  // person 3's existing contact. Nothing is refused.
  const notesOf=async id=>(await rows(h,"SELECT COUNT(*) n FROM move_in_notes m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id=?",id))[0].n
  const messagesOf=async id=>(await rows(h,"SELECT COUNT(*) n FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id=?",id))[0].n
  const conversationOf=async id=>(await rows(h,"SELECT c.id,c.contact_id,c.revision,c.last_message_id,s.source_state FROM conversations c JOIN move_in_conversations s ON s.conversation_id=c.id WHERE s.source_id=?",id))[0]
  const sourceIds=async()=>(await rows(h,'SELECT source_id,COUNT(*) n FROM move_in_conversations GROUP BY source_id ORDER BY CAST(source_id AS INTEGER)')).map(r=>[r.source_id,r.n])
  const replies=await messagesOf('101'),privateNotes=await notesOf('101'),first101=await conversationOf('101')
  const [person3]=await rows(h,"SELECT target_id id FROM move_in_origins WHERE target_kind='contact' AND source_id='3'")
  const keptRecords={tickets:1,users:1,organizations:1}
  zendesk.state.repeat=true
  const again=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  let budget=await drain(h)
  let repeat=await pullOf(h,again.id)
  assert.equal(repeat.state,'ready',JSON.stringify({error:repeat.error}))
  assert.deepEqual(repeat.totals.tickets,{seen:4,deleted:0,imported:0,refused:0,alreadyImported:1},'101 gained only a reply; 102 is kept as imported')
  assert.deepEqual(repeat.totals.replies,{seen:2,imported:0,refused:0})
  assert.deepEqual(repeat.totals.keptAsImported,keptRecords,'changed in Zendesk, kept as imported')
  assert.deepEqual(repeat.refusals.filter(r=>r.kind!=='ticket_field'),[],'nothing new is refused')
  assert.deepEqual(repeat.batches.filter(b=>b.summary.refused).map(b=>[b.summary.refused,b.nothingToImport]),[[2,true]],'only the field definitions are refused again, and they have nothing to import')
  assert.ok(repeat.batches.filter(b=>b.summary.tickets||b.summary.replies).every(b=>b.covered),'no ticket or reply batch waits')
  await h.call(`${api}/zendesk/pulls/${again.id}/approve`,post({fingerprint:repeat.fingerprint}))
  budget=await drain(h)
  repeat=await pullOf(h,again.id)
  assert.equal(repeat.state,'applied',JSON.stringify({error:repeat.error}))
  assert.equal(repeat.totals.tickets.imported,2);assert.equal(repeat.totals.replies.imported,2)
  assert.ok(budget.maxStatements<=980,'a repeat pull stays inside the D1 statement budget')
  const nativeAfter=await nativeSnapshot(h)
  assertRepeatSurvival(nativeBefore,nativeAfter)
  assert.deepEqual(nativeAfter.sourceIds.filter(id=>!nativeBefore.sourceIds.includes(id)),['106','107'])
  assert.ok(nativeAfter.sourceIds.filter(id=>!nativeBefore.sourceIds.includes(id)).every(id=>BigInt(id)>105n),'extras are later arrivals')
  assert.ok(!nativeAfter.sourceIds.includes('103'),'deleted ticket remains absent')
  assert.notEqual(nativeBefore.tupleFingerprint,nativeAfter.tupleFingerprint,'legitimate new replies and sources change tuple observations')
  const everyTicket=[['101',1],['102',1],['104',1],['105',1],['106',1],['107',1]]
  assert.deepEqual(await sourceIds(),everyTicket)
  assert.equal(await messagesOf('101'),replies+1,'the reply on 101 imports as one more message')
  assert.equal(await notesOf('101'),privateNotes+1,'and the private comment as one more private note')
  const caughtUp=await conversationOf('101'),[reply]=await rows(h,"SELECT m.id,m.revision,m.actor_role,m.local_id FROM messages m WHERE m.conversation_id=? ORDER BY m.revision DESC LIMIT 1",caughtUp.id)
  assert.deepEqual([reply.local_id,reply.actor_role,reply.revision],['import:10103','contact',first101.revision+1],'the reply follows the imported history in source order')
  assert.deepEqual([caughtUp.revision,caughtUp.last_message_id],[first101.revision+1,reply.id],'the conversation shows the reply as its latest message')
  assert.equal((await conversationOf('107')).contact_id,person3.id,'107 links to person 3’s existing contact')
  assert.equal((await rows(h,'SELECT name FROM contacts WHERE id=?',person3.id))[0].name,'synthetic-hh person 3','the renamed person is kept as imported')
  assert.equal((await conversationOf('102')).source_state,'closed','the changed ticket is kept as imported')
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM contacts'))[0].n,4,'returning people are not duplicated')

  // Undo the repeat pull's batch, then pull again: the same records import again, and the pull reports them.
  const caughtUpBatches=repeat.batches.filter(b=>b.state==='completed'&&(b.summary.ticketsNew||b.summary.replies))
  assert.equal(caughtUpBatches.length,1,'one batch carries the new tickets and the reply')
  await h.call(`/api/move-in/projects/p/imports/${caughtUpBatches[0].runId}/undo`,post({}))
  await drain(h)
  assert.deepEqual(await sourceIds(),everyTicket.filter(([id])=>!['106','107'].includes(id)))
  assert.deepEqual([await messagesOf('101'),await notesOf('101')],[replies,privateNotes],'undo takes the reply and the note out')
  assert.deepEqual(await conversationOf('101'),first101,'and returns 101 to its imported state')
  const third=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  budget=await drain(h)
  let back=await pullOf(h,third.id)
  assert.equal(back.state,'ready',JSON.stringify({error:back.error}))
  assert.deepEqual(back.totals.tickets,{seen:7,deleted:1,imported:0,refused:0,alreadyImported:3},'after an undo the whole account is read again')
  assert.deepEqual(back.totals.replies,{seen:2,imported:0,refused:0})
  assert.deepEqual(back.totals.keptAsImported,keptRecords)
  await h.call(`${api}/zendesk/pulls/${third.id}/approve`,post({fingerprint:back.fingerprint}))
  budget=await drain(h)
  back=await pullOf(h,third.id)
  assert.equal(back.state,'applied',JSON.stringify({error:back.error}))
  assert.deepEqual([back.totals.tickets.imported,back.totals.replies.imported],[2,2],'the undone tickets and replies import again')
  assert.ok(budget.maxStatements<=980)
  assert.deepEqual(await sourceIds(),everyTicket)
  assert.deepEqual([await messagesOf('101'),await notesOf('101')],[replies+1,privateNotes+1])
  assert.equal((await conversationOf('107')).contact_id,person3.id)

  // Every source read was a GET; the only POSTs went to the token endpoint.
  for(const r of zendesk.state.requests)assert.ok(r.method==='GET'||r.method==='POST'&&r.path==='/oauth/tokens',`${r.method} ${r.path}`)

  await linkageObservations(h)

  // Disconnect removes the ciphertext and reports Zendesk's revoke outcome.
  const disconnected=await h.call(`${api}/zendesk/connection`,{method:'DELETE'})
  assert.deepEqual(disconnected,{disconnected:true,revoke:{outcome:'revoked',status:204}})
  const [after]=await rows(h,'SELECT state,access_ciphertext,refresh_ciphertext FROM move_in_zendesk_connections')
  assert.deepEqual(after,{state:'disconnected',access_ciphertext:null,refresh_ciphertext:null})
  assert.equal(h.outboundRequests.filter(r=>r.hostname!==`${SUBDOMAIN}.zendesk.com`).length,0,'nothing else was contacted: no mail, AI or notification')
 }finally{await h.close()}
})

test('a refused record never holds back a valid one and a stopped batch is never left behind: credential refusals stay out of packed batches across resume and every valid record imports',{timeout:600_000},async()=>{
 const zendesk=fakeZendesk({edgeCases:true,credentialTicket:true}),h=await nativeHarness({network:zendesk.handler,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'}})
 try{
  await connect(h,zendesk)
  // The first pull's ticket batch stops on a transient database failure while it is parsed.
  const first=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await failing(h,whileParsing(`zendesk-pull-${first.id.slice(0,8)}-1.jsonl`),()=>drain(h))
  let pull=await pullOf(h,first.id)
  assert.equal(pull.state,'reviewing','a pull with a stopped batch is neither ready nor applied')
  assert.equal(pull.error,'batch_review_stopped:Import database operation failed')
  const stopped=pull.batches.filter(b=>b.stopped)
  assert.deepEqual(stopped.map(b=>[b.ordinal,b.state,b.error,b.summary]),[[0,'parsing','Import database operation failed',null]],'the stopped batch is named with its reason and never counted as reviewed')
  assert.equal(pull.progress.batchesStopped,1)
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM conversations'))[0].n,0)

  // Stop that pull. The next one reads the account again and admits the stopped batch's
  // records as a new run; when that run stops too, Resume continues it from its checkpoint.
  await h.call(`${api}/zendesk/pulls/${first.id}/abandon`,post({}))
  const second=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await failing(h,whileParsing(`zendesk-pull-${second.id.slice(0,8)}-1.jsonl`),()=>drain(h))
  pull=await pullOf(h,second.id)
  assert.equal(pull.state,'reviewing')
  const [again]=pull.batches.filter(b=>b.stopped)
  assert.equal(again.ordinal,0);assert.notEqual(again.runId,stopped[0].runId,'the next pull admits the stopped batch again as a new run')
  const packedBeforeResume=pull.batches.map(b=>b.runId)
  const credentialRefusal=pull.refusals.find(r=>r.kind==='ticket'&&r.sourceId==='112')
  assert.equal(credentialRefusal?.reason,'CREDENTIAL_IN_DURABLE_URL','the genuine credential record is refused by its Zendesk id before batch review resumes')
  async function packedTickets(){
   const records=[]
   for(const batch of (await pullOf(h,second.id)).batches){
    const [run]=await rows(h,'SELECT object_key FROM move_in_runs WHERE id=?',batch.runId)
    const original=await (await h.files).get(run.object_key)
    assert.ok(original)
    records.push(...(await original.text()).split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line)))
   }
   assert.ok(records.every(record=>record.ticket?.id!==112),'the credential-failing ticket never enters any packed original')
   return records.filter(record=>record.ticket).map(record=>String(record.ticket.id)).sort()
  }
  assert.deepEqual(await packedTickets(),['101','102','104','105','109','110'],'the batch packs every other live ticket, including the missing-requester case for review')
  await h.call(`${api}/zendesk/pulls/${second.id}/resume`,post({}))
  await drain(h)
  pull=await pullOf(h,second.id)
  assert.equal(pull.state,'ready',JSON.stringify({error:pull.error}))
  assert.equal(pull.progress.batchesStopped,0)
  assert.deepEqual(pull.batches.map(b=>b.runId),packedBeforeResume,'resume continues the same batches without packing the refused record again')
  assert.deepEqual(pull.refusals.find(r=>r.kind==='ticket'&&r.sourceId==='112'),credentialRefusal)
  assert.deepEqual(await packedTickets(),['101','102','104','105','109','110'])

  // A pull reviewed before W3 is planned again on Resume from its existing custody.
  // Packing refusals have no batch to re-plan and must survive that refresh too.
  const reads=zendesk.state.requests.length
  const reviewed=pull.batches.find(b=>b.summary.tickets)
  const [oldRun]=await rows(h,'SELECT plan_json FROM move_in_runs WHERE id=?',reviewed.runId)
  const oldPlan=JSON.parse(oldRun.plan_json);delete oldPlan.mappingRevision
  await h.db.prepare('UPDATE move_in_runs SET plan_json=? WHERE id=?').bind(JSON.stringify(oldPlan),reviewed.runId).run()
  await h.call(`${api}/zendesk/pulls/${second.id}/resume`,post({}))
  assert.equal((await pullOf(h,second.id)).state,'reviewing','an older review returns to planning')
  await drain(h)
  pull=await pullOf(h,second.id)
  assert.equal(pull.state,'ready',JSON.stringify({error:pull.error}))
  const [freshRun]=await rows(h,'SELECT plan_json FROM move_in_runs WHERE id=?',reviewed.runId)
  assert.ok(JSON.parse(freshRun.plan_json).mappingRevision>1,'the older batch is reviewed under the current mapping')
  assert.equal(zendesk.state.requests.length,reads,'re-planning reads existing custody, not Zendesk')
  assert.deepEqual(pull.batches.map(b=>b.runId),packedBeforeResume)
  assert.deepEqual(pull.refusals.find(r=>r.kind==='ticket'&&r.sourceId==='112'),credentialRefusal,'re-planning preserves the packing refusal')
  assert.deepEqual(await packedTickets(),['101','102','104','105','109','110'])

  // Ticket 110's requester is no longer in Zendesk, in the same batch as every valid ticket,
  // among them chat ticket 109 from person 8, who has no email. The approval covers that
  // batch: its valid records import and the one refusal is named.
  const ticketBatch=pull.batches.find(b=>b.summary.tickets)
  assert.deepEqual([ticketBatch.summary.tickets,ticketBatch.summary.ticketsNew,ticketBatch.summary.refused,ticketBatch.covered],[6,5,1,true],'a batch with a refused record is covered by the one approval')
  await h.call(`${api}/zendesk/pulls/${second.id}/approve`,post({fingerprint:pull.fingerprint}))
  let budget=await drain(h)
  pull=await pullOf(h,second.id)
  assert.equal(pull.state,'applied',JSON.stringify({error:pull.error}))
  assert.ok(budget.maxStatements<=980)
  assert.deepEqual(await sourceIds(h),[['101',1],['102',1],['104',1],['105',1],['109',1]],'every valid ticket imports beside the refused one')
  assert.deepEqual(pull.refusals.filter(r=>r.kind!=='ticket_field').map(r=>[r.kind,r.sourceId,r.reason]),[['ticket','110','conversation_contact_unavailable'],['ticket','112','CREDENTIAL_IN_DURABLE_URL']],'the missing requester and genuine credential are each refused by source id and reason')
  assert.deepEqual(pull.totals.tickets,{seen:8,deleted:1,imported:5,refused:2,alreadyImported:0})
  assert.equal(accounted(pull.totals.tickets,pull.totals.keptAsImported),pull.totals.tickets.seen,'every ticket seen is accounted for')
  const contacts=async()=>(await rows(h,'SELECT COUNT(*) n FROM contacts'))[0].n
  assert.equal(pull.totals.users,(await contacts())+1,'people seen are five contacts, one without an email, and one staff author')
  // Person 8 comes across with no email, matched by its Zendesk id; the transcript Zendesk wrote
  // itself is a system message in source order; the description that only starts like a link is prose.
  const contactOf=async id=>(await rows(h,"SELECT c.name,c.email,c.external_id,c.is_verified FROM contacts c JOIN move_in_origins o ON o.target_id=c.id AND o.target_kind='contact' WHERE o.source_id=?",id))[0]
  assert.deepEqual(await contactOf('8'),{name:'synthetic-hh person 8',email:null,external_id:'import:zendesk:8',is_verified:0})
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM move_in_contact_keys k JOIN move_in_origins o ON o.target_id=k.contact_id WHERE o.source_id=?','8'))[0].n,0,'a contact with no email has no email key')
  const chat=await rows(h,"SELECT m.local_id,m.actor_role FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='109' ORDER BY m.revision")
  assert.deepEqual(chat.map(m=>[m.local_id,m.actor_role]),[['import:10901','contact'],['import:10902','system']])
  assert.ok(pull.batches.every(b=>b.state==='completed'||b.nothingToImport),'no batch is left behind')

  // A repeat pull with new replies on 101, new tickets 106 and 107, new person 6 with a
  // malformed email who requests ticket 108, and ticket 111 that agent 2 raised for themselves,
  // all in one batch: everything imports. The first pull already holds agent 2 as a staff
  // author with no native record; the requester still comes across as an inert contact.
  zendesk.state.repeat=true
  const replies=(await rows(h,"SELECT COUNT(*) n FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='101'"))[0].n
  const third=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  // The reviewer's session ends while the batch waits for its turn in the queue. Its step
  // cannot run, so it hands control back to the pull, which stops and says why; after a
  // new sign-in, Resume hands the waiting batch to the new session.
  await drain(h,{hold:job=>job.type==='move-in'})
  assert.equal((await pullOf(h,third.id)).state,'reviewing')
  await endSession(h)
  await drain(h,{retries:true})
  const [lapsed]=await rows(h,'SELECT state,error FROM move_in_zendesk_pulls WHERE id=?',third.id)
  assert.deepEqual(lapsed,{state:'reviewing',error:'import_authority_revoked'},'the pull stops and names the ended session')
  await signIn(h)
  await h.call(`${api}/zendesk/pulls/${third.id}/resume`,post({}))
  await drain(h)
  let repeat=await pullOf(h,third.id)
  assert.equal(repeat.state,'ready',JSON.stringify({error:repeat.error}))
  const caughtUp=repeat.batches.find(b=>b.summary.tickets||b.summary.replies)
  assert.deepEqual([caughtUp.summary.ticketsNew,caughtUp.summary.replies,caughtUp.summary.refused,caughtUp.covered],[4,2,0,true])
  // A transient database failure stops the approved batch mid-import: the pull is not
  // imported, names the stopped batch, and Resume finishes it.
  await h.call(`${api}/zendesk/pulls/${third.id}/approve`,post({fingerprint:repeat.fingerprint}))
  await failing(h,'BEFORE INSERT ON conversations',()=>drain(h))
  repeat=await pullOf(h,third.id)
  assert.equal(repeat.state,'applying');assert.match(repeat.error,/^batch_stopped:/)
  assert.deepEqual(repeat.batches.filter(b=>b.stopped).map(b=>[b.runId,b.state]),[[caughtUp.runId,'applying']])
  await h.call(`${api}/zendesk/pulls/${third.id}/resume`,post({}))
  budget=await drain(h)
  repeat=await pullOf(h,third.id)
  assert.equal(repeat.state,'applied',JSON.stringify({error:repeat.error}))
  assert.ok(budget.maxStatements<=980)
  assert.deepEqual(await sourceIds(h),[['101',1],['102',1],['104',1],['105',1],['106',1],['107',1],['108',1],['109',1],['111',1]],'106, 107, 108 and 111 import; 110 stays out')
  assert.equal((await rows(h,"SELECT COUNT(*) n FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='101'"))[0].n,replies+1,'the new public reply on 101 imports')
  assert.deepEqual(repeat.refusals.filter(r=>r.kind!=='ticket_field'),[],'nothing new is refused')
  assert.deepEqual(repeat.totals.tickets,{seen:6,deleted:0,imported:4,refused:0,alreadyImported:1})
  assert.deepEqual(await contactOf('6'),{name:'synthetic-hh person 6',email:null,external_id:'import:zendesk:6',is_verified:0},'a malformed email is never kept as an address')
  // Agent 2's own ticket has an inert contact for agent 2: no email, unverified, no access; the staff comments stay theirs.
  const staffRaised=await rows(h,"SELECT c.contact_id,c.assigned_to FROM conversations c JOIN move_in_conversations s ON s.conversation_id=c.id WHERE s.source_id='111'")
  assert.deepEqual(await contactOf('2'),{name:'synthetic-hh person 2',email:null,external_id:'import:zendesk:2',is_verified:0})
  assert.deepEqual([staffRaised.length,staffRaised[0].assigned_to],[1,null])
  assert.equal((await rows(h,'SELECT external_id FROM contacts WHERE id=?',staffRaised[0].contact_id))[0].external_id,'import:zendesk:2')
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM sessions WHERE contact_id=?',staffRaised[0].contact_id))[0].n,0,'the inert contact has no access')
  assert.deepEqual((await rows(h,"SELECT DISTINCT m.actor_role FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='111'")).map(m=>m.actor_role),['operator'])
  assert.deepEqual(repeat.totals.replies,{seen:2,imported:2,refused:0})
  assert.deepEqual(repeat.totals.keptAsImported,{tickets:1,users:1,organizations:1})
  assert.equal(accounted(repeat.totals.tickets,repeat.totals.keptAsImported),repeat.totals.tickets.seen,'every ticket seen is accounted for')
  assert.ok(repeat.batches.every(b=>b.state==='completed'||b.nothingToImport),'no batch is left behind')
 }finally{await h.close()}
})

test('any owner or admin pulls and the next pull by any of them works; every owner and admin sees the workspace pull, and an owner stops or takes over another member’s stopped pull, or stops an approved pull that stopped or whose admin was removed',{timeout:1_500_000},async()=>{
 const zendesk=fakeZendesk(),h=await nativeHarness({network:zendesk.handler,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'}})
 try{
  await connect(h,zendesk)
  await addMember(h,'admin','admin')
  const as=(actor,options={})=>({...options,actor})
  const pullAs=async actor=>(await h.call(`${api}/zendesk/pulls`,as(actor,post({})))).data
  const viewAs=async(id,actor='owner')=>(await h.call(`${api}/zendesk/pulls/${id}`,as(actor))).data
  const latestAs=async actor=>(await h.call(`${api}/zendesk/pulls`,as(actor))).data[0]
  const statusOf=async(path,actor='owner')=>(await h.raw(`${api}/zendesk/pulls/${path}`,as(actor,post({})))).response.status
  async function pulled(actor){const started=await pullAs(actor),{maxStatements}=await drain(h);assert.ok(maxStatements<=980);return started}
  async function approveAs(id,actor){
   const ready=await viewAs(id,actor);assert.equal(ready.state,'ready',JSON.stringify({error:ready.error,phase:ready.phase}))
   await h.call(`${api}/zendesk/pulls/${id}/approve`,as(actor,post({fingerprint:ready.fingerprint})))
   const {maxStatements}=await drain(h),done=await viewAs(id,actor)
   assert.equal(done.state,'applied',JSON.stringify({error:done.error}));assert.ok(maxStatements<=980,'every invocation stays inside the D1 statement budget')
   assert.equal(accounted(done.totals.tickets,done.totals.keptAsImported),done.totals.tickets.seen,'every ticket seen is accounted for')
   assert.ok(done.batches.every(b=>b.state==='completed'||b.nothingToImport),'no batch is left behind')
   return done
  }
  const messagesOf=async id=>(await rows(h,"SELECT COUNT(*) n FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id=?",id))[0].n
  const caughtUp=pull=>pull.batches.find(b=>b.state==='completed'&&(b.summary.ticketsNew||b.summary.replies))
  const firstTickets=[['101',1],['102',1],['104',1],['105',1]],everyTicket=[...firstTickets,['106',1],['107',1]]

  // The owner pulls and approves.
  const first=await pulled('owner')
  let pull=await approveAs(first.id,'owner')
  assert.equal(pull.totals.tickets.imported,4);assert.deepEqual(await sourceIds(h),firstTickets)
  const replies=await messagesOf('101')

  // An admin pulls new tickets and replies, and the pull is ready for the admin's review.
  // Every owner and admin sees that one pull; only the admin approves it, and a pull that
  // has not stopped is not taken over.
  zendesk.state.repeat=true
  const second=await pullAs('admin')
  assert.equal((await h.raw(`${api}/zendesk/pulls`,post({}))).response.status,409,'one pull at a time per workspace')
  assert.ok((await drain(h)).maxStatements<=980)
  const reviewed=await viewAs(second.id,'admin')
  assert.equal(reviewed.state,'ready',JSON.stringify({error:reviewed.error,phase:reviewed.phase}))
  const seen=await latestAs('owner')
  assert.deepEqual([seen.id,seen.yours,seen.canStop,seen.canTakeOver],[second.id,false,true,false],'the owner sees the admin’s pull')
  assert.equal(await statusOf(`${second.id}/resume`),409,'a pull that has not stopped is not taken over')
  assert.equal((await h.raw(`${api}/zendesk/pulls/${second.id}/approve`,post({fingerprint:(await viewAs(second.id)).fingerprint}))).response.status,403,'only the member who started a pull approves it')
  pull=await approveAs(second.id,'admin')
  assert.deepEqual([pull.yours,pull.totals.tickets.imported,pull.totals.replies.imported],[true,2,2],'the admin’s pull imports its new tickets and replies')
  assert.deepEqual(await sourceIds(h),everyTicket);assert.equal(await messagesOf('101'),replies+1)
  const adminBatch=caughtUp(pull)

  // The owner pulls again after the admin: nothing is new, and the pull works.
  const third=await pulled('owner')
  pull=await approveAs(third.id,'owner')
  assert.deepEqual([pull.totals.tickets.imported,pull.totals.replies.imported],[0,0])
  assert.deepEqual(await sourceIds(h),everyTicket)

  // The admin undoes their batch and pulls again; the pull stops on a transient database
  // failure. The owner sees it stopped and stops it; the owner's next pull imports everything.
  await h.call(`${api}/imports/${adminBatch.runId}/undo`,as('admin',post({})));await drain(h)
  assert.deepEqual(await sourceIds(h),firstTickets)
  const fourth=await pullAs('admin')
  await failing(h,whileParsing(`zendesk-pull-${fourth.id.slice(0,8)}-1.jsonl`),()=>drain(h))
  const halted=await latestAs('owner')
  assert.deepEqual([halted.id,halted.state,halted.error,halted.yours,halted.canStop,halted.canTakeOver],[fourth.id,'reviewing','batch_review_stopped:Import database operation failed',false,true,true],'the owner sees the admin’s stopped pull and may stop or take it over')
  await h.call(`${api}/zendesk/pulls/${fourth.id}/abandon`,post({}))
  assert.equal((await viewAs(fourth.id,'admin')).state,'abandoned')
  const fifth=await pulled('owner')
  const watched=await latestAs('admin')
  assert.deepEqual([watched.id,watched.yours,watched.canStop,watched.canTakeOver],[fifth.id,false,false,false],'the admin sees the owner’s pull')
  for(const step of ['abandon','resume'])assert.equal(await statusOf(`${fifth.id}/${step}`,'admin'),403,`an admin cannot ${step} another member’s pull`)
  pull=await approveAs(fifth.id,'owner')
  assert.deepEqual([pull.totals.tickets.imported,pull.totals.replies.imported],[2,2],'the stopped pull’s records import under the owner')
  assert.deepEqual(await sourceIds(h),everyTicket);assert.equal(await messagesOf('101'),replies+1)

  // The owner undoes that batch. The admin pulls again, and the admin's session ends before
  // the pull can run: it stops. The owner takes it over; it reads again under the owner and imports everything.
  await h.call(`${api}/imports/${caughtUp(pull).runId}/undo`,post({}));await drain(h)
  assert.deepEqual(await sourceIds(h),firstTickets)
  const sixth=await pullAs('admin')
  await endSession(h,'admin')
  await drain(h)
  const stuck=await viewAs(sixth.id)
  assert.deepEqual([stuck.state,stuck.error,stuck.yours,stuck.canTakeOver],['pulling','import_authority_revoked',false,true])
  assert.equal(await statusOf(`${sixth.id}/resume`),202,'the owner takes the stopped pull over')
  await drain(h)
  pull=await approveAs(sixth.id,'owner')
  assert.deepEqual([pull.yours,pull.totals.tickets.imported,pull.totals.replies.imported],[true,2,2],'the taken-over pull imports everything under the owner')
  assert.deepEqual(await sourceIds(h),everyTicket);assert.equal(await messagesOf('101'),replies+1)
  const [takeover]=await rows(h,"SELECT actor_id FROM audit_events WHERE action='import.pull.taken_over'")
  assert.equal(takeover?.actor_id,'owner','the takeover is in the security log')

  // The admin signs in again and approves a pull. While it imports under the admin, nobody
  // else stops it. A transient database failure stops it mid-import: the admin may resume
  // it, and an owner may stop it. Stopped, the batch it did not import stays out, and the
  // admin's next pull imports it.
  await h.call(`${api}/imports/${caughtUp(pull).runId}/undo`,post({}));await drain(h)
  assert.deepEqual(await sourceIds(h),firstTickets)
  await signIn(h,'admin','admin')
  const seventh=await pulled('admin')
  await h.call(`${api}/zendesk/pulls/${seventh.id}/approve`,as('admin',post({fingerprint:(await viewAs(seventh.id,'admin')).fingerprint})))
  const running=await viewAs(seventh.id)
  assert.deepEqual([running.state,running.error,running.canStop,running.canTakeOver],['applying',null,false,false],'an approved pull running under its admin is not stopped by anyone else')
  assert.equal(await statusOf(`${seventh.id}/abandon`),409)
  await failing(h,'BEFORE INSERT ON conversations',()=>drain(h))
  const stalled=await viewAs(seventh.id)
  assert.deepEqual([stalled.state,stalled.yours,stalled.canStop,stalled.canTakeOver],['applying',false,true,false],'the owner may stop the approved pull once it has stopped');assert.match(stalled.error,/^batch_stopped:/)
  assert.equal((await viewAs(seventh.id,'admin')).canStop,false,'the admin resumes their approved pull; an owner stops it')
  assert.equal(await statusOf(`${seventh.id}/abandon`,'admin'),409)
  assert.equal(await statusOf(`${seventh.id}/resume`),409,'an approved pull is never taken over')
  assert.equal(await statusOf(`${seventh.id}/abandon`),200)
  assert.equal((await viewAs(seventh.id,'admin')).state,'abandoned')
  assert.deepEqual(await sourceIds(h),firstTickets,'the batch the stopped pull did not import stays out')
  const eighth=await pulled('admin')
  pull=await approveAs(eighth.id,'admin')
  assert.deepEqual([pull.totals.tickets.imported,pull.totals.replies.imported],[2,2],'the next pull imports what the stopped pull did not')
  assert.deepEqual(await sourceIds(h),everyTicket);assert.equal(await messagesOf('101'),replies+1)

  // The admin approves a pull and is removed from the workspace while it imports: it stops.
  // The owner stops it, and the owner's next pull imports what it did not, once.
  await h.call(`${api}/imports/${caughtUp(pull).runId}/undo`,as('admin',post({})));await drain(h)
  assert.deepEqual(await sourceIds(h),firstTickets)
  const ninth=await pulled('admin')
  await h.call(`${api}/zendesk/pulls/${ninth.id}/approve`,as('admin',post({fingerprint:(await viewAs(ninth.id,'admin')).fingerprint})))
  await drain(h,{hold:job=>job.type==='move-in'})
  assert.deepEqual((await viewAs(ninth.id)).batches.filter(b=>b.covered).map(b=>b.state),['applying'],'the approved batch is importing')
  await h.call('/api/management/projects/p/agents/admin',{method:'DELETE'})
  await drain(h,{retries:true})
  const orphaned=await viewAs(ninth.id)
  assert.deepEqual([orphaned.state,orphaned.error,orphaned.canStop,orphaned.canTakeOver],['applying','import_authority_revoked',true,false],'the owner may stop the approved pull of a removed admin')
  assert.equal(await statusOf(`${ninth.id}/resume`),409,'an approved pull is never taken over')
  assert.equal((await h.raw(`${api}/zendesk/pulls`,post({}))).response.status,409,'the stopped pull holds the workspace until it is stopped')
  assert.equal(await statusOf(`${ninth.id}/abandon`),200)
  assert.deepEqual(await sourceIds(h),firstTickets)
  const tenth=await pulled('owner')
  pull=await approveAs(tenth.id,'owner')
  assert.deepEqual([pull.yours,pull.totals.tickets.imported,pull.totals.replies.imported],[true,2,2],'the owner’s next pull imports what the removed admin’s pull did not')
  assert.deepEqual(await sourceIds(h),everyTicket);assert.equal(await messagesOf('101'),replies+1)
  const stops=await rows(h,"SELECT actor_id,target_id,detail_json FROM audit_events WHERE action='import.pull.abandoned' ORDER BY at")
  assert.deepEqual(stops.slice(-2).map(e=>[e.actor_id,e.target_id,JSON.parse(e.detail_json).startedBy,JSON.parse(e.detail_json).approved]),[['owner',seventh.id,'admin',true],['owner',ninth.id,'admin',true]],'each stop of an approved pull is in the security log')
 }finally{await h.close()}
})

test('an owner reads the Cutover sources with their live Zendesk counts after a pull applies, records steps that follow newest first with the source state, and an agent is refused',{timeout:600_000},async()=>{
 const zendesk=fakeZendesk(),h=await nativeHarness({network:zendesk.handler,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'}})
 const cutover=`${api}/cutover`,sourcesOf=async(actor='owner')=>(await h.call(cutover,{actor})).data.sources
 const tables=async()=>{const all=await h.snapshot();delete all._cf_METADATA;return JSON.stringify(all)}
 const step={source:'zendesk',state:'seed',change:'Pointed new tickets at this workspace',undo:'Re-enable the Zendesk support address',check:{result:'passed',detail:'A test message arrived here'}}
 try{
  // Before any pull: always the four sources, in order, with the old tool holding each.
  let sources=await sourcesOf()
  assert.deepEqual(sources.map(s=>[s.id,s.state,s.steps.length]),[['zendesk','incumbent',0],['legacy','incumbent',0],['email','incumbent',0],['widget','incumbent',0]])
  assert.deepEqual(sources[0].counts,{imported:0,lastPull:null})

  // A pull applies; the count is what Move in imported from Zendesk and the last pull names its own totals.
  await connect(h,zendesk)
  const started=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await drain(h)
  let pull=await pullOf(h,started.id)
  await h.call(`${api}/zendesk/pulls/${started.id}/approve`,post({fingerprint:pull.fingerprint}))
  await drain(h)
  pull=await pullOf(h,started.id)
  assert.equal(pull.state,'applied',JSON.stringify({error:pull.error}))
  const [{n:importedRows}]=await rows(h,"SELECT COUNT(*) n FROM move_in_conversations m JOIN conversations c ON c.id=m.conversation_id WHERE m.vendor='zendesk'"),[{updated_at:finished}]=await rows(h,"SELECT updated_at FROM move_in_zendesk_pulls WHERE id=? AND state='applied'",started.id)
  assert.ok(importedRows>0)

  // Reads and refusals write nothing, send nothing and queue nothing.
  const before=await tables(),outbound=h.outboundRequests.length
  sources=await sourcesOf()
  assert.deepEqual(sources[0].counts,{imported:importedRows,lastPull:{at:new Date(finished).toISOString(),tickets:pull.totals.tickets.imported,replies:pull.totals.replies.imported}})
  for(const [method,path,body] of [['GET',cutover],['POST',`${cutover}/steps`,JSON.stringify(step)]]){
   const refused=await h.raw(path,{method,body,actor:'operator',headers:{'Content-Type':'application/json'}})
   assert.equal(refused.response.status,403,'the Agent role is refused');assert.doesNotMatch(JSON.stringify(refused.data),/sources|imported/)
  }
  assert.equal((await h.raw(cutover,{actor:'foreign'})).response.status,404,'another workspace does not see this one')
  assert.equal((await h.raw(`${cutover}/steps`,{...post({...step,recordedBy:'someone'}),actor:'owner'})).response.status,400,'the server alone says who and when')
  assert.equal((await h.raw(`${cutover}/steps`,{...post({...step,undo:'  '}),actor:'owner'})).response.status,400)
  assert.equal(await tables(),before,'no table changed');assert.equal(h.outboundRequests.length,outbound);assert.deepEqual(h.queued,[])

  // Recording: the step comes back as the read returns it; an undo is a newer step and the state follows the newest.
  const recorded=await h.raw(`${cutover}/steps`,post(step))
  assert.equal(recorded.response.status,201)
  assert.deepEqual({...recorded.data.data,id:undefined,recordedAt:undefined},{...step,id:undefined,recordedAt:undefined,recordedBy:{id:'owner',name:'owner'}})
  await new Promise(resolve=>setTimeout(resolve,5))
  const restored=(await h.raw(`${cutover}/steps`,post({...step,state:'incumbent',change:'Re-enabled the Zendesk support address',undo:'Point new tickets here again',check:{result:'failed',detail:'Mail still arrives in Zendesk'}}))).data.data
  sources=await sourcesOf()
  assert.deepEqual(sources[0].steps.map(s=>s.id),[restored.id,recorded.data.data.id],'newest first')
  assert.equal(sources[0].state,'incumbent');assert.equal(sources[1].steps.length+sources[2].steps.length+sources[3].steps.length,0)
  assert.deepEqual(await rows(h,"SELECT action,actor_id,detail_json FROM audit_events WHERE action='cutover.step.recorded' ORDER BY at").then(events=>events.map(e=>[e.actor_id,JSON.parse(e.detail_json).source])),[['owner','zendesk'],['owner','zendesk']],'one security-log event per recorded step')
  assert.equal(h.outboundRequests.length,outbound,'nothing was sent or fetched')

  // The counts read derived sets and tallies (migration 318): after an import, an undone import and a legacy sweep
  // they equal every row recomputed, and the sets equal a fresh computation.
  const all=(sql,...args)=>rows(h,sql,...args),exact=async label=>{await assertCutoverDerived(all,label);return assertCutoverCounts(all,'p',await sourcesOf(),label)}
  assert.equal((await exact('after the pull')).zendesk.imported,importedRows)
  for(const batch of pull.batches.filter(b=>b.state==='completed'&&b.summary.ticketsNew))await h.call(`${api}/imports/${batch.runId}/undo`,post({}))
  await drain(h)
  assert.equal((await exact('after the undo')).zendesk.imported,0,'an undone import drops out')
  // A legacy sweep written as the importer writes it: plain INSERTs, a chunk run whose package run completes after every
  // chunk, one journal row before its conversation, one archived-only row and one conversation journaled by two runs.
  const at=Date.now(),digest='d'.repeat(64),chunk=`legacy:${'c'.repeat(64)}`,single=`legacy:${'e'.repeat(64)}`,write=(sql,...args)=>h.db.prepare(sql).bind(...args).run()
  await write("INSERT INTO contacts(id,project_id,name,email,external_id,created_at) VALUES('cut-ct','p','Legacy visitor',NULL,'import:legacy:cut-ct',?)",at)
  const conversation=(id,created=at)=>write("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,'p','cut-ct',?,?)",id,created,created)
  const journal=(run,id,status='mapped')=>write("INSERT INTO legacy_import_rows(run_id,source_table,source_id,row_digest,source_json,target_table,target_key,status) VALUES(?,'conversations',?,'x','{}','conversations',?,?)",run,id,id,status)
  const message=(id,conversationId,role='contact',created=at+1)=>write("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,'p',?,?,'cut-ct',?,'Synthetic legacy text',(SELECT count(*)+1 FROM messages WHERE conversation_id=?),?)",id,conversationId,id,role,conversationId,created)
  await write("INSERT INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)",`legacy-package:${digest}`,`{"format":"happytohelp-legacy-v1","package":"${digest}"}`,digest,at)
  await write("INSERT INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)",chunk,`{"chunk":0,"package":"${digest}","revision":undefined}`,'c'.repeat(64),at)
  for(const id of ['cut-l1','cut-l2','cut-l3']){await conversation(id,at-60_000);await message(`${id}-m`,id,'contact',at-59_000)}
  await journal(chunk,'cut-l1');await journal(chunk,'cut-l2');await journal(chunk,'cut-l3','archived_only');await journal(chunk,'cut-l4')
  await conversation('cut-l4',at-60_000)
  await write("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?",at+1000,chunk)
  let counts=await exact('a chunk imported, its package still running')
  assert.deepEqual([counts.legacy.imported,counts.legacy.lastSweep],[3,null],'a sweep still running counts for nothing')
  await write("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?",at+2000,`legacy-package:${digest}`)
  counts=await exact('the package complete')
  assert.deepEqual([counts.legacy.imported,counts.legacy.lastSweep],[3,{at:new Date(at+2000).toISOString()}])
  await write("INSERT INTO legacy_import_runs VALUES(?,'{}',?,'complete',?,?)",single,'e'.repeat(64),at,at+3000);await journal(single,'cut-l1')
  counts=await exact('a second run journals a swept conversation')
  assert.deepEqual([counts.legacy.imported,counts.legacy.lastSweep],[3,{at:new Date(at+3000).toISOString()}],'a conversation counts once however many runs map it')
  // Widget arrivals after the sweep: a visitor's message counts; mail, a follow-up and a removed conversation do not.
  for(const id of ['cut-w1','cut-w2','cut-w3','cut-w4'])await conversation(id,at+5000)
  assert.equal((await exact('widget drafts')).widget.arrivals,0,'a draft without a visitor message is no arrival')
  for(const id of ['cut-w1','cut-w2','cut-w3','cut-w4'])await message(`${id}-m`,id,'contact',at+6000)
  await message('cut-w1-reply','cut-w1','operator',at+7000)
  assert.equal((await exact('visitor messages')).widget.arrivals,4)
  await write("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,created_at) VALUES('cut-e1','p','cut-w2','cut-e1','delivered',?)",at+8000)
  await write("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,created_at,message_id) VALUES('cut-e2','p',NULL,'cut-e2','delivered',?,'cut-w3-m')",at+8000)
  await write("INSERT INTO ticket_followups(id,project_id,original_id,conversation_id,command_key,created_at) VALUES('cut-f1','p','cut-w1','cut-w4','cut-f1',?)",at+8000)
  counts=await exact('mail and a follow-up')
  assert.deepEqual([counts.widget.arrivals,counts.email.arrivals],[1,2],'a receipt, an emailed reply and a follow-up are no widget arrivals')
  await write("DELETE FROM inbound_emails WHERE id='cut-e2'");await write("DELETE FROM ticket_followups WHERE id='cut-f1'")
  assert.equal((await exact('the mail and follow-up removed')).widget.arrivals,3)
  await write("UPDATE conversations SET channel='email' WHERE id='cut-w3'")
  assert.equal((await exact('a channel changed')).widget.arrivals,2)
  for(const table of ['messages','inbound_emails'])await write(`DELETE FROM ${table} WHERE conversation_id IN ('cut-w1','cut-l2')`)
  await write("DELETE FROM conversations WHERE id IN ('cut-w1','cut-l2')")
  counts=await exact('conversations removed')
  assert.deepEqual([counts.legacy.imported,counts.widget.arrivals],[2,1],'a removed conversation drops out of every count')
  await write("DELETE FROM legacy_import_rows WHERE run_id=? AND source_id='cut-l1'",chunk)
  assert.equal((await exact('a journal row removed')).legacy.imported,2,'the other run still maps it')
  // A restore rebuilds the sets from the restored rows (scripts/installer/local.mjs runs this after every import).
  const kept=await assertCutoverCounts(all,'p',await sourcesOf(),'before a rebuild')
  await h.db.prepare('DELETE FROM cutover_tallies').run()
  await h.db.batch(cutoverRebuildSql.split('; ').map(sql=>h.db.prepare(sql)))
  assert.deepEqual(await exact('rebuilt'),kept)
 }finally{await h.close()}
})

test('an owner fetches every imported comment\'s files over the Zendesk connection into private storage: shown in place, private notes stay private, refusals by id, Retry-After honoured, and a second run fetches nothing already stored; undoing a later pull keeps its replies and notes with files',{timeout:900_000},async()=>{
 const zendesk=fakeZendesk({attachments:true}),h=await nativeHarness({network:zendesk.handler,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'}})
 const files=`${api}/zendesk/attachments`,tokenish=/synthetic-(?:access|refresh|code)-\d|synthetic-hh-(?:path|query|attachment)-token|synthetic-hh-signed|zdusercontent|synthetic-elsewhere/
 // Steps attachment and pull jobs alike, waiting out a persisted Retry-After.
 async function run(){
  let steps=0
  while(h.queued.length){
   assert.ok(steps++<500,'the run finishes in bounded steps')
   const job=h.queued[0],[row]=job.type==='move-in.zendesk.attachments'?await rows(h,'SELECT next_at FROM move_in_zendesk_attachment_pulls WHERE id=?',job.id):[]
   const wait=(row?.next_at??0)-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait+20))
   const result=await h.step();assert.deepEqual(result.retried,[],'a step never throws to the queue');assert.ok(result.statements<=980,'each step stays inside the D1 budget')
  }
 }
 try{
  await connect(h,zendesk)
  assert.equal((await h.raw(files,post({}))).response.status,409,'nothing imported yet: nothing to fetch for')
  const started=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await drain(h);const ready=await pullOf(h,started.id)
  await h.call(`${api}/zendesk/pulls/${ready.id}/approve`,post({fingerprint:ready.fingerprint}));await drain(h)
  assert.equal((await pullOf(h,started.id)).state,'applied')
  assert.equal(zendesk.state.downloads.length,0,'the pull itself stays metadata-only')

  // Only an owner or admin of this workspace starts it; one run at a time.
  await addMember(h,'admin','admin')
  for(const actor of ['operator','foreign'])assert.ok([403,404].includes((await h.raw(files,{...post({}),actor})).response.status),actor)
  assert.equal((await h.raw(files,{...post({}),headers:{'Content-Type':'application/json',Authorization:''}})).response.status,401)
  zendesk.state.gone.add('104')
  const first=(await h.call(files,{...post({}),actor:'admin'})).data
  assert.deepEqual([first.state,first.error],['running',null])
  assert.equal((await h.raw(files,post({}))).response.status,409,'one run at a time per workspace')
  await run()
  let view=(await h.call(`${files}/${first.id}`)).data
  assert.equal(view.state,'done',JSON.stringify(view.error))
  assert.deepEqual(view.totals,{attachments:6,stored:3,pending:0,refused:3})
  assert.deepEqual(view.refusals,[{attachmentId:null,ticketId:'104',reason:'zendesk_ticket_not_found'},{attachmentId:'81003',ticketId:'101',reason:'attachment_host_not_owned'},{attachmentId:'81004',ticketId:'102',reason:'attachment_host_not_owned'},{attachmentId:'81005',ticketId:'102',reason:'attachment_deleted'}])
  assert.equal(view.refusalsTotal,4)
  assert.deepEqual((await h.call(files)).data.id,first.id,'the workspace\'s latest run')
  assert.ok(zendesk.state.downloads.filter(d=>d.id===81001&&d.host==='account').length>=2,'the throttled download is retried after Retry-After')
  assert.deepEqual([...new Set(h.outboundRequests.map(r=>r.hostname))].sort(),[`${SUBDOMAIN}.zdusercontent.com`,`${SUBDOMAIN}.zendesk.com`],'only the account\'s own two hosts are ever requested')

  // Shown in place and downloaded byte-exact; a private note's file reaches the team only.
  const [ticket]=await rows(h,"SELECT c.id,c.contact_id FROM conversations c JOIN move_in_conversations s ON s.conversation_id=c.id WHERE s.source_id='101'")
  const media=await rows(h,'SELECT id,filename,content_type,size,message_id,uploaded_by FROM media WHERE conversation_id=? ORDER BY filename',ticket.id)
  assert.deepEqual(media.map(m=>[m.filename,m.content_type,m.size,m.message_id===null,m.uploaded_by]),[['synthetic-hh-internal.csv','text/csv',ATTACHMENT_BYTES[81002].length,true,'import:zendesk'],['synthetic-hh-report.zip','application/zip',ATTACHMENT_BYTES[81001].length,false,'import:zendesk']])
  const [note,zip]=media,url=m=>`/api/conversations/${ticket.id}/media/${m.id}`
  const shown=await h.call(`/api/conversations/${ticket.id}/messages`)
  assert.deepEqual(shown.messages.flatMap(m=>m.media.map(f=>f.filename)),['synthetic-hh-report.zip'],'the public file shows on its message')
  assert.ok(Buffer.from((await h.download(url(zip))).bytes).equals(ATTACHMENT_BYTES[81001]),'byte-exact over 48 KiB')
  assert.ok(Buffer.from((await h.download(url(note))).bytes).equals(ATTACHMENT_BYTES[81002]),'the team downloads the private note\'s file')
  const transcript=JSON.stringify(await h.call(`/api/dashboard/projects/p/conversations/${ticket.id}/buckets`))
  assert.ok(transcript.includes('synthetic-hh-internal.csv'),'the private file shows on its private note')
  await h.contactSession('customer','p',ticket.contact_id)
  const seen=await h.call(`/api/conversations/${ticket.id}/messages`,{actor:'customer'})
  assert.deepEqual(seen.messages.flatMap(m=>m.media.map(f=>f.filename)),['synthetic-hh-report.zip'])
  assert.ok(Buffer.from((await h.download(url(zip),'customer')).bytes).equals(ATTACHMENT_BYTES[81001]),'the customer downloads the public file')
  assert.equal((await h.download(url(note),'customer')).status,404,'a private note\'s file never reaches the customer')
  assert.equal((await h.download(url(zip),'foreign')).status,404,'another workspace cannot download it')
  const signedOut=await h.raw(url(zip),{headers:{Authorization:''}});assert.ok([401,403,404].includes(signedOut.response.status))
  const [inline]=await rows(h,"SELECT m.id,m.conversation_id FROM media m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='105'")
  assert.ok(Buffer.from((await h.download(`/api/conversations/${inline.conversation_id}/media/${inline.id}`)).bytes).equals(ATTACHMENT_BYTES[70501]),'an inline image is fetched too')

  // No token, signed link, Location or file URL is kept anywhere.
  assert.doesNotMatch(JSON.stringify(await h.snapshot()),tokenish)
  const objects=(await (await h.files).list({include:['httpMetadata','customMetadata']})).objects.filter(o=>o.key.startsWith('import-bytes/'))
  assert.equal(objects.length,3);assert.doesNotMatch(JSON.stringify(objects.map(o=>[o.key,o.httpMetadata,o.customMetadata])),tokenish)
  assert.equal((await rows(h,"SELECT COUNT(*) n FROM audit_events WHERE action='import.attachments.started'"))[0].n,1)

  // A second run fetches nothing already stored. Its member's session ends mid-run: the run
  // stops with its reason, and Resume by a new session continues it from its checkpoint.
  const fetched=zendesk.state.downloads.length
  zendesk.state.gone.delete('104')
  const second=(await h.call(files,post({}))).data
  await endSession(h)
  await run()
  await signIn(h)
  view=(await h.call(`${files}/${second.id}`)).data
  assert.deepEqual([view.state,view.error],['running','import_authority_revoked'])
  assert.equal((await h.raw(`${files}/${second.id}/resume`,{...post({}),actor:'operator'})).response.status,403)
  assert.equal((await h.call(`${files}/${second.id}/resume`,post({}))).data.error,null)
  assert.equal((await h.raw(`${files}/${second.id}/resume`,post({}))).response.status,409,'only a stopped run resumes')
  await run()
  view=(await h.call(`${files}/${second.id}`)).data
  assert.equal(view.state,'done',JSON.stringify(view.error))
  assert.deepEqual(view.totals,{attachments:6,stored:3,pending:0,refused:3})
  assert.ok(!view.refusals.some(r=>r.ticketId==='104'),'a ticket Zendesk returns again leaves the list')
  assert.deepEqual(zendesk.state.downloads.slice(fetched).filter(d=>[81001,81002,70501].includes(d.id)),[],'nothing already stored is downloaded again')
  assert.ok(zendesk.state.downloads.slice(fetched).some(d=>d.id===81004),'a refused file is tried again')

  // A later pull imports a reply and a private note on 101, each with a file, and new tickets
  // 106 and 107 with none, all in one batch; a third run fetches just the two new files.
  zendesk.state.repeat=true
  const later=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await drain(h);const laterReady=await pullOf(h,later.id)
  await h.call(`${api}/zendesk/pulls/${later.id}/approve`,post({fingerprint:laterReady.fingerprint}));await drain(h)
  const laterPull=await pullOf(h,later.id);assert.equal(laterPull.state,'applied',JSON.stringify(laterPull.error))
  const fetchedBefore=zendesk.state.downloads.length,third=(await h.call(files,post({}))).data
  await run()
  view=(await h.call(`${files}/${third.id}`)).data
  assert.equal(view.state,'done',JSON.stringify(view.error))
  assert.deepEqual(view.totals,{attachments:8,stored:5,pending:0,refused:3})
  assert.deepEqual(zendesk.state.downloads.slice(fetchedBefore).filter(d=>[81001,81002,70501].includes(d.id)),[],'nothing already stored is downloaded again')
  const later101=async()=>({
   replies:(await rows(h,"SELECT COUNT(*) n FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='101'"))[0].n,
   notes:(await rows(h,"SELECT COUNT(*) n FROM move_in_notes m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='101'"))[0].n,
   files:await rows(h,"SELECT a.attachment_id,m.id,m.message_id IS NULL private,(SELECT COUNT(*) FROM move_in_note_media l WHERE l.media_id=m.id AND l.note_id=a.message_id) linked FROM move_in_zendesk_attachments a JOIN media m ON m.id=a.media_id WHERE a.attachment_id IN ('81006','81007') ORDER BY a.attachment_id")})
  const withFiles=await later101()
  assert.deepEqual(withFiles.files.map(f=>[f.attachment_id,f.private,f.linked]),[['81006',0,0],['81007',1,1]],'the reply\'s file is on its message and the note\'s file on its note')
  const laterTickets=async()=>(await rows(h,"SELECT COUNT(*) n FROM move_in_conversations WHERE source_id IN ('106','107')"))[0].n
  assert.equal(await laterTickets(),2)

  // Undoing that batch keeps the reply and the note with their files as edited here, as for a
  // conversation with an agent's upload: undo stops with a conflict, not a database error, and
  // removes nothing, so no file or note link is left without its message or note.
  const laterBatch=laterPull.batches.find(b=>b.state==='completed'&&b.summary.replies)
  await h.call(`${api}/imports/${laterBatch.runId}/undo`,post({}));await drain(h)
  const stopped=(await h.call(`${api}/imports/${laterBatch.runId}`)).data
  assert.deepEqual([stopped.state,stopped.error],['undoing','NATIVE_EDIT_CONFLICT'],'kept as edited here, never a database error')
  assert.equal(await laterTickets(),2,'undo removes nothing from the batch')
  assert.deepEqual(await later101(),withFiles,'the reply and the note with fetched files are kept, with their files and the note\'s link')
  assert.deepEqual(await rows(h,'SELECT m.id FROM media m WHERE (m.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages x WHERE x.id=m.message_id)) OR (m.message_id IS NULL AND m.uploaded_by=\'import:zendesk\' AND NOT EXISTS(SELECT 1 FROM move_in_note_media l WHERE l.media_id=m.id))'),[],'no orphaned file')
  const [kept]=withFiles.files,[reply]=await rows(h,'SELECT conversation_id FROM messages WHERE id=(SELECT message_id FROM media WHERE id=?)',kept.id)
  assert.ok(Buffer.from((await h.download(`/api/conversations/${reply.conversation_id}/media/${kept.id}`)).bytes).equals(ATTACHMENT_BYTES[81006]),'the kept reply\'s file still downloads')
  // The account changes again: new tickets 113-115 each bring a file, 113's served without
  // Content-Length. A step that dies, and a queue message that never arrives, each stop the
  // run with a named reason once a step's hold has passed, never before; Resume continues
  // from the checkpoint and a new run starts after a stop. No file is downloaded twice.
  zendesk.state.again=1
  const arriving=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await drain(h);const arrivingReady=await pullOf(h,arriving.id)
  await h.call(`${api}/zendesk/pulls/${arriving.id}/approve`,post({fingerprint:arrivingReady.fingerprint}));await drain(h)
  assert.equal((await pullOf(h,arriving.id)).state,'applied')
  assert.equal(await laterTickets(),2)
  const pending=(await h.call(files)).data.totals;assert.deepEqual(pending,{attachments:8,stored:5,pending:0,refused:3})
  const step=async()=>{
   const job=h.queued[0],[row]=await rows(h,'SELECT next_at FROM move_in_zendesk_attachment_pulls WHERE id=?',job.id)
   const wait=(row?.next_at??0)-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait+20))
   const result=await h.step();assert.deepEqual(result.retried,[],'a step never throws to the queue');assert.ok(result.statements<=980,'each step stays inside the D1 budget')
  }
  const runRow=async id=>(await rows(h,'SELECT state,error,cursor_json,lease_until FROM move_in_zendesk_attachment_pulls WHERE id=?',id))[0]
  // Moves a run's clock back past a step's hold, as if that long had passed.
  const elapse=(id,column)=>h.db.prepare(`UPDATE move_in_zendesk_attachment_pulls SET ${column}=${column}-420000 WHERE id=?`).bind(id).run()
  const lost='attachments_step_lost'
  async function live(id){
   for(const data of [(await h.call(files)).data,(await h.call(`${files}/${id}`)).data])assert.deepEqual([data.id,data.state,data.error],[id,'running',null],'a run that may still be going is not stopped early')
   assert.equal((await h.raw(files,post({}))).response.status,409,'it still holds the workspace')
  }
  async function stopsLost(id){
   for(const data of [(await h.call(files)).data,(await h.call(`${files}/${id}`)).data])assert.deepEqual([data.id,data.state,data.error],[id,'running',lost],'every read shows the lost step')
  }
  const readsSince=from=>zendesk.state.requests.slice(from).flatMap(r=>r.path.match(/^\/api\/v2\/tickets\/(\d+)\/comments\.json$/)?.[1]??[]).map(Number)
  const completed=id=>zendesk.state.downloads.filter(d=>d.host==='files'&&d.id===id&&!d.held).length
  // Steps until a step blocks on the held download, then kills it mid-download.
  async function crashOnHeld(arrived){
   for(;;){
    assert.ok(h.queued.length,'the held download is reached')
    const stepping=h.step().catch(()=>null)
    if(await Promise.race([stepping.then(()=>false),arrived.then(()=>true)])){await h.crashDuringStep();await stepping;zendesk.release();return}
   }
  }
  const sixth=(await h.call(files,post({}))).data
  await step()
  let row=await runRow(sixth.id),checkpoint=JSON.parse(row.cursor_json)
  assert.ok(checkpoint.after&&!row.error&&h.queued.length===1,'the first step checkpoints past finished tickets')
  h.queued.length=0
  await live(sixth.id)
  await elapse(sixth.id,'updated_at')
  await stopsLost(sixth.id)
  let readFrom=zendesk.state.requests.length
  assert.equal((await h.call(`${files}/${sixth.id}/resume`,post({}))).data.error,null)
  await crashOnHeld(zendesk.holdDownload(81013,'files'))
  assert.ok(readsSince(readFrom).every(t=>t>Number(checkpoint.after)),'Resume continues from the checkpoint: a ticket finished before it is not read again')
  row=await runRow(sixth.id);assert.ok(row.lease_until&&!row.error)
  assert.equal((await (await h.files).list({prefix:'import-bytes/'})).objects.length,6,'the killed download left no bytes')
  await live(sixth.id)
  await elapse(sixth.id,'lease_until')
  await stopsLost(sixth.id)
  checkpoint=JSON.parse((await runRow(sixth.id)).cursor_json);readFrom=zendesk.state.requests.length
  assert.equal((await h.call(`${files}/${sixth.id}/resume`,post({}))).data.error,null)
  await run()
  assert.ok(readsSince(readFrom).every(t=>t>Number(checkpoint.after)),'Resume after the killed step continues from its checkpoint')
  view=(await h.call(`${files}/${sixth.id}`)).data
  assert.deepEqual([view.state,view.error,view.totals],['done',null,{attachments:11,stored:8,pending:0,refused:3}])
  assert.deepEqual([81008,81013,81014].map(completed),[1,1,1],'each new file is downloaded once')
  assert.equal(zendesk.state.downloads.filter(d=>d.held).length,1)
  const [unsized]=await rows(h,"SELECT m.id,m.conversation_id,m.size FROM move_in_zendesk_attachments a JOIN media m ON m.id=a.media_id WHERE a.attachment_id='81008'")
  assert.equal(unsized.size,ATTACHMENT_BYTES[81008].length)
  assert.ok(Buffer.from((await h.download(`/api/conversations/${unsized.conversation_id}/media/${unsized.id}`)).bytes).equals(ATTACHMENT_BYTES[81008]),'a file served without Content-Length is stored byte-exact')

  // A new run starts after each kind of stop and closes the stopped run, which keeps its
  // reason and no longer resumes; it downloads nothing already stored.
  const storedIds=[81001,81002,70501,81006,81007,81008,81013,81014],fetchedThen=zendesk.state.downloads.length
  const seventh=(await h.call(files,post({}))).data
  await step();h.queued.length=0
  await live(seventh.id)
  await elapse(seventh.id,'updated_at')
  await stopsLost(seventh.id)
  const eighth=(await h.call(files,post({}))).data
  assert.deepEqual([eighth.state,eighth.error],['running',null],'a new run starts after a lost message')
  view=(await h.call(`${files}/${seventh.id}`)).data
  assert.deepEqual([view.state,view.error],['done',lost],'the stopped run is closed with its reason')
  assert.equal((await h.raw(`${files}/${seventh.id}/resume`,post({}))).response.status,409)
  await crashOnHeld(zendesk.holdDownload(81004,'account'))
  await live(eighth.id)
  await elapse(eighth.id,'lease_until')
  await stopsLost(eighth.id)
  const ninth=(await h.call(files,post({}))).data
  assert.deepEqual([ninth.state,ninth.error],['running',null],'a new run starts after a killed step')
  assert.deepEqual(((await h.call(`${files}/${eighth.id}`)).data).error,lost)
  assert.equal((await h.raw(`${files}/${eighth.id}/resume`,post({}))).response.status,409)
  await run()
  view=(await h.call(`${files}/${ninth.id}`)).data
  assert.deepEqual([view.state,view.error,view.totals],['done',null,{attachments:11,stored:8,pending:0,refused:3}])
  assert.deepEqual(zendesk.state.downloads.slice(fetchedThen).filter(d=>storedIds.includes(d.id)),[],'nothing already stored is downloaded again')

  // A later pull brings a reply on 102 whose file runs past its size and a private note whose
  // file is over 50 MB by its size: both are refused by id and nothing is kept. Once that
  // batch is undone, they leave the totals and the list at once, and the next run agrees.
  zendesk.state.again=2
  const refusing=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await drain(h);const refusingReady=await pullOf(h,refusing.id)
  await h.call(`${api}/zendesk/pulls/${refusing.id}/approve`,post({fingerprint:refusingReady.fingerprint}));await drain(h)
  const refusingPull=await pullOf(h,refusing.id);assert.equal(refusingPull.state,'applied',JSON.stringify(refusingPull.error))
  const replies102=async()=>(await rows(h,"SELECT (SELECT COUNT(*) FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='102') messages,(SELECT COUNT(*) FROM move_in_notes m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='102') notes"))[0]
  const tenth=(await h.call(files,post({}))).data
  await run()
  view=(await h.call(`${files}/${tenth.id}`)).data
  assert.deepEqual([view.state,view.error,view.totals],['done',null,{attachments:13,stored:8,pending:0,refused:5}])
  assert.deepEqual(view.refusals.filter(r=>['81009','81010'].includes(r.attachmentId)),[{attachmentId:'81009',ticketId:'102',reason:'attachment_transfer_overrun'},{attachmentId:'81010',ticketId:'102',reason:'attachment_too_large'}],'a body past its size and a file over 50 MB are refused by id')
  assert.equal((await (await h.files).list({prefix:'import-bytes/'})).objects.length,8,'nothing is kept from a refused file')
  const withRefused=await replies102(),refusingBatch=refusingPull.batches.find(b=>b.state==='completed'&&b.summary.replies)
  await h.call(`${api}/imports/${refusingBatch.runId}/undo`,post({}));await drain(h)
  assert.equal((await h.call(`${api}/imports/${refusingBatch.runId}`)).data.state,'undone')
  assert.deepEqual(await replies102(),{messages:withRefused.messages-1,notes:withRefused.notes-1},'undo removes the reply and the note, which have no fetched file')
  for(const data of [(await h.call(files)).data,(await h.call(`${files}/${tenth.id}`)).data]){
   assert.deepEqual(data.totals,{attachments:11,stored:8,pending:0,refused:3},'files on comments the workspace no longer holds leave the totals')
   assert.ok(!data.refusals.some(r=>['81009','81010'].includes(r.attachmentId)),'and the list');assert.equal(data.refusalsTotal,3)
  }
  const fetchedNow=zendesk.state.downloads.length,eleventh=(await h.call(files,post({}))).data
  await run()
  view=(await h.call(`${files}/${eleventh.id}`)).data
  assert.deepEqual([view.state,view.error,view.totals],['done',null,{attachments:11,stored:8,pending:0,refused:3}],'the next run agrees')
  assert.deepEqual(zendesk.state.downloads.slice(fetchedNow).filter(d=>[81009,81010,...storedIds].includes(d.id)),[],'and fetches nothing for them')
 }finally{await h.close()}
})
