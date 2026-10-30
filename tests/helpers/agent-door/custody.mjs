import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {accessToken,autonomousPolicy} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'

/** The door journey's only answered network edge: a Slack Connect customer channel. */
export async function slackEdge(request){
 const url=new URL(request.url)
 if(url.hostname!=='slack.com')throw new Error('External calls prohibited: '+request.url)
 if(url.pathname==='/api/auth.test')return Response.json({ok:true,team_id:'synthetic-happytohelp-account-slack',user_id:'U12345'},{headers:{'x-oauth-scopes':'chat:write,channels:history,files:read,im:history'}})
 if(url.pathname==='/api/conversations.info')return Response.json({ok:true,channel:{id:url.searchParams.get('channel'),is_member:true,is_ext_shared:true}})
 return Response.json({ok:true,ts:'1710000000.2'})
}
const doorTables=['h2h_agent_operations','agent_door_agents','agent_door_audit','agent_door_events','agent_door_calls','agent_door_approvals','agent_door_reviews']

/** Erasure reaches every door copy, and an agent's ticket work stays internal. */
export async function doorCustody({app,owner,project,native,person,context,call,rpc,adopt,settings,conversation}){
 const stored=async()=>JSON.stringify(await Promise.all(doorTables.map(table=>app.sql(`SELECT * FROM ${table}`))))
 const ownerCookie='h2h_session='+owner.token
 context.consent=randomUUID()
 await adopt()
 // Erasing a teammate after their agent's note keeps the operation, without their name.
 const email='taylor@example.test',sub=randomUUID()
 const invite=(await native(`/api/management/projects/${project}/agents`,{body:{email}})).data
 await app.ok('/api/identity/accept-token',{body:{token:new URL(invite.invitationUrl).searchParams.get('token'),name:'Taylor Support',password:'Disposable-native-taylor-415!zz'}})
 const taylor=(await app.ok('/api/identity/login',{body:{email,password:'Disposable-native-taylor-415!zz'}})).actor
 assert.equal((await settings(4,[{id:sub,email,name:'Taylor Support',role:'member',invite:1}])).status,200)
 const note=await call('happytohelp.conversations.note',{id:conversation.id,content:'Carrier scan checked.',idempotency_key:randomUUID()},await accessToken(context,{sub,email,act:{sub:randomUUID(),name:'Taylor helper',specialist:'support agent'}}))
 assert.equal(note.outcome,'done',JSON.stringify(note))
 assert.match(await stored(),/Taylor/)
 assert.equal((await app.call(`/api/management/projects/${project}/agents/${taylor.id}/erase`,{token:owner.token,body:{}})).status,200)
 const operation=(await call('happytohelp.operations.read',{id:note.result.operation})).result.operation,transcript=await call('happytohelp.conversations.read',{id:conversation.id})
 const name=async id=>(await app.first('SELECT name FROM users WHERE id=?',id)).name
 assert.equal(operation.tool,'happytohelp.conversations.note');assert.equal(operation.sponsor_name,await name(taylor.id),'attribution follows the anonymized account')
 const ownerName=await name(owner.userId)
 assert.ok(transcript.result.activity.some(row=>row.sponsor_name===ownerName&&row.label.endsWith(' for '+ownerName)),'other attribution is unchanged')
 for(const value of [JSON.stringify([operation,transcript,await call('happytohelp.events.list',{limit:200})]),await stored()])assert.doesNotMatch(value,/Taylor|taylor@/)
 // A held note for an erased customer closes durably; another customer's held note still runs once approved.
 await adopt({...autonomousPolicy(),rules:[{id:'all',class:'*',do:'approval',approver:['sponsor'],wait:'PT1H'}]})
 const held={}
 for(const name of ['erin','kai']){
  const contact=(await native(`/api/management/projects/${project}/contacts`,{body:{name,email:`${name}@example.test`}})).data
  const created=await native('/api/conversations',{body:{projectId:project,contactId:contact.id}}),path=`/api/dashboard/projects/${project}/conversations/${created.id}/ticket`
  await native(path,{method:'PATCH',body:{subject:`Refund for ${name}@example.test`,expected_ticket_version:(await native(path)).data.ticket_version}})
  const args={id:created.id,content:`Refund 4417 promised to ${name}@example.test`,idempotency_key:randomUUID()},pending=(await rpc('tools/call',{name:'happytohelp.conversations.note',arguments:args})).data.result
  assert.equal(pending.resultType,'input_required',JSON.stringify(pending))
  held[name]={contact,conversation:created,args,approval:pending._meta['com.runeditrun/approval'].id}
 }
 assert.equal((await native(`/api/management/projects/${project}/contacts/${held.erin.contact.id}/erase`,{body:{}})).data.contact_id,held.erin.contact.id)
 await app.configure({})
 const views=Object.fromEntries((await person('/agents/api/approvals',undefined,ownerCookie)).data.approvals.map(view=>[view.id,view]))
 const erin=views[held.erin.approval],kai=views[held.kai.approval]
 assert.equal(erin.state,'refused');assert.equal(erin.code,'resource_unavailable');assert.equal(kai.state,'pending')
 assert.doesNotMatch(JSON.stringify([erin,await app.sql('SELECT * FROM agent_door_approvals')]),/erin@|4417 promised to erin/)
 for(const [view,state] of [[erin,'refused'],[kai,'executed']])assert.equal((await person(`/agents/api/approvals/${view.id}/approve`,{revision:view.revision,summary_sha256:view.summary_sha256},ownerCookie)).data.approval.state,state)
 for(const [name,count] of [['erin',0],['kai',1]])assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',held[name].conversation.id)).n,count)
 assert.equal((await call('happytohelp.conversations.note',held.erin.args)).outcome,'refused')
 // An agent's assignment of a Slack Connect ticket posts nothing to the customer thread
 // under standard-autonomous, external-blocked policy; a person's assignment still does.
 await adopt({...autonomousPolicy(),rules:[{id:'standard',class:'standard',do:'autonomous'},{id:'external',class:'external',do:'blocked'},{id:'rest',class:'*',do:'blocked'}]})
 const secret='synthetic-happytohelp-1',channel=(await native(`/api/support-channels/projects/${project}/connections`,{body:{provider:'slack',account:'synthetic-happytohelp-account-slack',sender:'U12345',token:'synthetic-happytohelp-2',signing_secret:secret,channels:['C12345678'],registered:true,messaging_service:'synthetic-happytohelp-service'}})).data
 const raw=JSON.stringify({team_id:'synthetic-happytohelp-account-slack',event_id:randomUUID(),event:{type:'message',channel:'C12345678',user:'synthetic-happytohelp-customer',ts:'1710000000.1',text:'Please help with my order'}}),now=String(Math.floor(Date.now()/1000))
 assert.equal((await app.call('/api/support-channels/webhooks/'+channel.id,{body:raw,raw:true,headers:{'Content-Type':'application/json','X-Slack-Request-Timestamp':now,'X-Slack-Signature':'v0='+createHmac('sha256',secret).update(`v0:${now}:${raw}`).digest('hex')}})).status,200)
 const id=(await app.first('SELECT conversation_id FROM support_channel_threads WHERE connection_id=?',channel.id)).conversation_id
 const posts=()=>app.requests.filter(request=>request.url==='https://slack.com/api/chat.postMessage').length,before=posts()
 const ticket=(await call('happytohelp.conversations.read',{id})).result.ticket
 const assigned=await call('happytohelp.conversations.assign',{id,version:ticket.ticket_version,user_id:owner.userId,idempotency_key:randomUUID()})
 assert.equal(assigned.outcome,'done',JSON.stringify(assigned));assert.equal(posts(),before,'an agent assignment stays internal')
 const current=(await native(`/api/dashboard/projects/${project}/conversations/${id}/ticket`)).data
 assert.equal(current.assigned_to,owner.userId)
 await native(`/api/dashboard/projects/${project}/conversations/${id}/ticket`,{method:'PATCH',body:{agent_id:null,expected_ticket_version:current.ticket_version}})
 assert.equal(posts(),before+1,'a person\'s native assignment still posts the thread status')
}
