// PENDING 2026-10-28 / Base 7ce44fa5: normal conformance retains the
// BASE-AGENT-009.native-target, BASE-AGENT-003.resource-code,
// BASE-AGENT-012.replay-authority and BASE-AGENT-007.reviewer-lifecycle assertions.
// BASE-AGENT-013.events-clause is also pending a Base mapping/ct clause: the
// built-in BASE-AGENT-010 reference is absent from the current seed contract.
// These dependencies are not skips or substitutes for the normal verifier.
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {webcrypto,randomUUID} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {accessToken,autonomousPolicy,policyEnvelope,signJws,seconds} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'

export async function agentDoorJourney(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),kid=randomUUID(),issuer='https://business.example.test',installationId=randomUUID(),origin='https://app.example',email='morgan@example.test',sub=randomUUID(),publicKeys={[kid]:await webcrypto.subtle.exportKey('jwk',pair.publicKey)},token=randomUUID()
 const app=await startApp({bindings:{APP_ORIGIN:origin,H2H_SETUP_TOKEN:token,H2H_SETUP_OWNER_EMAIL:email,RER_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_APP_ORIGIN:origin,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(publicKeys),RER_BUSINESS_TRUST:JSON.stringify({v:1,issuer,audience:origin,subject:installationId,email,keys:publicKeys})}})
 try{
  const owner=await app.ok('/api/identity/bootstrap',{body:{setupToken:token,email,password:'Disposable-native-owner-892!zz',allowedOrigin:'https://store.example.test',ownerName:'Morgan Support'}})
  const native=(path,options={})=>app.ok(path,{token:owner.token,...options})
  const project=owner.projectId
  const memberEmail='jordan@example.test',memberSub=randomUUID(),memberAgent=randomUUID()
  const invite=(await native(`/api/management/projects/${project}/agents`,{body:{email:memberEmail}})).data
  await app.ok('/api/identity/accept-token',{body:{token:new URL(invite.invitationUrl).searchParams.get('token'),name:'Jordan Support',password:'Disposable-native-jordan-693!zz'}})
  const member=await app.ok('/api/identity/login',{body:{email:memberEmail,password:'Disposable-native-jordan-693!zz'}})
  assert.equal((await app.first('SELECT project_id FROM h2h_business_project WHERE singleton=1')).project_id,project)
  const settings=async(rev,team=null)=>{
   const iat=seconds(),settings=await signJws(pair.privateKey,kid,'rer-business-settings+jwt',{v:1,iss:issuer,aud:origin,sub:installationId,business:'support-company',email,owner_id:sub,jti:randomUUID(),iat,exp:iat+300,rev,values:{},logo:null,team})
   return app.call('/api/rer/business-settings',{body:{settings}})
  }
  const paired=await settings(1);assert.equal(paired.status,200,JSON.stringify(paired.data))
  const team=await settings(2,[{id:memberSub,email:memberEmail,name:'Jordan Support',role:'member',invite:1}]);assert.equal(team.status,200,JSON.stringify(team.data))
  assert.equal((await app.first('SELECT operator_id FROM bs_team WHERE business_id=?',memberSub)).operator_id,member.actor.id)
  const contact=(await native(`/api/management/projects/${project}/contacts`,{body:{name:'Avery Buyer',email:'avery@example.test'}})).data
  const conversation=await native('/api/conversations',{body:{projectId:project,contactId:contact.id}})
  const article=await native(`/api/knowledge/${project}/articles`,{body:{title:'Shipping answer',content:'Orders ship within two business days.',status:'draft'}})
  const context={origin,signer:{issuer,installationId,kid,privateKey:pair.privateKey},person:{email,sub},agentId:randomUUID(),business:'support-company',consent:randomUUID(),revision:0,seq:0,surface:JSON.parse(await readFile(new URL('../../../agent-surface.json',import.meta.url),'utf8'))}
  const rpc=async(method,params={},credential)=>{
   const response=await app.call('/mcp',{body:{jsonrpc:'2.0',id:randomUUID(),method,params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{url:{}}},'io.modelcontextprotocol/clientInfo':{name:'support-native-journey',version:'1'}}}},headers:{'Mcp-Method':method,...(['tools/call','resources/read'].includes(method)?{'Mcp-Name':params.name??params.uri}:{}),Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28',Authorization:'Bearer '+(credential??await accessToken(context))}})
   return response
  }
  const catalogue=await rpc('tools/list')
  assert.equal(catalogue.status,200,JSON.stringify(catalogue.data))
  const tools=catalogue.data.result.tools
  assert.equal(new Set(tools.map(tool=>tool.name)).size,tools.length)
  assert.equal(tools.length,0,'policy-unset tools remain unavailable')
  const call=async(name,args,credential)=>{const response=await rpc('tools/call',{name,arguments:args},credential);assert.ok(response.data.result,JSON.stringify(response.data));const result=response.data.result;return {outcome:result.resultType==='input_required'?'pending':result.isError?'refused':'done',code:result._meta?.['com.runeditrun/error']?.code,result:result.structuredContent}}
  const unset=await call('happytohelp.conversations.note',{id:conversation.id,content:'Policy unset must not create this note',idempotency_key:randomUUID()})
  assert.equal(unset.code,'policy_unset')
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n,0)
  const adopt=async(document=autonomousPolicy(),options={})=>{
   const envelope=await policyEnvelope(context,document,options),response=await app.call('/api/rer/agent-policy',{body:{policy:envelope.policy}})
   assert.equal(response.status,200,JSON.stringify(response.data));context.revision=envelope.payload.revision;context.seq=envelope.payload.seq
   assert.deepEqual(Object.keys(response.data).sort(),['adopted','door'])
   return response
  }
  await adopt()
  const declared=(await rpc('tools/list')).data.result.tools
  assert.deepEqual(declared.map(t=>t.name).sort(),context.surface.tools.map(t=>t.name).sort())
  for(const tool of declared){const entry=context.surface.tools.find(item=>item.name===tool.name);assert.deepEqual(tool._meta['com.runeditrun/classes'],entry.classes);assert.deepEqual(tool._meta['com.runeditrun/clauses'],entry.clauses);assert.equal(tool._meta['com.runeditrun/scope'],entry.scope)}
  const result=await call('happytohelp.conversations.read',{id:conversation.id})
  assert.equal(result.outcome,'done',JSON.stringify(result))
  assert.equal(result.result.ticket.id,conversation.id)
  const idempotency_key=randomUUID(),note=await call('happytohelp.conversations.note',{id:conversation.id,content:'Private support investigation: verify before replying.',idempotency_key})
  assert.equal(note.outcome,'done',JSON.stringify(note))
  assert.equal((await call('happytohelp.conversations.note',{id:conversation.id,content:'Private support investigation: verify before replying.',idempotency_key})).result.note.id,note.result.note.id)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n,1)
  const operation=await app.first('SELECT * FROM h2h_agent_operations WHERE id=?',note.result.operation)
  assert.equal(operation.agent_id,context.agentId);assert.equal(operation.sponsor_id,owner.userId)
  assert.equal((await call('happytohelp.conversations.note',{id:conversation.id,content:'Changed intent',idempotency_key})).code,'idempotency_conflict')
  const ticket=(await call('happytohelp.conversations.read',{id:conversation.id})).result.ticket
  const updated=await call('happytohelp.conversations.update',{id:conversation.id,version:ticket.ticket_version,subject:'Shipping investigation',expected_revision:ticket.ticket_version,idempotency_key:randomUUID()})
  assert.equal(updated.outcome,'done',JSON.stringify(updated))
  assert.equal((await call('happytohelp.conversations.update',{id:conversation.id,version:ticket.ticket_version,subject:'Stale edit',expected_revision:ticket.ticket_version,idempotency_key:randomUUID()})).code,'revision_conflict')
  assert.equal((await call('happytohelp.articles.read',{id:article.id})).outcome,'done')
  assert.equal((await rpc('resources/read',{uri:`happytohelp://projects/${project}/conversations/${conversation.id}`})).data.error,undefined)
  const absent=await rpc('resources/read',{uri:`happytohelp://projects/${project}/conversations/missing`}),foreign=await rpc('resources/read',{uri:`happytohelp://projects/foreign/conversations/${conversation.id}`})
  assert.deepEqual(absent.data.error,foreign.data.error)
  const invalid=await rpc('tools/list',{},await accessToken(context,{sub:randomUUID(),email}));assert.equal(invalid.status,401)
  const wrongAudience=await rpc('tools/list',{},await accessToken(context,{aud:'https://foreign.example/mcp'}));assert.equal(wrongAudience.status,401)
  // Native email reassignment does not transfer the signed Business binding.
  await app.ok('/api/management/profile',{method:'PUT',token:member.token,body:{name:'Jordan Support',email:'jordan.new@example.test'}})
  const replacementInvite=(await native(`/api/management/projects/${project}/agents`,{body:{email:memberEmail}})).data
  await app.ok('/api/identity/accept-token',{body:{token:new URL(replacementInvite.invitationUrl).searchParams.get('token'),name:'Casey Support',password:'Disposable-native-casey-781!zz'}})
  const replacement=await app.ok('/api/identity/login',{body:{email:memberEmail,password:'Disposable-native-casey-781!zz'}})
  const memberToken=await accessToken(context,{sub:memberSub,email:memberEmail,act:{sub:memberAgent,name:'Jordan helper',specialist:'support agent'}})
  const memberNote=await call('happytohelp.conversations.note',{id:conversation.id,content:'A durable Business id still acts for Jordan after the email changes.',idempotency_key:randomUUID()},memberToken)
  assert.equal(memberNote.outcome,'done',JSON.stringify(memberNote))
  const memberOperation=await app.first('SELECT sponsor_id FROM h2h_agent_operations WHERE id=?',memberNote.result.operation)
  assert.equal(memberOperation.sponsor_id,member.actor.id);assert.notEqual(memberOperation.sponsor_id,replacement.actor.id)
  const removed=await settings(3,[]);assert.equal(removed.status,200)
  assert.equal((await rpc('tools/list',{},memberToken)).status,401,'native membership removal ends sponsorship immediately')
  const before=(await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n
  await adopt(autonomousPolicy(),{paused:true})
  assert.equal((await call('happytohelp.conversations.note',{id:conversation.id,content:'Must be paused',idempotency_key:randomUUID()})).code,'agents_paused')
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n,before)
  await native(`/api/dashboard/projects/${project}/conversations/${conversation.id}/notes`,{body:{content:'Person can still work while agents are paused'}})
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n,before+1)
  await adopt(autonomousPolicy(),{revoked:{agents:[],consents:[context.consent]}})
  assert.equal((await rpc('tools/call',{name:'happytohelp.conversations.note',arguments:{id:conversation.id,content:'Revoked consent cannot act',idempotency_key:randomUUID()}})).status,401)
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n,before+1)
  const audit=(await app.sql('SELECT row FROM agent_door_audit')).map(row=>JSON.parse(row.row))
  assert.ok(audit.some(row=>row.outcome==='done'));assert.ok(audit.some(row=>row.outcome==='refused'))
  assert.equal(app.requests.filter(request=>!['GET','HEAD'].includes(request.method)).length,0,'internal support work performs no provider mutation or external send')
 }finally{await app.close()}
}
