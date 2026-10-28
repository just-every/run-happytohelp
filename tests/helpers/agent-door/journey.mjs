// PENDING 2026-10-28 / Base e1b4265e: BASE-AGENT-013.events-clause
// still needs ct's seed contract mapping for the built-in BASE-AGENT-010.
// The native target, resource-code, replay-authority and reviewer-lifecycle
// dependencies are executable assertions below. No access/security tool is
// exposed, so sponsor-escalation fixtures remain inapplicable to this surface.
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {webcrypto,randomUUID} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {protectedFeedback} from './feedback.mjs'
import initializeReviewer from './initialize-reviewer.mjs'
import {accessToken,autonomousPolicy,policyEnvelope,signJws,seconds} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'

export async function agentDoorJourney({inspect=async()=>{}}={}){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),kid=randomUUID(),issuer='https://business.example.test',installationId=randomUUID(),origin='https://app.example',email='morgan@example.test',sub=randomUUID(),publicKeys={[kid]:await webcrypto.subtle.exportKey('jwk',pair.publicKey)},token=randomUUID()
 const app=await startApp({bindings:{APP_ORIGIN:origin,H2H_SETUP_TOKEN:token,H2H_SETUP_OWNER_EMAIL:email,RER_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_APP_ORIGIN:origin,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(publicKeys),RER_BUSINESS_TRUST:JSON.stringify({v:1,issuer,audience:origin,subject:installationId,email,keys:publicKeys})}})
 try{
  const owner=await app.ok('/api/identity/bootstrap',{body:{setupToken:token,email,password:'Disposable-native-owner-892!zz',allowedOrigin:'https://store.example.test',ownerName:'Morgan Support'}})
  const native=(path,options={})=>app.ok(path,{token:owner.token,...options})
  const project=owner.projectId
  await protectedFeedback({origin,owner,allowedOrigin:'https://store.example.test',request:(url,init)=>app.request(new URL(url).pathname,{...init,raw:true})})
  const memberEmail='jordan@example.test',memberSub=randomUUID(),memberAgent=randomUUID()
  const reviewer=await initializeReviewer({origin,email:memberEmail,owner:{cookie:'h2h_session='+owner.token},request:(url,init)=>app.request(new URL(url).pathname,{...init,raw:true})})
  assert.equal(reviewer.status,303)
  const memberCookie=reviewer.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
  assert.notEqual(memberCookie,'h2h_session='+owner.token)
  const signedIn=await app.ok('/api/management/bootstrap',{headers:{Cookie:memberCookie}})
  assert.equal(signedIn.currentAgent.name,'Jordan Support')
  const member={actor:{id:signedIn.currentAgent.id},token:memberCookie.split('h2h_session=')[1].split(';')[0]}
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
  const call=async(name,args,credential)=>{const response=await rpc('tools/call',{name,arguments:args},credential);assert.ok(response.data.result,JSON.stringify(response.data));const result=response.data.result;return {outcome:result.resultType==='input_required'?'pending':result.isError?'refused':'done',code:result._meta?.['com.runeditrun/error']?.code,result:result.structuredContent,meta:result._meta}}
  assert.ok(context.surface.tools.every(tool=>!tool.classes.some(cls=>['access','security'].includes(cls))),'no native authority-changing tool is exposed; escalation fixtures cannot invent a widening action')
  assert.deepEqual(context.surface.escalations,[])
  const unset=await call('happytohelp.conversations.note',{id:conversation.id,content:'Policy unset must not create this note',idempotency_key:randomUUID()})
  assert.equal(unset.code,'policy_unset')
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n,0)
  const unsetAudit=JSON.parse((await app.first('SELECT row FROM agent_door_audit ORDER BY sequence DESC LIMIT 1')).row)
  assert.deepEqual(unsetAudit.resource,{kind:'conversation',id:conversation.id})
  assert.deepEqual(unsetAudit.classes,[{class:'standard',facts:{measure:1}}])
  assert.equal(unsetAudit.decision,'unset')
  const adopt=async(document=autonomousPolicy(),options={})=>{
   const envelope=await policyEnvelope(context,document,options),response=await app.call('/api/rer/agent-policy',{body:{policy:envelope.policy}})
   assert.equal(response.status,200,JSON.stringify(response.data));context.revision=envelope.payload.revision;context.seq=envelope.payload.seq
   assert.deepEqual(Object.keys(response.data).sort(),['adopted','door'])
   return response
  }
  await adopt()
  const applied=(await app.first('SELECT envelope FROM agent_door_state WHERE id=1')).envelope
  for(const overrides of [{aud:'https://another-installation.example.test'},{exp:seconds()-1}]){
   const invalid=await policyEnvelope(context,autonomousPolicy(),overrides)
   const refused=await app.call('/api/rer/agent-policy',{body:{policy:invalid.policy}})
   assert.equal(refused.status,400);assert.equal(refused.data.code,'policy_invalid')
   assert.equal((await app.first('SELECT envelope FROM agent_door_state WHERE id=1')).envelope,applied,'invalid adoption preserves the applied policy exactly')
  }
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
  const noteAudit=JSON.parse((await app.first("SELECT row FROM agent_door_audit WHERE json_extract(row,'$.idempotency_key')=? AND json_extract(row,'$.outcome')='done'",idempotency_key)).row)
  assert.deepEqual(noteAudit.resource,{kind:'conversation',id:conversation.id})
  const replayArgs={id:conversation.id,content:'Private support investigation: verify before replying.',idempotency_key}
  for(const [document,options,code] of [
   [{...autonomousPolicy(),rules:[{id:'all',class:'*',do:'blocked'}]},{},'policy_blocked'],
   [autonomousPolicy(),{paused:true},'agents_paused'],
   [{...autonomousPolicy(),rules:[{id:'all',class:'*',do:'approval',approver:['sponsor'],wait:'PT1H'}]},{},'approval_required'],
  ]){
   await adopt(document,options)
   const refused=await call('happytohelp.conversations.note',replayArgs)
   assert.equal(refused.code,code);assert.equal(refused.result,undefined,'current admission withholds a cached native result')
   assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n,1)
   const row=JSON.parse((await app.first('SELECT row FROM agent_door_audit ORDER BY sequence DESC LIMIT 1')).row)
   assert.equal(row.code,code);assert.equal(row.sponsor.id,owner.userId);assert.equal(row.agent.id,context.agentId)
   assert.deepEqual(row.resource,{kind:'conversation',id:conversation.id});assert.equal(row.revision,context.revision)
  }
  await adopt()
  const narrowReplay=await rpc('tools/call',{name:'happytohelp.conversations.note',arguments:replayArgs},await accessToken(context,{scope:'events:read'}))
  assert.equal(narrowReplay.status,403);assert.equal(narrowReplay.data.error.data.code,'insufficient_scope')
  assert.deepEqual((await call('happytohelp.conversations.note',replayArgs)).result,note.result)
  const ticket=(await call('happytohelp.conversations.read',{id:conversation.id})).result.ticket
  const updated=await call('happytohelp.conversations.update',{id:conversation.id,version:ticket.ticket_version,subject:'Shipping investigation',expected_revision:ticket.ticket_version,idempotency_key:randomUUID()})
  assert.equal(updated.outcome,'done',JSON.stringify(updated))
  assert.equal((await call('happytohelp.conversations.update',{id:conversation.id,version:ticket.ticket_version,subject:'Stale edit',expected_revision:ticket.ticket_version,idempotency_key:randomUUID()})).code,'revision_conflict')
  assert.equal((await call('happytohelp.conversations.update',{id:conversation.id,version:ticket.ticket_version,subject:'Stale native version without a door revision hint',idempotency_key:randomUUID()})).code,'revision_conflict')
  assert.equal((await native(`/api/dashboard/projects/${project}/conversations/${conversation.id}/ticket`)).data.subject,'Shipping investigation')
  const assigned=await call('happytohelp.conversations.assign',{id:conversation.id,version:updated.result.ticket.ticket_version,user_id:owner.userId,idempotency_key:randomUUID()})
  assert.equal(assigned.outcome,'done',JSON.stringify(assigned))
  assert.equal((await native(`/api/dashboard/projects/${project}/conversations/${conversation.id}/ticket`)).data.assigned_to,owner.userId)
  const person=(path,body,session=member.token)=>app.call(path,{...(body===undefined?{}:{body}),headers:{Origin:origin,Cookie:'h2h_session='+session}})
  const noteCount=async()=>(await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',conversation.id)).n
  await adopt({...autonomousPolicy(),rules:[{id:'all',class:'*',do:'review'}],reviewers:[`person:${memberSub}`]})
  const reviewed=await call('happytohelp.conversations.note',{id:conversation.id,content:'Independently reviewed support investigation',idempotency_key:randomUUID()})
  assert.equal(reviewed.outcome,'done')
  const reviewId=reviewed.meta['com.runeditrun/review'].id
  assert.equal((await person(`/agents/api/reviews/${reviewId}/reviewed`,{},owner.token)).status,403)
  const marked=await person(`/agents/api/reviews/${reviewId}/reviewed`,{})
  assert.equal(marked.status,200);assert.equal(marked.data.review.state,'reviewed');assert.equal(marked.data.review.marked_by,member.actor.id)
  await inspect({app,origin,owner,member,state:'reviewed',path:'/agents'})
  await adopt({...autonomousPolicy(),rules:[{id:'all',class:'*',do:'approval',approver:[`person:${memberSub}`],wait:'PT1H'}]})
  const heldArgs={id:conversation.id,content:'Exact support note approved by Jordan',idempotency_key:randomUUID()},beforeApproval=await noteCount()
  const pending=await call('happytohelp.conversations.note',heldArgs)
  assert.equal(pending.outcome,'pending');assert.equal(await noteCount(),beforeApproval)
  const approvalId=pending.meta['com.runeditrun/approval'].id
  const view=await person(`/agents/api/approvals/${approvalId}`)
  assert.equal(view.status,200)
  assert.deepEqual(view.data.approval.summary.nativeTarget,{kind:'conversation',id:conversation.id})
  await inspect({app,origin,owner,member,state:'pending',path:`/agents/approvals/${approvalId}`})
  const decision={revision:view.data.approval.revision,summary_sha256:view.data.approval.summary_sha256}
  assert.equal((await person(`/agents/api/approvals/${approvalId}/approve`,{...decision,summary_sha256:'0'.repeat(64)})).status,409)
  assert.equal(await noteCount(),beforeApproval)
  const approved=await person(`/agents/api/approvals/${approvalId}/approve`,decision)
  assert.equal(approved.status,200);assert.equal(approved.data.approval.state,'executed')
  assert.equal(approved.data.approval.approvals[0].person,member.actor.id)
  assert.equal(await noteCount(),beforeApproval+1)
  await person(`/agents/api/approvals/${approvalId}/approve`,decision)
  assert.equal(await noteCount(),beforeApproval+1,'a repeated person approval has one native effect')
  const nativeApproval=await app.first('SELECT * FROM h2h_agent_operations WHERE target_id=? AND json_array_length(approvers_json)>0',conversation.id)
  assert.equal(nativeApproval.agent_id,context.agentId);assert.equal(nativeApproval.sponsor_id,owner.userId)
  assert.deepEqual(JSON.parse(nativeApproval.approvers_json).map(person=>person.id),[member.actor.id])
  const execution=JSON.parse((await app.first("SELECT row FROM agent_door_audit WHERE json_extract(row,'$.decision_id')=?",view.data.approval.decision_id)).row)
  assert.deepEqual(execution.resource,{kind:'conversation',id:conversation.id});assert.equal(execution.outcome,'done')
  await inspect({app,origin,owner,member,state:'executed',path:`/agents/approvals/${approvalId}`})
  await adopt()
  const pairing=(await native(`/api/projects/${project}/local-agents/pairings`,{body:{}})).data
  const device=(await native('/api/local-agents/pair',{body:{code:pairing.code,provider:'codex',name:'Unconnected investigation device',capabilities:[]}})).data
  const job=(await native(`/api/projects/${project}/conversations/${conversation.id}/delegations`,{body:{request_id:randomUUID(),device_id:device.device.id,mode:'investigate',instructions:'Investigate only; no repair or customer reply authority.'}})).data
  const day=at=>new Date(at).toISOString().slice(0,10)
  for(const [name,args] of [
   ['conversations.list',{}],['context.read',{id:conversation.id}],['articles.list',{}],['jobs.read',{id:job.id}],['operations.read',{id:note.result.operation}],
   ['reports.read',{start:day(Date.now()-86400000),end:day(Date.now()+86400000)}],['people.read',{}],['workflows.read',{}],['ai.read',{}],['integrations.read',{}],['events.list',{}],
  ]){const read=await call('happytohelp.'+name,args);assert.equal(read.outcome,'done',name+': '+JSON.stringify(read))}
  const observedJob=(await call('happytohelp.jobs.read',{id:job.id})).result.job
  assert.equal(observedJob.status,'queued');assert.match(observedJob.observation,/unconfirmed/)
  const report=await rpc('tools/call',{name:'happytohelp.reports.read',arguments:{start:day(Date.now()-86400000),end:day(Date.now()+86400000)}})
  assert.ok(report.data.result._meta['com.runeditrun/decision'].classes.some(item=>item.class==='sensitive'),'native protected customer feedback adds sensitive to the report read')
  await adopt({...autonomousPolicy(),rules:[{id:'all',class:'*',do:'autonomous'},{id:'protected',class:'sensitive',do:'blocked'}]})
  const protectedReport=await call('happytohelp.reports.read',{start:day(Date.now()-86400000),end:day(Date.now()+86400000)})
  assert.equal(protectedReport.code,'policy_blocked');assert.ok(!JSON.stringify(protectedReport).includes('321-54-6789'))
  assert.equal((await call('happytohelp.reports.read',{start:'2000-01-01',end:'2000-01-02'})).outcome,'done','a native report without protected comments stays standard')
  await adopt()
  assert.equal((await call('happytohelp.articles.read',{id:article.id})).outcome,'done')
  for(const path of [`conversations/${conversation.id}`,`conversations/${conversation.id}/context`,`articles/${article.id}`,`jobs/${job.id}`,`operations/${note.result.operation}`])assert.equal((await rpc('resources/read',{uri:`happytohelp://projects/${project}/${path}`})).data.error,undefined,path)
  const absent=await rpc('resources/read',{uri:`happytohelp://projects/${project}/conversations/missing`}),foreign=await rpc('resources/read',{uri:`happytohelp://projects/foreign/conversations/${conversation.id}`})
  assert.deepEqual(absent.data.error,foreign.data.error)
  assert.equal(absent.data.error.data.code,'resource_unavailable')
  await adopt({...autonomousPolicy(),rules:[{id:'all',class:'*',do:'blocked'}]})
  const blockedResource=await rpc('resources/read',{uri:`happytohelp://projects/${project}/conversations/${conversation.id}`})
  assert.equal(blockedResource.data.error.data.code,'policy_blocked');assert.equal(blockedResource.data.result,undefined)
  await inspect({app,origin,owner,member,state:'blocked',path:'/agents'})
  await adopt()
  const invalid=await rpc('tools/list',{},await accessToken(context,{sub:randomUUID(),email}));assert.equal(invalid.status,401)
  const wrongAudience=await rpc('tools/list',{},await accessToken(context,{aud:'https://foreign.example/mcp'}));assert.equal(wrongAudience.status,401)
  // A real selected-article application credential keeps its original scope
  // through MCP. It never acquires a browser session or ticket-write authority.
  const form=(path,body,cookie)=>app.request(path,{raw:true,body:new URLSearchParams(body).toString(),headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',...(cookie?{Cookie:'h2h_session='+cookie}:{})}})
  const registration={account_id:project,id:'support-reference',origin:'https://reference.example.test',redirect_uri:'https://reference.example.test/callback'}
  assert.equal((await form('/delegation/settings/clients',registration,owner.token)).status,303)
  const verifier='native-selected-reference-'.repeat(3),challenge=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url')
  const query=new URLSearchParams({client_id:registration.id,redirect_uri:registration.redirect_uri,response_type:'code',state:'support-reference',code_challenge:challenge,code_challenge_method:'S256',account_id:project,scope:'knowledge.article.read',targets:JSON.stringify([`projects/${project}/articles/${article.id}`])})
  const consent=(await app.ok('/delegation/authorize/request?'+query,{headers:{Cookie:'h2h_session='+owner.token}})).data
  const allowed=await form('/delegation/authorize',{decision:'approve',request:JSON.stringify(consent.request),issued:String(consent.issued),csrf:consent.csrf},owner.token)
  assert.equal(allowed.status,303)
  const exchange=await form('/api/delegation/v1/token',{grant_type:'authorization_code',client_id:registration.id,redirect_uri:registration.redirect_uri,code:new URL(allowed.headers.get('location')).searchParams.get('code'),code_verifier:verifier})
  assert.equal(exchange.status,200)
  const localToken=(await exchange.json()).access_token
  assert.deepEqual((await rpc('resources/templates/list',{},localToken)).data.result.resourceTemplates.map(resource=>resource.uriTemplate),['happytohelp://projects/{project}/articles/{id}'])
  assert.equal((await call('happytohelp.articles.read',{id:article.id},localToken)).outcome,'done')
  assert.equal((await call('happytohelp.articles.read',{id:randomUUID()},localToken)).outcome,'refused')
  // Scope admission is an HTTP authorization challenge, before tool execution.
  const scopedWrite=await rpc('tools/call',{name:'happytohelp.conversations.note',arguments:{id:conversation.id,content:'A selected article credential cannot write tickets',idempotency_key:randomUUID()}},localToken)
  assert.equal(scopedWrite.status,403)
  assert.equal(scopedWrite.data.error.data.code,'insufficient_scope')
  assert.equal((await app.call('/api/delegation/v1/revoke',{token:localToken,body:{}})).status,200)
  assert.equal((await rpc('tools/list',{},localToken)).status,401)
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
  assert.equal(app.requests.filter(request=>!['GET','HEAD'].includes(request.method)).length,0,'the configured network boundary receives no mutating provider request')
 }finally{await app.close()}
}
