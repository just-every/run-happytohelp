import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

export async function scopedAccessJourney(){
 const app=await startApp({captureQueue:true}),sockets=[]
 try{
  const w=await app.seedWorkspace('team-access'),other=await app.seedWorkspace('team-foreign'),P=`/api/management/projects/${w.projectId}`,D=`/api/dashboard/projects/${w.projectId}`,owner=w.tokens.owner,agent=w.tokens.operator
  const groups=[]
  for(const name of ['Returns','Billing'])groups.push((await app.ok(P+'/ticket-groups',{token:owner,body:{name,members:[]}})).data.id)
  for(const [i,group] of groups.entries())await app.db.batch([
   app.db.prepare('INSERT INTO contacts(id,project_id,email,created_at) VALUES(?,?,?,1)').bind('team-contact-'+i,w.projectId,`customer-${i}@example.test`),
   app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,revision,last_message_id,created_at,updated_at) VALUES(?,?,?,?,1,?,1,1)').bind('team-conversation-'+i,w.projectId,'team-contact-'+i,group,'team-message-'+i),
   app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,1)").bind('team-message-'+i,w.projectId,'team-conversation-'+i,'team-local-'+i,'team-contact-'+i,'Private team '+i),
  ])
  const definition={name:'Returns support',base:'operator',permissions:['conversations.notes','conversations.follow','conversations.manage','conversations.reply','reports.view'],teamIds:[groups[0]]}
  const role=(await app.ok(P+'/roles',{token:owner,body:definition})).data
  await app.ok(P+'/agents/'+w.users.operator,{token:owner,method:'PUT',body:{role:role.id}})
  for(const path of [D+'/conversations','/api/dashboard/conversations']){
   const listing=await app.ok(path,{token:agent});assert.equal(listing.meta.pagination.total,1);assert.deepEqual(listing.data.map(c=>c.id),['team-conversation-0'])
  }
  assert.deepEqual((await app.ok('/api/conversations',{token:agent})).conversations.map(c=>c.id),['team-conversation-0'])
  assert.equal((await app.ok(D+'/conversations/counts',{token:agent})).data.open,1)
  for(const suffix of ['', '/buckets','/ticket']){
   assert.equal((await app.call(D+'/conversations/team-conversation-0'+suffix,{token:agent})).status,200)
   assert.equal((await app.call(D+'/conversations/team-conversation-1'+suffix,{token:agent})).status,403)
  }
  for(const suffix of ['', '/messages','/media/missing'])assert.equal((await app.call('/api/conversations/team-conversation-1'+suffix,{token:agent})).status,403)
  assert.equal((await app.call(D+'/conversations/team-conversation-0/notes',{token:agent,body:{content:'Permitted internal note'}})).status,201)
  assert.equal((await app.call(D+'/conversations/team-conversation-1/notes',{token:agent,body:{content:'Must not be saved'}})).status,403)
  assert.equal((await app.call(D+'/conversations/team-conversation-0/ticket',{token:agent,method:'PATCH',body:{group_id:groups[1]}})).status,403)
  for(const path of [P+'/contacts',D+'/reports',D+'/tickets/bulk/preview',`/api/dashboard/projects/${other.projectId}/conversations`])assert.equal((await app.call(path,{token:agent,...(path.endsWith('/preview')?{body:{}}:{})})).status,403)
  await app.db.prepare("INSERT INTO memberships(user_id,project_id,role) VALUES(?,?,'admin')").bind(w.users.operator,other.projectId).run()
  assert.equal((await app.call(`/api/management/projects/${other.projectId}/brands/reports?projects=${other.projectId},${w.projectId}`,{token:agent})).status,403,'an unrestricted brand cannot expose a different brand with team restrictions')
  // A live per-conversation stream ends when the owner withdraws the team.
  const connect=async id=>app.request(`/api/conversations/${id}/socket?token=${agent}`,{headers:{Upgrade:'websocket'}})
  assert.equal((await connect('team-conversation-1')).status,403)
  const opened=await connect('team-conversation-0');assert.equal(opened.status,101);const socket=opened.webSocket;socket.accept();sockets.push(socket)
  const closed=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}))
  await app.ok(P+'/roles/'+role.id,{token:owner,method:'PUT',body:{...definition,teamIds:[]}})
  assert.equal((await app.call('/api/conversations/team-conversation-0/messages',{token:agent})).status,403)
  socket.send(JSON.stringify({type:'ping'}));const event=await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Team-revoked socket did not close')),3000))]);assert.equal(event.code,1008)
  assert.equal((await app.ok(D+'/conversations',{token:agent})).data.length,0)
  // Editing a role through an older client does not erase its restriction.
  const {teamIds,...olderClient}=definition;await app.ok(P+'/roles/'+role.id,{token:owner,method:'PUT',body:olderClient})
  assert.deepEqual((await app.ok(P+'/roles',{token:owner})).data.custom.find(r=>r.id===role.id).teamIds,[])
  assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE action='team_scope.denied' AND actor_id=?",w.users.operator)).n)

  // Refund approval is separate from installing integrations and sending a reply.
  const request={requestKey:'synthetic-happytohelp-20',conversationId:'team-conversation-0',paymentReference:'synthetic-happytohelp-21',amountMinor:12995,currency:'USD'}
  const restricted=(await app.ok(P+'/roles',{token:owner,body:{name:'Installer, no refunds',base:'admin',permissions:['integrations.install']}})).data
  await app.ok(P+'/agents/'+w.users.admin,{token:owner,method:'PUT',body:{role:restricted.id}})
  assert.equal((await app.call(P+'/refund-approvals',{token:w.tokens.admin,body:request})).status,403)
  assert.equal((await app.first('SELECT count(*) n FROM refund_approvals')).n,0)
  const approved=await app.ok(P+'/refund-approvals',{token:owner,body:request});assert.equal(approved.data.status,'approved_not_submitted');assert.equal(approved.data.submitted,false)
  assert.equal((await app.ok(P+'/refund-approvals',{token:owner,body:request})).data.id,approved.data.id)
  assert.equal((await app.call(P+'/refund-approvals',{token:owner,body:{...request,amountMinor:1}})).status,409)
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='refund.approved'")).n,1)
  assert.equal(app.requests.length,0,'native approval never pretends a payment was sent')
  await app.ok(P+'/roles/'+restricted.id,{token:owner,method:'PUT',body:{name:'Installer, no refunds',base:'admin',permissions:['refunds.approve']}})
  const revoked=await app.call(P+'/refund-approvals',{token:w.tokens.admin,body:{...request,requestKey:'synthetic-happytohelp-22'},headers:{'x-test-before-batch':`UPDATE sessions SET revoked_at=1 WHERE actor_id='${w.users.admin}'`}})
  assert.equal(revoked.status,403);assert.equal((await app.first('SELECT count(*) n FROM refund_approvals')).n,1,'revocation before commit refuses a pending approval')
 }finally{for(const socket of sockets)socket.close();await app.close()}
}
