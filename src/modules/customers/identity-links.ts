import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv,Env} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority} from '../tickets/model'
import {mailboxProofSql} from '../identity/mailbox'
import {contactWritable} from '../../platform/contact-state'
import {fingerprint} from './model'
import {object} from './validation'

export const identityLinkRoutes=new Hono<AppEnv>()
const prefix='/projects/:projectId/contacts/:contactId/identity-links'
const available=`${contactWritable} AND coalesce(json_extract(metadata_json,'$.is_blocked'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_deleted'),0)!=1`
// A signed widget identifier or independently proven mailbox is identity proof.
// A typed/imported address, metadata assertion or operator label is not.
const proof=`CASE WHEN is_verified=1 AND external_id IS NOT NULL AND length(trim(external_id))>0 THEN 'signed_widget' WHEN ${mailboxProofSql('contacts')} THEN 'mailbox' ELSE NULL END`
async function contact(env:Env,p:string,id:string){
 const row=await env.DB.prepare(`SELECT id,name,email,external_id,is_verified,metadata_json,${proof} proof FROM contacts WHERE project_id=? AND id=? AND ${available}`).bind(p,id).first<any>()
 if(!row)throw new HTTPException(404,{message:'Contact unavailable'})
 return row
}
const erasureVersionSql='SELECT json_array(count(*),coalesce(sum(runs),0),coalesce(max(last_erased_at),0)) version FROM contact_erasures WHERE project_id=?'
const display=(row:any)=>({id:row.id,name:row.name,email:row.email,external_id:row.external_id,proof:row.proof})
async function preview(env:Env,p:string,id:string,input:any){
 if(!['link','unlink'].includes(input.action)||typeof input.contact_id!=='string'||input.contact_id===id)throw new HTTPException(400,{message:'Choose link or unlink and a different contact'})
 if(typeof input.provenance!=='string'||!input.provenance.trim()||input.provenance.length>1000)throw new HTTPException(400,{message:'Record the source and reason for this identity association'})
 const ids=[id,input.contact_id].sort(),contacts=await Promise.all(ids.map(id=>contact(env,p,id)))
 if(input.action==='link'&&contacts.some(row=>!row.proof))throw new HTTPException(409,{message:'Both identities require independent verification; typed email alone is insufficient'})
 const link=await env.DB.prepare('SELECT * FROM customer_identity_links WHERE project_id=? AND contact_id=? AND linked_contact_id=?').bind(p,...ids).first<any>()
 if(input.action==='link'&&link||input.action==='unlink'&&!link)throw new HTTPException(409,{message:link?'Identities are already linked':'Identities are not linked'})
 const erasure_version=(await env.DB.prepare(erasureVersionSql).bind(p).first<{version:string}>())!.version
 const state={project_id:p,contacts,link,action:input.action,provenance:input.provenance.trim(),erasure_version}
 return {...state,signature:await fingerprint(state)}
}
async function access(c:any){const actor=await scope(c) as Actor;const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'contacts.manage');return {actor,guard}}
// Links and decisions about the opened customer, each naming the other identity and its reviewer.
const related=(table:string,columns:string,order:string)=>`SELECT ${columns},(SELECT name FROM users WHERE users.id=r.actor_id) actor_name,contacts.id,contacts.name,contacts.email,contacts.external_id,${proof} proof FROM ${table} r JOIN contacts ON contacts.project_id=r.project_id AND contacts.id=CASE WHEN r.contact_id=? THEN r.linked_contact_id ELSE r.contact_id END WHERE r.project_id=? AND (r.contact_id=? OR r.linked_contact_id=?) AND ${available.replaceAll('metadata_json','contacts.metadata_json')} AND EXISTS(%GUARD%) ORDER BY ${order}`
const linksSql=related('customer_identity_links','r.provenance,r.actor_id,r.created_at','r.created_at,r.contact_id,r.linked_contact_id')
const historySql=related('customer_identity_link_history','r.id history_id,r.action,r.provenance,r.actor_id,r.at','r.at DESC,r.rowid DESC LIMIT 100')
identityLinkRoutes.get(prefix,async c=>{
 const {actor,guard}=await access(c),id=c.req.param('contactId');await contact(c.env,actor.projectId,id)
 const read=(sql:string)=>c.env.DB.prepare(sql.replace('%GUARD%',()=>guard.sql)).bind(id,actor.projectId,id,id,...guard.params).all<any>()
 const [links,history]=await Promise.all([read(linksSql),read(historySql)])
 return c.json({links:links.results.map(row=>({contact:display(row),provenance:row.provenance,actor_id:row.actor_id,actor_name:row.actor_name,created_at:row.created_at})),history:history.results.map(row=>({id:row.history_id,action:row.action,contact:display(row),provenance:row.provenance,actor_id:row.actor_id,actor_name:row.actor_name,at:row.at})),grants_customer_access:false})
})
identityLinkRoutes.post(prefix+'/preview',async c=>{
 const {actor}=await access(c),body=object(await c.req.json()),plan=await preview(c.env,actor.projectId,c.req.param('contactId')!,body)
 return c.json({preview:{action:plan.action,contact_id:body.contact_id,provenance:plan.provenance,signature:plan.signature,contacts:plan.contacts.map(display),grants_customer_access:false}})
})
identityLinkRoutes.post(prefix,async c=>{
 const {actor,guard}=await access(c),body=object(await c.req.json()),plan=await preview(c.env,actor.projectId,c.req.param('contactId')!,body)
 if(body.signature!==plan.signature)throw new HTTPException(409,{message:'Identity or link changed. Preview again before applying.'})
 const receipt=crypto.randomUUID(),now=Date.now(),ids=plan.contacts.map(row=>row.id),accepted='EXISTS(SELECT 1 FROM audit_events WHERE id=?)'
 const snapshots=plan.contacts.map(row=>({sql:`EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND name IS ? AND email IS ? AND external_id IS ? AND is_verified=? AND metadata_json=? AND ${available} AND (${proof}) IS ?)`,params:[actor.projectId,row.id,row.name,row.email,row.external_id,row.is_verified,row.metadata_json,row.proof]}))
 const relationship=plan.action==='link'?{sql:'NOT EXISTS(SELECT 1 FROM customer_identity_links WHERE project_id=? AND contact_id=? AND linked_contact_id=?)',params:[actor.projectId,...ids]}:{sql:'EXISTS(SELECT 1 FROM customer_identity_links WHERE project_id=? AND contact_id=? AND linked_contact_id=? AND provenance=? AND actor_id=? AND created_at=?)',params:[actor.projectId,...ids,plan.link.provenance,plan.link.actor_id,plan.link.created_at]}
 const privacy={sql:`(${erasureVersionSql})=?`,params:[actor.projectId,plan.erasure_version]}
 const claim={sql:[`EXISTS(${guard.sql})`,...snapshots.map(s=>s.sql),relationship.sql,privacy.sql].map(s=>`(${s})`).join(' AND '),params:[...guard.params,...snapshots.flatMap(s=>s.params),...relationship.params,...privacy.params]}
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,'dashboard','contact',?,? WHERE ${claim.sql}`).bind(receipt,actor.projectId,now,`customer.identity_${plan.action}ed`,actor.id,ids[0],JSON.stringify({linked_contact_id:ids[1],grants_customer_access:false}),...claim.params),
  plan.action==='link'?c.env.DB.prepare(`INSERT INTO customer_identity_links SELECT ?,?,?,?,?,? WHERE ${accepted}`).bind(actor.projectId,...ids,plan.provenance,actor.id,now,receipt):c.env.DB.prepare(`DELETE FROM customer_identity_links WHERE project_id=? AND contact_id=? AND linked_contact_id=? AND ${accepted}`).bind(actor.projectId,...ids,receipt),
  c.env.DB.prepare(`INSERT INTO customer_identity_link_history(id,project_id,contact_id,linked_contact_id,action,provenance,actor_id,at) SELECT ?,?,?,?,?,?,?,? WHERE ${accepted}`).bind(receipt,actor.projectId,...ids,`${plan.action}ed`,plan.provenance,actor.id,now,receipt)
 ])
 if(!results[0].meta.changes)throw new HTTPException(409,{message:'Identity or authority changed. Preview again before applying.'})
 return c.json({applied:true,grants_customer_access:false})
})
