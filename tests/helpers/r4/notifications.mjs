import assert from 'node:assert/strict'
import {recipients} from '../email/app.mjs'
import {sha} from '../../journeys/kit/app.mjs'

// Configure the lead's real mailbox before its first customer arrives. The returned
// stages continue that same ticket's assignment, mention and resolution lifecycle.
export async function threadNotifications(f,owner){
 const {app,mail}=f,base='/api/management/projects/p'
 const call=(path,body,token=owner,method=body===undefined?'GET':'PUT')=>app.ok(base+path,{token,body,method})
 await app.db.batch([
  app.db.prepare("INSERT INTO users VALUES('watch','watch@example.com','Watch',1)"),
  app.db.prepare("INSERT INTO memberships VALUES('p','watch','operator')"),
  app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,'watch','p','operator',?)").bind(sha('watch-token'),Date.now()+3600000),
 ])
 const settings=(await call('/notification-triggers')).data
 const triggers=settings.map(row=>({...row,expected_reply_time:'within two business hours'}))
 await call('/notification-triggers',{triggers})
 await call('/notification-preferences',{preferences:[{kind:'mention',inbox:true,email:false},{kind:'assignment',inbox:true,email:true}]},'watch-token')
 const notices=(address,word)=>mail.sent.filter(e=>recipients(e.body).includes(address)&&e.body.subject?.includes(word))
 return {
  async admitted(id){
   await app.scheduled()
   const received=notices('customer@example.com','received');assert.equal(received.length,1);assert.ok(received[0].body.text.includes(id));assert.match(received[0].body.text,/two business hours/)
   assert.equal(received[0].body.headers['X-Auto-Response-Suppress'],'All')
   await app.ok(`/api/dashboard/projects/p/conversations/${id}`,{token:owner,method:'PUT',body:{agent_id:'watch'}})
   await app.ok(`/api/dashboard/projects/p/conversations/${id}/notes`,{token:owner,body:{content:'Please inspect this order @[Watch](user:watch).'}})
   await app.scheduled()
   const inbox=(await call('/notification-inbox',undefined,'watch-token')).data
   assert.ok(inbox.some(n=>n.kind==='assignment'));assert.ok(inbox.some(n=>n.kind==='mention'))
   assert.equal(mail.sent.filter(e=>recipients(e.body).includes('watch@example.com')).length,1,'mention email respects its opt-out')
   const mention=inbox.find(n=>n.kind==='mention');await call(`/notification-inbox/${encodeURIComponent(mention.id)}/read`,undefined,'watch-token','PUT')
   assert.ok((await call('/notification-inbox',undefined,'watch-token')).data.find(n=>n.id===mention.id).read_at)
  },
  async resolved(id){
   const ticket=`/api/dashboard/projects/p/conversations/${id}`
   await app.ok(ticket,{token:owner,method:'PUT',body:{resolved:true}});await app.scheduled()
   const count=notices('customer@example.com','solved').length;assert.equal(count,1)
   await app.ok(ticket,{token:owner,method:'PUT',body:{resolved:false}})
   await app.ok(ticket,{token:owner,method:'PUT',body:{resolved:true}});await app.scheduled()
   assert.equal(notices('customer@example.com','solved').length,count,'one solved trigger per customer command')
   const audit=(await call('/audit?limit=200')).data;assert.ok(audit.some(e=>e.action==='notifications.delivery_outcome'&&e.target_id===id))
   // A later mention observes membership now, not the earlier assignment.
   // The public note command refuses a teammate who has left the workspace.
   await app.db.prepare("DELETE FROM memberships WHERE project_id='p' AND user_id='watch'").run()
   const attempts=mail.attempts
   const refused=await app.call(ticket+'/notes',{token:owner,body:{content:'Please check again @[Watch](user:watch).'}})
   assert.equal(refused.status,403)
   await app.scheduled()
   assert.equal(mail.attempts,attempts)
  },
 }
}
