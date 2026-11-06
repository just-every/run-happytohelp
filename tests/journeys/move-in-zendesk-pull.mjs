import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {nativeHarness} from '../move-in/harness.mjs'
import {rows} from '../move-in/journey-kit.mjs'
import {fakeZendesk,largeComments,SUBDOMAIN,CLIENT_ID,PATH_TOKEN,QUERY_TOKEN} from '../move-in/zendesk-pull-fixture.mjs'

const api='/api/move-in/projects/p',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const secretish=/synthetic-(?:access|refresh|code)-\d|synthetic-hh-(?:path|query)-token/
// Steps every queued job; a pull waiting on Zendesk's Retry-After or its incremental window has a persisted next_at.
async function drain(h){
 let steps=0,maxStatements=0
 while(h.queued.length){
  assert.ok(steps++<3000,'pull finishes in bounded steps')
  const job=h.queued[0]
  if(job.type==='move-in.zendesk'){const [pull]=await rows(h,'SELECT next_at FROM move_in_zendesk_pulls WHERE id=?',job.id);const wait=(pull?.next_at??0)-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait+20))}
  const result=await h.step();assert.deepEqual(result.effects,{widget:0});assert.deepEqual(result.retried,[]);maxStatements=Math.max(maxStatements,result.statements)
 }
 return {steps,maxStatements}
}
const pullOf=async(h,id)=>(await h.call(`${api}/zendesk/pulls/${id}`)).data

test('an owner connects Zendesk with PKCE, pulls the whole account, approves once, finds tickets by id and pulls again without duplicates',{timeout:600_000},async()=>{
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
  assert.deepEqual(pull.totals.tickets,{seen:5,deleted:1,imported:0,refused:0})
  assert.deepEqual(pull.totals.articles,{seen:3,published:1,draft:1,heldBack:1})
  assert.equal(pull.totals.users,5);assert.equal(pull.totals.organizations,1)
  const waiting=pull.batches.filter(b=>b.waiting)
  assert.equal(waiting.length,1,'the field definitions batch waits with its refusals')
  assert.deepEqual(pull.refusals.filter(r=>r.kind==='ticket_field').map(r=>[r.sourceId,r.reason]),[['71','field_type_not_supported'],['72','field_permissions_require_native_review']])
  assert.doesNotMatch(JSON.stringify(pull),secretish)
  const conversationsBefore=(await rows(h,'SELECT COUNT(*) n FROM conversations'))[0].n
  assert.equal(conversationsBefore,0,'review alone has no native effect')

  // One approval binds every reviewed batch; each refusal-free batch then applies by itself.
  assert.equal((await h.raw(`${api}/zendesk/pulls/${pull.id}/approve`,post({fingerprint:'stale'}))).response.status,409)
  await h.call(`${api}/zendesk/pulls/${pull.id}/approve`,post({fingerprint:pull.fingerprint}))
  const applying=await drain(h)
  pull=await pullOf(h,started.id)
  assert.equal(pull.state,'applied',JSON.stringify({error:pull.error}))
  assert.equal(pull.totals.tickets.imported,4)
  assert.equal(pull.batches.find(b=>b.waiting).state,'ready','a batch with refusals is not applied')
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
  // Ticket 101 changed (a new reply) and person 3 was renamed: the engine never replaces a held
  // record, so both are refused by id before packing, as is new ticket 107 from that person.
  // Neither holds new ticket 106, which imports under the one approval.
  const [{replies}]=await rows(h,"SELECT COUNT(*) replies FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='101'")
  zendesk.state.repeat=true
  const again=(await h.call(`${api}/zendesk/pulls`,post({}))).data
  await drain(h)
  let repeat=await pullOf(h,again.id)
  assert.equal(repeat.state,'ready',JSON.stringify({error:repeat.error}))
  assert.deepEqual(repeat.totals.tickets,{seen:3,deleted:0,imported:0,refused:2})
  assert.deepEqual(repeat.refusals.filter(r=>['ticket','user'].includes(r.kind)).map(r=>[r.kind,r.sourceId,r.reason]),[['ticket','101','source_changed_conflict'],['ticket','107','conversation_contact_rejected'],['user','3','source_changed_conflict']])
  assert.deepEqual(repeat.batches.filter(b=>b.waiting).map(b=>b.summary.refused),[2],'only the refused field definitions wait again')
  assert.ok(repeat.batches.filter(b=>b.summary.tickets).every(b=>b.covered),'no ticket batch waits')
  await h.call(`${api}/zendesk/pulls/${again.id}/approve`,post({fingerprint:repeat.fingerprint}))
  await drain(h)
  repeat=await pullOf(h,again.id)
  assert.equal(repeat.state,'applied',JSON.stringify({error:repeat.error}))
  assert.equal(repeat.totals.tickets.imported,1)
  const sources=await rows(h,'SELECT source_id,COUNT(*) n FROM move_in_conversations GROUP BY source_id ORDER BY CAST(source_id AS INTEGER)')
  assert.deepEqual(sources.map(r=>[r.source_id,r.n]),[['101',1],['102',1],['104',1],['105',1],['106',1]])
  const [{after:repliesAfter}]=await rows(h,"SELECT COUNT(*) after FROM messages m JOIN move_in_conversations s ON s.conversation_id=m.conversation_id WHERE s.source_id='101'")
  assert.equal(repliesAfter,replies,'the changed ticket keeps what was imported')
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM contacts'))[0].n,4,'returning people are not duplicated')

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
