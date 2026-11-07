import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {nativeHarness} from '../move-in/harness.mjs'
import {rows} from '../move-in/journey-kit.mjs'
import {fakeZendesk,largeComments,SUBDOMAIN,CLIENT_ID,PATH_TOKEN,QUERY_TOKEN} from '../move-in/zendesk-pull-fixture.mjs'

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

  // Disconnect removes the ciphertext and reports Zendesk's revoke outcome.
  const disconnected=await h.call(`${api}/zendesk/connection`,{method:'DELETE'})
  assert.deepEqual(disconnected,{disconnected:true,revoke:{outcome:'revoked',status:204}})
  const [after]=await rows(h,'SELECT state,access_ciphertext,refresh_ciphertext FROM move_in_zendesk_connections')
  assert.deepEqual(after,{state:'disconnected',access_ciphertext:null,refresh_ciphertext:null})
  assert.equal(h.outboundRequests.filter(r=>r.hostname!==`${SUBDOMAIN}.zendesk.com`).length,0,'nothing else was contacted: no mail, AI or notification')
 }finally{await h.close()}
})

test('a refused record never holds back a valid one and a stopped batch is never left behind: credential refusals stay out of packed batches across resume and every valid record imports',{timeout:600_000},async()=>{
 const zendesk=fakeZendesk({refusedPeople:true,credentialTicket:true}),h=await nativeHarness({network:zendesk.handler,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://app.example'}})
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
  const credentialRefusal=pull.refusals.find(r=>r.kind==='ticket'&&r.sourceId==='110')
  assert.ok(credentialRefusal?.reason,'the credential record is already refused by its Zendesk id before batch review resumes')
  async function packedTickets(){
   const records=[]
   for(const batch of (await pullOf(h,second.id)).batches){
    const [run]=await rows(h,'SELECT object_key FROM move_in_runs WHERE id=?',batch.runId)
    const original=await (await h.files).get(run.object_key)
    assert.ok(original)
    records.push(...(await original.text()).split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line)))
   }
   assert.ok(records.every(record=>record.ticket?.id!==110),'the credential-failing ticket never enters any packed original')
   return records.filter(record=>record.ticket).map(record=>String(record.ticket.id)).sort()
  }
  assert.deepEqual(await packedTickets(),['101','102','104','105','109'],'the batch packs every other ticket')
  await h.call(`${api}/zendesk/pulls/${second.id}/resume`,post({}))
  await drain(h)
  pull=await pullOf(h,second.id)
  assert.equal(pull.state,'ready',JSON.stringify({error:pull.error}))
  assert.equal(pull.progress.batchesStopped,0)
  assert.deepEqual(pull.batches.map(b=>b.runId),packedBeforeResume,'resume continues the same batches without packing the refused record again')
  assert.deepEqual(pull.refusals.find(r=>r.kind==='ticket'&&r.sourceId==='110'),credentialRefusal)
  assert.deepEqual(await packedTickets(),['101','102','104','105','109'])

  // Person 8 has no valid email and requests ticket 109, in the same batch as every valid ticket.
  // The approval covers that batch: its valid records import and all refusals are named.
  const ticketBatch=pull.batches.find(b=>b.summary.tickets)
  assert.deepEqual([ticketBatch.summary.tickets,ticketBatch.summary.ticketsNew,ticketBatch.summary.refused,ticketBatch.covered],[5,4,2,true],'a batch with refused records is covered by the one approval')
  await h.call(`${api}/zendesk/pulls/${second.id}/approve`,post({fingerprint:pull.fingerprint}))
  let budget=await drain(h)
  pull=await pullOf(h,second.id)
  assert.equal(pull.state,'applied',JSON.stringify({error:pull.error}))
  assert.ok(budget.maxStatements<=980)
  assert.deepEqual(await sourceIds(h),[['101',1],['102',1],['104',1],['105',1]],'every valid ticket imports beside the refused one')
  assert.deepEqual(pull.refusals.filter(r=>r.kind!=='ticket_field').map(r=>[r.kind,r.sourceId,r.reason]),[['ticket','109','conversation_contact_unavailable'],['ticket','110','CREDENTIAL_IN_DURABLE_URL'],['user','8','contact_email_missing_or_invalid']])
  assert.deepEqual(pull.totals.tickets,{seen:7,deleted:1,imported:4,refused:2,alreadyImported:0})
  assert.equal(accounted(pull.totals.tickets,pull.totals.keptAsImported),pull.totals.tickets.seen,'every ticket seen is accounted for')
  const contacts=async()=>(await rows(h,'SELECT COUNT(*) n FROM contacts'))[0].n
  assert.equal(pull.totals.users,(await contacts())+1+1,'people seen are four contacts, one refused person and one staff author')
  assert.ok(pull.batches.every(b=>b.state==='completed'||b.nothingToImport),'no batch is left behind')

  // A repeat pull with new replies on 101, new tickets 106 and 107, and new person 6 without
  // a valid email who requests ticket 108, all in one batch: everything valid imports.
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
  assert.deepEqual([caughtUp.summary.ticketsNew,caughtUp.summary.replies,caughtUp.summary.refused,caughtUp.covered],[2,2,2,true])
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
  assert.deepEqual(await sourceIds(h),[['101',1],['102',1],['104',1],['105',1],['106',1],['107',1]],'106 and 107 import, 108 and 109 stay out')
  assert.equal((await rows(h,"SELECT COUNT(*) n FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='101'"))[0].n,replies+1,'the new public reply on 101 imports')
  assert.deepEqual(repeat.refusals.filter(r=>r.kind!=='ticket_field').map(r=>[r.kind,r.sourceId,r.reason]),[['ticket','108','conversation_contact_unavailable'],['user','6','contact_email_missing_or_invalid']])
  assert.deepEqual(repeat.totals.tickets,{seen:5,deleted:0,imported:2,refused:1,alreadyImported:1})
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
