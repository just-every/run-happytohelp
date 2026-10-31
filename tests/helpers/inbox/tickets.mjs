import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {ticketFixture} from './ticket-fixture.mjs'
import {deskWorkflows} from '../workflows/desk-flow.mjs'
import {deskCollaboration} from './desk-collaboration.mjs'
import {queueWork,securityLog} from './queue-work.mjs'

// One replacement request moves through the shared desk. Previewed operations,
// private collaboration and automation all use the same native ticket history.
export async function ticketsJourney(){
 const initial=Date.parse('2026-11-02T09:00:00Z'),sent=[]
 const f=await ticketFixture({bindings:{H2H_WORKFLOW_NOW:String(initial),INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async request=>{
  const host=new URL(request.url).hostname
  if(host==='api.resend.com'){
   const mail=await request.json();sent.push(mail)
   if(mail.text?.includes('Scheduled replacement lost'))throw new TypeError('Connection lost after accepting scheduled mail')
   if(mail.text?.includes('Scheduled replacement refused'))return new Response('Mailbox refused the reply',{status:422})
   return Response.json({id:'desk-mail-'+sent.length})
  }
  if(host==='hooks.example.com'){const mode=new URL(request.url).pathname;if(mode==='/lost')throw new TypeError('Connection lost after accepting workflow request');return new Response('',{status:mode==='/reject'?422:200})}
  if(host==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  throw new Error('Unexpected desk provider '+host)
 }})
 const {app,w,foreign,id,ok,call,get,patch,visitor}=f
 try{
  const field=await ok('/ticket-fields',{name:'Replacement reference',type:'text',required:true})
  const privateField=await ok('/ticket-fields',{name:'Fraud review',type:'text',read_roles:['owner'],write_roles:['owner']})
  const group=await ok('/ticket-groups',{name:'Returns',members:[w.users.owner,w.users.operator]})
  const pending=await ok('/ticket-statuses',{name:'Waiting for label',category:'pending'})
  await patch(id,{subject:'Replacement for order TO-48200',group_id:group.id,fields:{[field.id]:'RMA-123',[privateField.id]:'Internal investigation'}})
  assert.equal((await get(id)).fields[field.id],'RMA-123')
  const operator=(await call(`/conversations/${id}/ticket`,undefined,'operator')).data.data
  assert.equal(operator.fields[privateField.id],undefined);assert.ok(!JSON.stringify(operator.history).includes('Internal investigation'))
  assert.equal((await call(`/conversations/${id}/ticket`,{fields:{[privateField.id]:'No'}},'operator','PATCH')).status,403)
  assert.equal((await call('/ticket-groups',{name:'Foreign',members:[foreign.users.owner]})).status,400)
  const tag=await ok(`/conversations/${id}/tags`,{name:'Replacement'})
  const upload=await app.ok(`/api/conversations/${id}/media`,{token:w.tokens.owner,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'return-label.txt'},body:'Return label bytes'})
  const macro=await ok('/macros',{title:'Arrange replacement',content:'Hello {{requester.first_name | there}}, reference {{ticket.custom.'+field.id+'}}. {{ticket.custom.missing}}',actions:{reply_type:'public',status_id:pending.id,priority:'high',group_id:group.id,agent_id:w.users.operator,fields:{[field.id]:'RMA-456'},followers:[w.users.owner,w.users.operator],tags_add:[tag.id],attachments:[upload.id]},scope:{visibility:'group',groups:[group.id],roles:['owner','operator'],brands:[w.projectId]}})
  const selection=[{id,expected_version:(await get(id)).ticket_version}]
  const macroCall=(action,extra={})=>ok(`/macros/${macro.id}/${action}`,{version:macro.version,tickets:selection,...extra})
  const before=await get(id),preview=(await macroCall('preview')).results[0]
  assert.equal(preview.status,'ready');assert.deepEqual(preview.draft.unresolved,['ticket.custom.missing']);assert.deepEqual(await get(id),before)
  const applied=(await macroCall('apply',{command_id:'replacement-macro'})).results[0]
  assert.equal(applied.status,'applied');assert.equal((await get(id)).assigned_to,w.users.operator);assert.equal((await get(id)).status_id,pending.id);assert.equal((await get(id)).fields[field.id],'RMA-456')
  assert.equal((await macroCall('apply',{command_id:'replacement-macro'})).results[0].status,'duplicate')
  assert.equal((await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})).messages.length,1,'applying a macro saves a draft')
  assert.equal((await app.call(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'unreviewed',content:applied.draft.content,expectedRevision:(await get(id)).revision}})).status,422)
  const saved=await ok(`/conversations/${id}/macro-draft`);assert.equal(saved.content,applied.draft.content)
  const edited=saved.content.replace('{{ticket.custom.missing}}','Your return label is attached.')
  await app.ok(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'reviewed-replacement',content:edited,mediaIds:saved.media_ids,expectedRevision:(await get(id)).revision}})
  const visible=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token});assert.equal(visible.messages.at(-1).content,edited);assert.equal(visible.messages.at(-1).media.length,1)
  await deskCollaboration(f)

  const second=await queueWork(f,{field,pending,tag})
  const unnamed=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey},headers:{Origin:w.allowedOrigin}})
  const unnamedTicket=await app.ok('/api/conversations',{token:unnamed.token,body:{projectId:w.projectId}})
  const fallback=(await ok(`/macros/${macro.id}/preview`,{version:macro.version,tickets:[{id:unnamedTicket.id,expected_version:0}]})).results[0]
  assert.match(fallback.draft.content,/Hello there/)
  const restricted=await ok('/macros',{title:'Owner review',content:'Reviewed only',scope:{visibility:'shared',roles:['owner'],groups:[],brands:[]}})
  assert.equal((await ok(`/macros/${restricted.id}/apply`,{version:restricted.version,command_id:'restricted-macro',tickets:[{id,expected_version:(await get(id)).ticket_version}]},'operator')).results[0].status,'forbidden')
  await deskWorkflows(f,{initial,id,field,group})

  // Closure retains the old transcript and creates a linked follow-up. Required
  // fields constrain solving without blocking ordinary queue work.
  await patch(id,{status_id:'solved'});assert.ok((await get(id)).resolved_at)
  const reopen=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'replacement-still-missing',content:'The replacement has not arrived.',expectedRevision:(await get(id)).revision}})
  assert.equal(reopen.accepted,true);assert.equal((await get(id)).status_category,'open')
  await patch(id,{status_id:'closed'})
  assert.equal((await call(`/conversations/${id}/ticket`,{status_id:'open'},'owner','PATCH')).status,409)
  const followup=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'after-close',content:'Please check the replacement again.',expectedRevision:(await get(id)).revision}})
  assert.notEqual(followup.followupConversationId,id);assert.equal((await get(followup.followupConversationId)).fields[field.id],(await get(id)).fields[field.id])
  assert.equal((await ok(`/conversations/${followup.followupConversationId}/workflows`)).followup_of,id)
  await app.db.prepare('DELETE FROM ticket_field_values WHERE conversation_id=? AND field_id=?').bind(second,field.id).run()
  assert.equal((await call(`/conversations/${second}/ticket`,{status_id:'solved'},'owner','PATCH')).status,400)
  await patch(second,{fields:{[field.id]:'RMA-SECOND'},status_id:'solved'})
  const history=(await get(id)).history;assert.ok(history.some(event=>event.source==='customer_reply'));assert.ok(history.some(event=>event.actor_id===w.users.owner))
  const audit=await securityLog(app,w)
  assert.ok(audit.some(event=>event.action==='macro.applied'));assert.ok(audit.some(event=>event.action==='ticket.updated'))
  const neighbour=await app.ok('/api/identity/widget/session',{body:{widgetKey:foreign.widgetKey},headers:{Origin:foreign.allowedOrigin}})
  assert.equal((await app.call(`/api/conversations/${id}/messages`,{token:neighbour.token})).status,404)
  await app.ok(`/api/management/projects/${w.projectId}/contacts/${visitor.contactId}/erase`,{token:w.tokens.owner,body:{}})
  assert.equal((await app.call(`/api/conversations/${id}/messages`,{token:visitor.token})).status,401)
  assert.equal((await app.first('SELECT count(*) n FROM workflow_schedules WHERE conversation_id=?',id)).n,0)
 }finally{await app.close()}
}
