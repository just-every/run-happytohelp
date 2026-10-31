import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {challengeOf,consentPage,decide} from '../delegation/applications.mjs'

// AUDIT-001: real owner/security, consent, erasure and Reports doors. Only the
// initial signed-in workspaces are fixtures; no audit or report rows are seeded.
export async function auditOutcomesJourney(){
 const custody=randomBytes(32).toString('base64')
 const app=await startApp({bindings:{RER_INSTALLATION_ID:'audit-outcomes',INTEGRATION_ENCRYPTION_KEY:custody}})
 try{
  const w=await app.seedWorkspace('audit-outcomes'),other=await app.seedWorkspace('audit-other')
  const P=`/api/management/projects/${w.projectId}`,A=P+'/audit',connections=P+'/connections',owner=w.tokens.owner
  const ok=(path,body,token=owner,method)=>app.ok(path,{body,token,method})
  const security=()=>ok(A+'?limit=200')
  const exported=async(format='json')=>{
   const response=await app.call(A+'/export?format='+format,{token:owner})
   assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store')
   assert.match(response.headers.get('Content-Disposition'),new RegExp('security-log-.*\\.'+format))
   return response.data
  }

  // The existing workspace token model (no source_product, bindings or overlap).
  const issued=await ok(connections+'/tokens',{name:'Audit workspace reader',scopes:['contacts:read']})
  assert.equal((await app.call('/api/v1/contacts',{token:issued.token})).status,200)
  const rotated=await ok(connections+'/tokens/'+issued.data.id+'/rotate',{})
  assert.notEqual(rotated.token,issued.token)
  assert.equal((await app.call('/api/v1/contacts',{token:issued.token})).status,401,'rotation ends the old bearer')
  assert.equal((await app.call('/api/v1/contacts',{token:rotated.token})).status,200)
  await ok(connections+'/tokens/'+issued.data.id,undefined,owner,'DELETE')
  assert.equal((await app.call('/api/v1/contacts',{token:rotated.token})).status,401,'revocation ends the replacement bearer')
  const stored=await app.sql('SELECT token_hash FROM integration_tokens WHERE namespace=?',w.projectId)
  assert.deepEqual(stored.map(row=>row.token_hash).sort(),[sha(issued.token),sha(rotated.token)].sort())

  // A real stored provider secret is encrypted; exports must omit its plaintext
  // and ciphertext as well as both workspace and delegated bearer credentials.
  const destination=await ok(connections+'/webhooks',{name:'Audit receiver',url:'https://receiver.example.com/events',events:['conversation.created']})
  const cipher=(await app.first('SELECT secret_ciphertext FROM native_integration_destinations WHERE id=?',destination.id)).secret_ciphertext
  assert.ok(cipher&&!cipher.includes(destination.secret),'provider signing material is encrypted under installation custody')
  await ok(connections+'/webhooks/'+destination.id,undefined,owner,'DELETE')

  // Populated support records through native doors: two resolved/rated requests
  // and an unanswered request, so deleting unknowns would change the denominator.
  const tickets=[]
  await app.presenceAwayOff(w.projectId)
  for(let i=0;i<3;i++){
   const headers={Origin:w.allowedOrigin,'CF-Connecting-IP':'198.51.100.'+(80+i)}
   const visitor=await app.ok('/api/identity/widget/session',{headers,body:{widgetKey:w.widgetKey,name:'Audit requester '+i}})
   const conversation=await app.ok('/api/conversations',{token:visitor.token,headers,body:{projectId:w.projectId}})
   const path='/api/conversations/'+conversation.id
   await app.ok(path+'/messages',{token:visitor.token,headers,body:{content:'Synthetic audit request '+i,localId:'opening-'+i,expectedRevision:0}})
   if(i<2){
    const current=await ok(path+'/messages')
    await ok(path+'/messages',{content:'Synthetic human answer '+i,localId:'answer-'+i,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId,authoring:{kind:'human'}})
    const ticketPath=`/api/dashboard/projects/${w.projectId}/conversations/${conversation.id}/ticket`
    const ticket=(await ok(ticketPath)).data
    await ok(ticketPath,{status_id:'solved',expected_version:ticket.ticket_version},owner,'PATCH')
    const resolution=(await ok(path+'/messages')).resolution
    await app.ok(path+'/widget-events',{token:visitor.token,headers,body:{action:'rateResolution',data:{resolutionId:resolution.id,value:i===0?1:-1}}})
   }
   tickets.push(conversation.id)
  }

  // Native connected-application approval, issued by an admin we later erase.
  const browser=(path,{cookie,body,headers={}}={})=>app.request(path,{raw:true,method:body?'POST':'GET',headers:{Cookie:'h2h_session='+cookie,...(body?{'Content-Type':'application/x-www-form-urlencoded',Origin:app.origin}:{}),...headers},body:body&&new URLSearchParams(body).toString()})
  const client={account_id:w.projectId,id:'audit-reader',origin:'https://audit-reader.example.test',redirect_uri:'https://audit-reader.example.test/callback'}
  assert.equal((await browser('/delegation/settings/clients',{cookie:owner,body:client})).status,303)
  const verifier='audit-verifier-'.repeat(5)
  const query=new URLSearchParams({account_id:w.projectId,client_id:client.id,redirect_uri:client.redirect_uri,response_type:'code',state:'audit-consent',code_challenge:await challengeOf(verifier),code_challenge_method:'S256',scope:'support.conversation.read',targets:JSON.stringify([`projects/${w.projectId}/conversations/${tickets[0]}`])})
  const page=await consentPage(browser,query,w.tokens.admin)
  const approved=await decide(browser,page,'approve',w.tokens.admin)
  assert.equal(approved.status,303)
  const code=new URL(approved.headers.get('location')).searchParams.get('code')
  const exchange=await app.call('/api/delegation/v1/token',{raw:true,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.id,redirect_uri:client.redirect_uri,code,code_verifier:verifier}).toString()})
  assert.equal(exchange.status,200)
  const delegated=exchange.data.access_token
  assert.equal((await app.call('/api/delegation/v1/identity',{token:delegated})).status,200)
  // Delegation replaces authority by fresh consent, then withdrawal of the old
  // grant; it has no workspace-token rotation endpoint.
  const oldGrant=(await app.ok('/api/delegation/v1/identity',{token:delegated})).grantId
  query.set('state','audit-replacement-consent')
  const replacementConsent=await decide(browser,await consentPage(browser,query,w.tokens.admin),'approve',w.tokens.admin)
  assert.equal(replacementConsent.status,303)
  const replacementCode=new URL(replacementConsent.headers.get('location')).searchParams.get('code')
  const replacement=await app.ok('/api/delegation/v1/token',{raw:true,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.id,redirect_uri:client.redirect_uri,code:replacementCode,code_verifier:verifier}).toString()})
  assert.notEqual(replacement.access_token,delegated)
  assert.equal((await browser('/delegation/settings/revoke',{cookie:w.tokens.admin,body:{account_id:w.projectId,id:oldGrant}})).status,303)
  assert.equal((await app.call('/api/delegation/v1/identity',{token:delegated})).status,401,'withdrawing the old consent ends its credential')
  assert.equal((await app.call('/api/delegation/v1/identity',{token:replacement.access_token})).status,200)
  assert.equal((await app.call('/api/delegation/v1/revoke',{token:replacement.access_token,body:{}})).status,200)
  assert.equal((await app.call('/api/delegation/v1/identity',{token:replacement.access_token})).status,401,'the replacement also revokes through its own bearer door')

  const before=(await exported()).events
  const approval=before.find(row=>row.action==='delegation.approved'&&row.actor_id===w.users.admin)
  assert.ok(approval,'the approved action appears in the owner audit export')
  assert.equal(approval.category,'approval');assert.equal(approval.source,'dashboard');assert.equal(approval.outcome,'succeeded')
  assert.equal(approval.target_type,'grant');assert.equal(approval.detail.client,client.id)
  assert.equal(approval.actor,`admin audit-outcomes <admin-audit-outcomes@example.test>`)
  assert.ok(before.some(row=>row.action==='token.rotated'&&row.target_id===issued.data.id))
  assert.ok(before.some(row=>row.action==='token.revoke'))
  const durable=await app.first('SELECT * FROM audit_events WHERE id=?',approval.id)

  // Security readers/exports and settings never cross a workspace boundary.
  for(const path of [A,A+'/export?format=json']){
   const denied=await app.call(path,{token:other.tokens.owner})
   assert.equal(denied.status,403);assert.ok(!JSON.stringify(denied.data).includes(approval.id))
  }
  const erased=await ok(`${P}/agents/${w.users.admin}/erase`,{})
  assert.deepEqual(erased,{erased:true,credentialsRevoked:true,eventsRetained:true})
  assert.deepEqual(await app.first('SELECT * FROM audit_events WHERE id=?',approval.id),durable,'actor erasure never rewrites the append-only approval')
  assert.equal((await app.call('/api/identity/session',{token:w.tokens.admin})).status,401)
  const secrets=[custody,issued.token,rotated.token,destination.secret,cipher,delegated,replacement.access_token,code,replacementCode,verifier,owner,w.tokens.admin,'admin-audit-outcomes@example.test','admin audit-outcomes']
  const inspect=async()=>{
   const json=await exported(),csv=await exported('csv')
   const event=json.events.find(row=>row.id===approval.id)
   assert.ok(event);assert.equal(event.actor,'Former teammate');assert.equal(event.actor_id,w.users.admin)
   assert.equal(event.action,'delegation.approved');assert.deepEqual(event.detail,approval.detail)
   assert.match(csv,/delegation\.approved/);assert.match(csv,/Former teammate/)
   for(const bytes of [JSON.stringify(json),csv])for(const secret of secrets)assert.ok(!bytes.includes(secret),'audit exports contain no credential or erased actor identity')
   return event
  }
  await inspect()

  // Hold an actual public-door approval, then advance the real scheduled entry
  // beyond retention. The later unheld retention change is a purge control.
  await ok(A+'/retention',{days:90},owner,'PUT')
  const hold=(await ok(A+'/holds',{name:'Audit evidence',reason:'Preserve the approved support investigation',starts_at:new Date(approval.at).toISOString(),ends_at:new Date(approval.at).toISOString()})).data
  assert.equal((await app.call(A,{token:w.tokens.operator})).status,403)
  const unheld=(await security()).data.find(row=>row.action==='audit.retention_changed')
  assert.ok(unheld&&!unheld.held)
  const date=at=>new Date(at).toISOString().slice(0,10),day=86400000
  const reports=`/api/dashboard/projects/${w.projectId}/reports?period=custom&start=${date(Date.now()-day)}&end=${date(Date.now()+day)}`
  const report=await ok(reports)
  assert.equal(report.volume,3);assert.equal(report.firstResponse.count,2);assert.equal(report.firstResolution.count,2)
  assert.deepEqual(report.aiResolution,{count:0,total:2,rate:0})
  assert.deepEqual(report.satisfaction,{positive:1,total:2,rate:.5})
  // Scheduled ticket autoclose may legitimately move solved -> closed. The
  // evidence/frontiers, resolution times and report treatment must remain exact.
  const support=async()=>({
   conversations:await app.sql('SELECT id,revision,resolved_at FROM conversations WHERE project_id=? ORDER BY id',w.projectId),
   messages:await app.sql('SELECT id,content,revision,actor_id,created_at FROM messages WHERE project_id=? ORDER BY id',w.projectId),
   resolutions:await app.sql('SELECT * FROM conversation_resolutions WHERE project_id=? ORDER BY id',w.projectId),
   ratings:await app.sql('SELECT r.* FROM conversation_ratings r JOIN conversation_resolutions c ON c.id=r.resolution_id WHERE c.project_id=? ORDER BY r.resolution_id',w.projectId),
  })
  const records=await support()
  const settings=async()=>{
   const state=await security()
   assert.equal(state.retentionDays,90)
   assert.ok(state.holds.some(row=>row.id===hold.id&&row.released_at===null))
   assert.ok(state.data.some(row=>row.id===approval.id&&row.held))
  }
  await app.configure({})
  await settings();assert.deepEqual(await ok(reports),report,'restart preserves the full support report')
  assert.deepEqual(await support(),records)
  assert.deepEqual(await app.first('SELECT * FROM audit_events WHERE id=?',approval.id),durable)
  const cleanup=await app.scheduled(undefined,{after:100*day})
  assert.equal(cleanup.ran,true)
  assert.equal(await app.first('SELECT id FROM audit_events WHERE id=?',unheld.id),null,'cleanup really removed the expired unheld control')
  assert.deepEqual(await app.first('SELECT * FROM audit_events WHERE id=?',approval.id),durable,'cleanup retains held evidence byte for byte')
  const purge=(await security()).data.find(row=>row.action==='audit.purged')
  assert.ok(purge.detail.removed>0);assert.ok(purge.detail.keptUnderHold>=1);assert.equal(purge.detail.olderThanDays,90)
  await app.configure({})
  await settings();assert.equal((await inspect()).held,true)
  assert.deepEqual(await support(),records,'cleanup preserves held support records, including the unanswered request')
  assert.deepEqual(await ok(reports),report,'cleanup cannot improve reports by removing evidence or denominators')
  assert.equal(app.requests.length,0,'this audit needs no live account or external network substitute')
 }finally{await app.close()}
}
