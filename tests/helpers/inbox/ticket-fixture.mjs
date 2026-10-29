import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {startApp,sha} from '../../journeys/kit/app.mjs'

export async function ticketFixture(options={}){
 const app=await startApp({...options,captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',INBOUND_EMAIL_TOKEN:'ticket-gateway',...options.bindings}})
 const w=await app.seedWorkspace('tickets'),foreign=await app.seedWorkspace('elsewhere')
 await app.presenceAwayOff(w.projectId);await app.presenceAwayOff(foreign.projectId)
 const base=`/api/dashboard/projects/${w.projectId}`
 const call=(path,body,role='owner',method)=>app.call(base+path,{token:w.tokens[role],...(body!==undefined?{body}:{}),...(method?{method}:{})})
 const ok=async(path,body,role='owner',method)=>{const result=await call(path,body,role,method);assert.ok(result.status>=200&&result.status<300,JSON.stringify(result.data));return result.data.data??result.data}
 const visitor=(await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,name:'Dana Whitfield',email:'dana.whitfield@example.test'},headers:{Origin:w.allowedOrigin}}))
 const create=async(index=0)=>{
  const c=await app.ok('/api/conversations',{body:{projectId:w.projectId,contactId:visitor.contactId},token:index===0?visitor.token:w.tokens.owner})
  await app.ok(`/api/conversations/${c.id}/messages`,{body:{localId:`question-${index}`,content:`Order TO-${48200+index}: the Ridgeline boot has a torn seam. Can you arrange a replacement?`,expectedRevision:0},token:visitor.token})
  return c.id
 }
 const get=id=>ok(`/conversations/${id}/ticket`)
 const patch=async(id,changes,role='owner')=>ok(`/conversations/${id}/ticket`,{expected_version:(await get(id)).ticket_version,...changes},role,'PATCH')
 // Like the signed-in teammates above, this customer starts with native stored
 // authority. Form definition, validation and admission still use public routes.
 const portal=async()=>{
  const token=randomBytes(32).toString('hex'),hash=sha(token),now=Date.now(),expires=now+3600000
  await app.db.batch([
   app.db.prepare("UPDATE contacts SET is_verified=1,metadata_json=json_set(metadata_json,'$.email_link_verified',1) WHERE project_id=? AND id=?").bind(w.projectId,visitor.contactId),
   app.db.prepare('INSERT INTO portal_identities(project_id,email,contact_id,verified_at) SELECT project_id,lower(trim(email)),id,? FROM contacts WHERE project_id=? AND id=?').bind(now,w.projectId,visitor.contactId),
   app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,?,?,'contact',?,?)").bind(hash,visitor.contactId,w.projectId,visitor.contactId,expires),
   app.db.prepare('INSERT INTO portal_session_proofs(token_hash,project_id,contact_id,email,expires_at) SELECT ?,project_id,contact_id,email,? FROM portal_identities WHERE project_id=? AND contact_id=?').bind(hash,expires,w.projectId,visitor.contactId)
  ])
  return {headers:{Cookie:`h2h_portal=${token}`,Origin:app.origin}}
 }
 let id
 try{id=await create()}catch(error){await app.close();throw error}
 return {app,w,foreign,base,call,ok,visitor,create,id,get,patch,portal}
}
