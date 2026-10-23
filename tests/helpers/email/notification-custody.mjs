import assert from 'node:assert/strict'
import {vendorNotifications} from './vendor-notifications.mjs'

/** Public import and inbound doors keep threading keys subject to the import's
 * exact repeat, undo, ambiguity and customer-erasure boundaries. */
export async function notificationCustody(app){
 for(const fixture of vendorNotifications())for(const operation of ['undo','erase']){
  const w=await app.seedWorkspace(`notification-${fixture.vendor}-${operation}`),p=w.projectId,token=w.tokens.owner
  const imports=`/api/move-in/projects/${p}/imports`,base=`/api/management/projects/${p}`
  const address=`history-${fixture.vendor}-${operation}@example.test`,replyTo=fixture.to.replace('helpdesk',address.split('@')[0])
  await app.ok(base+'/mailboxes',{token,body:{provider:'forwarding',address,displayName:'Historical support'}})
  const original=fixture.rows.map(JSON.stringify).join('\n').replaceAll(fixture.to,replyTo)
  const apply=async body=>{
   const upload=await app.ok(imports+'?vendor='+fixture.vendor,{token,raw:true,headers:{'X-Import-Filename':'history.jsonl','Content-Type':'application/octet-stream',...(fixture.schema?{'X-Import-Schema':fixture.schema}:{})},body})
   await app.drainJobs();const run=(await app.ok(imports+'/'+upload.data.id,{token})).data
   assert.equal(run.state,'ready');assert.equal(run.plan.counts.rejected,0,JSON.stringify(run.plan))
   await app.ok(imports+'/'+run.id+'/apply',{token,body:{fingerprint:run.plan.fingerprint}});await app.drainJobs()
   assert.equal((await app.ok(imports+'/'+run.id,{token})).data.state,'completed')
   return run
  }
  const run=await apply(original),keys=await app.sql('SELECT * FROM email_threading_keys WHERE project_id=? ORDER BY conversation_id,key_kind,key_value',p)
  assert.ok(keys.length>0)
  const before=await app.sql('SELECT * FROM conversations WHERE project_id=? ORDER BY id',p)
  await apply('\n'+original)
  assert.deepEqual(await app.sql('SELECT * FROM email_threading_keys WHERE project_id=? ORDER BY conversation_id,key_kind,key_value',p),keys,'repackaged history preserves every key exactly')
  assert.deepEqual(await app.sql('SELECT * FROM conversations WHERE project_id=? ORDER BY id',p),before,'a repeat changes no ticket')
  const imported=before[0],receive=body=>app.call('/api/integrations/email/inbound',{token:'gateway-fixture',body:{messageId:`${fixture.vendor}-${operation}-${body.messageId}`,from:fixture.email,to:replyTo,subject:fixture.subject,text:'A reply to an old notification',...body}})
  if(operation==='undo'){
   await app.ok(imports+'/'+run.id+'/undo',{token,body:{}});await app.drainJobs()
   assert.equal((await app.ok(imports+'/'+run.id,{token})).data.state,'undone')
   assert.equal((await app.first('SELECT count(*) n FROM email_threading_keys WHERE project_id=?',p)).n,0)
   const reply=await receive({messageId:'after-undo'})
   assert.notEqual(reply.data.conversationId,imported.id,'an undone key never routes into the old ticket')
   assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=? AND id=?',p,imported.id)).n,0)
  }else{
   await app.ok(base+'/contacts/'+imported.contact_id+'/erase',{token,body:{}});await app.drainJobs()
   assert.equal((await app.first('SELECT count(*) n FROM email_threading_keys WHERE project_id=?',p)).n,0)
   const replay=await app.call(imports+'?vendor='+fixture.vendor,{token,raw:true,headers:{'X-Import-Filename':'history.jsonl','Content-Type':'application/octet-stream',...(fixture.schema?{'X-Import-Schema':fixture.schema}:{})},body:'\n\n'+original})
   assert.equal(replay.status,410,'source erasure fences a repackaged notification import')
   const reply=await receive({messageId:'after-erasure'})
   assert.notEqual(reply.data.conversationId,imported.id,'an erased key cannot resurrect its old customer or ticket')
  }
 }
}
