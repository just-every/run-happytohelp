import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function portalRecovery(f,{person,email,ticket,contact,forbidden}){
 const {app,p,owner,signin,mail}=f,P=`/api/portal/${p}`
 const state=()=>app.sql('SELECT token_hash,contact_id,revoked_at FROM sessions ORDER BY token_hash')
 const refused=async path=>{
  const before=await state(),response=await app.call(path)
  assert.equal(response.status,400);assert.deepEqual(response.data,{error:'Invalid or expired sign-in link'})
  assert.equal(response.headers.get('set-cookie'),null);assert.deepEqual(await state(),before)
  const html=await app.request(path,{headers:{Accept:'text/html'}})
  assert.equal(html.status,400);assert.match(await html.text(),/Invalid or expired sign-in link/)
 }
 const recovered=async()=>{
  const session=await signin(email),rows=(await app.ok(P+'/tickets',session)).tickets
  assert.equal(rows.length,1);assert.deepEqual(rows.map(row=>row.id),[ticket.id])
  for(const id of forbidden)assert.equal((await app.call(P+'/tickets/'+id,session)).status,404)
  return session
 }
 const requestLink=async()=>{
  const offset=mail.length
  await app.call(P+'/access/request',{headers:{Origin:app.origin},body:{email},status:202})
  const delivered=mail.slice(offset).find(message=>[].concat(message.to).includes(email))
  assert.ok(delivered);const url=new URL(delivered.text.match(/https:\/\/app\.example\/api\/portal\/\S+/)[0])
  return {path:url.pathname+url.search,hash:createHash('sha256').update(url.searchParams.get('token')).digest('hex')}
 }
 // Same-address unproven visitor history stays private even after a fresh recovery.
 const widget=await app.ok('/api/identity/widget/session',{headers:{Origin:f.workspace.allowedOrigin},body:{widgetKey:f.workspace.widgetKey,email}})
 const trap=await app.ok('/api/conversations',{token:widget.token,body:{projectId:p}})
 await app.ok(`/api/conversations/${trap.id}/messages`,{token:widget.token,body:{localId:'recovery-unproven',content:'Unproven visitor history',expectedRevision:0}})
 await refused(person.path) // Reused: no second session, fresh proof recovers the same ticket.
 // Expiry is a clock boundary, staged only in durable storage; redemption is real.
 const expired=await requestLink()
 await app.db.prepare('UPDATE portal_links SET expires_at=? WHERE token_hash=?').bind(Date.now()-1,expired.hash).run()
 await refused(expired.path)
 let fresh=await recovered()
 // Losing the email gives no access. Discard its URL and sign out the old session;
 // a missing-token request and unsigned page/API offer a plain recovery door.
 await requestLink()
 await app.ok(P+'/access/logout',{...fresh,body:{}})
 assert.equal((await app.call(P+'/tickets',fresh)).status,401)
 await refused(P+'/access/verify')
 assert.equal((await app.call(P+'/tickets')).status,401)
 // Operator address text is not new mailbox proof and must not retire old proof.
 await app.ok(`/api/management/projects/${p}/contacts/${contact}`,{...owner,method:'PUT',body:{email:'edited@harbor.example'}})
 assert.equal((await app.call(P+'/tickets',person)).status,200,'contact text edits do not revoke proven portal sessions')
 fresh=await recovered()
 assert.equal((await app.ok(P+'/preferences',fresh)).email,email,'preferences name the proven mailbox')
 const edited=await signin('edited@harbor.example')
 assert.deepEqual((await app.ok(P+'/tickets',edited)).tickets,[],'an unproven operator edit transfers no history')
 const original=await app.first('SELECT contact_id FROM portal_identities WHERE project_id=? AND email=?',p,email)
 assert.equal(original.contact_id,contact,'recovery retains the original requester')
 assert.equal((await app.call(P+'/tickets/'+trap.id,fresh)).status,404)
 assert.deepEqual((await app.ok(P+'/tickets',fresh)).tickets.map(row=>row.id),[ticket.id])
}
