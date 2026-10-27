import {Hono,type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority} from '../tickets/model'
import {requireStepUp} from '../identity/two-factor/step-up'
import {encryptToken,decryptToken} from '../integrations/secrets'
import {auditStatement} from '../audit/record'
import {contactWritable} from '../../platform/contact-state'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {account,record,HubSpotError,scopes} from './hubspot'

type Guard={sql:string;params:unknown[]}
const prefix='/projects/:projectId/crm/hubspot'
const invalid=(message:string):never=>{throw new HTTPException(400,{message})}
function text(value:unknown,name:string,max=200){if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\x00]/.test(value))invalid('Invalid '+name);return (value as string).trim()}
const sourceId=(value:unknown)=>{const id=text(value,'source ID');if(!/^\d+$/.test(id))invalid('Source ID must be numeric');return id}
async function input(c:Context<AppEnv>){const value=await c.req.json().catch(()=>invalid('Expected JSON'));if(!value||typeof value!=='object'||Array.isArray(value))invalid('Expected object');return value}
async function access(c:Context<AppEnv>,write=false){
 const actor=await scope(c,true) as Actor
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},write?'integrations.install':'contacts.manage')
 return {actor,guard:{sql:`EXISTS(${guard.sql})`,params:guard.params}}
}
async function connection(c:Context<AppEnv>,p:string){const row=await c.env.DB.prepare('SELECT * FROM crm_connections WHERE project_id=?').bind(p).first<any>();if(!row?.token_cipher)throw new HTTPException(409,{message:'HubSpot is disconnected'});return row}
const joined=(...guards:Guard[]):Guard=>({sql:guards.map(g=>`(${g.sql})`).join(' AND '),params:guards.flatMap(g=>g.params)})
const sameConnection=(row:any):Guard=>({sql:'EXISTS(SELECT 1 FROM crm_connections WHERE project_id=? AND revision=? AND token_cipher IS NOT NULL)',params:[row.project_id,row.revision]})
async function mutate(c:Context<AppEnv>,actor:Actor,guard:Guard,action:string,statements:(claim:string,id:string)=>D1PreparedStatement[]){
 const id=crypto.randomUUID(),claim='EXISTS(SELECT 1 FROM crm_changes WHERE id=?)',at=Date.now(),db=c.env.DB
 const result=await db.batch([
  db.prepare(`INSERT INTO crm_changes(id,project_id,at) SELECT ?,?,? WHERE ${guard.sql}`).bind(id,actor.projectId,at,...guard.params),
  ...statements(claim,id),
  auditStatement(db,{projectId:actor.projectId,category:'integration',action:'crm.'+action,actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'crm_connection',id:actor.projectId},detail:{provider:'hubspot'}},at,{sql:claim,params:[id]})
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'CRM mapping, identity or authority changed. Reload before retrying.'})
}
async function native(c:Context<AppEnv>,p:string,id:string){
 const contact=await c.env.DB.prepare(`SELECT id,email FROM contacts WHERE project_id=? AND id=? AND ${contactWritable}`).bind(p,id).first<any>()
 if(!contact)throw new HTTPException(404,{message:'Customer unavailable'})
 return contact
}
const liveContact=(p:string,contact:any):Guard=>({sql:`EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND email IS ? AND ${contactWritable})`,params:[p,contact.id,contact.email]})
export const crmRoutes=new Hono<AppEnv>()
crmRoutes.get(prefix,async c=>{
 const {actor}=await access(c),row=await c.env.DB.prepare('SELECT account_id,token_cipher IS NOT NULL connected,updated_at FROM crm_connections WHERE project_id=?').bind(actor.projectId).first<any>()
 return c.json({connection:row?{...row,connected:!!row.connected,provider:'hubspot',scopes}:null})
})
crmRoutes.put(prefix,async c=>{
 const {actor,guard}=await access(c,true);await requireStepUp(c,actor,'crm.connect')
 const body=await input(c),token=text(body.token,'token',10000),accountId=sourceId(body.account_id)
 const properties:Record<string,string>={}
 for(const key of ['plan','entitlement'])if(body.properties?.[key]){const name=text(body.properties[key],'property',100);if(!/^[a-z][a-z0-9_]*$/.test(name))invalid('Invalid property');properties[key]=name}
 try{if(await account(token)!==accountId)throw new HubSpotError('identity_mismatch')}catch{throw new HTTPException(400,{message:'HubSpot account or exact read-only scopes could not be verified'})}
 const previous=await c.env.DB.prepare('SELECT revision FROM crm_connections WHERE project_id=?').bind(actor.projectId).first<any>()
 const cipher=await encryptToken(c.env,actor.projectId,token),revision=crypto.randomUUID()
 await mutate(c,actor,joined(guard,{sql:'(SELECT revision FROM crm_connections WHERE project_id=?) IS ?',params:[actor.projectId,previous?.revision??null]}),'connected',(claim,id)=>[
  c.env.DB.prepare(`INSERT INTO crm_connections(project_id,account_id,token_cipher,properties_json,revision,updated_at) SELECT ?,?,?,?,?,? WHERE ${claim} ON CONFLICT(project_id) DO UPDATE SET account_id=excluded.account_id,token_cipher=excluded.token_cipher,properties_json=excluded.properties_json,revision=excluded.revision,updated_at=excluded.updated_at`).bind(actor.projectId,accountId,cipher,JSON.stringify(properties),revision,Date.now(),id),
  c.env.DB.prepare(`DELETE FROM crm_mappings WHERE project_id=? AND ${claim}`).bind(actor.projectId,id)
 ])
 return c.json({connected:true,account_id:accountId,scopes})
})
crmRoutes.delete(prefix,async c=>{
 const {actor,guard}=await access(c,true);await requireStepUp(c,actor,'crm.disconnect')
 await mutate(c,actor,guard,'disconnected',(claim,id)=>[
  c.env.DB.prepare(`UPDATE crm_connections SET token_cipher=NULL,revision=?,updated_at=? WHERE project_id=? AND ${claim}`).bind(crypto.randomUUID(),Date.now(),actor.projectId,id),
  c.env.DB.prepare(`DELETE FROM crm_mappings WHERE project_id=? AND ${claim}`).bind(actor.projectId,id)
 ])
 return c.json({connected:false})
})
crmRoutes.put(prefix+'/contacts/:contactId',async c=>{
 const {actor,guard}=await access(c,true),p=actor.projectId,contact=await native(c,p,c.req.param('contactId')!),conn=await connection(c,p),body=await input(c)
 const source=sourceId(body.source_contact_id),company=body.company_id?text(body.company_id,'company ID'):null,sourceCompany=body.source_company_id?sourceId(body.source_company_id):null
 if(!!company!==!!sourceCompany)invalid('Map both company IDs or neither')
 const mappingGuard:Guard={sql:`NOT EXISTS(SELECT 1 FROM crm_mappings WHERE project_id=? AND contact_id<>? AND (source_contact_id=? OR (? IS NOT NULL AND (company_id=? AND source_company_id<>? OR source_company_id=? AND company_id<>?))))`,params:[p,contact.id,source,company,company,sourceCompany,sourceCompany,company]}
 const companyGuard:Guard=company?{sql:'EXISTS(SELECT 1 FROM companies c JOIN contact_companies m ON m.project_id=c.project_id AND m.company_id=c.id WHERE c.project_id=? AND c.id=? AND c.merged_into IS NULL AND m.contact_id=?)',params:[p,company,contact.id]}:{sql:'1',params:[]}
 await mutate(c,actor,joined(guard,sameConnection(conn),liveContact(p,contact),mappingGuard,companyGuard),'mapped',(claim,id)=>[
  c.env.DB.prepare(`INSERT INTO crm_mappings(project_id,contact_id,source_contact_id,company_id,source_company_id,revision) SELECT ?,?,?,?,?,? WHERE ${claim} ON CONFLICT(project_id,contact_id) DO UPDATE SET source_contact_id=excluded.source_contact_id,company_id=excluded.company_id,source_company_id=excluded.source_company_id,revision=excluded.revision,state='stale',context_json=NULL,refreshed_at=NULL,checked_at=NULL`).bind(p,contact.id,source,company,sourceCompany,crypto.randomUUID(),id)
 ])
 return c.json({mapped:true,state:'stale',grants_customer_access:false})
})
async function readContext(c:Context<AppEnv>,p:string,contactId:string){
 const contact=await native(c,p,contactId)
 const row=await c.env.DB.prepare('SELECT m.*,c.account_id,c.token_cipher IS NOT NULL connected FROM crm_mappings m JOIN crm_connections c ON c.project_id=m.project_id WHERE m.project_id=? AND m.contact_id=?').bind(p,contactId).first<any>()
 if(!row){const conn=await c.env.DB.prepare('SELECT token_cipher IS NOT NULL connected FROM crm_connections WHERE project_id=?').bind(p).first<any>();return c.json({context:null,state:conn&&!conn.connected?'disconnected':'unmapped',grants_customer_access:false})}
 const {context_json,revision,...rest}=row
 const context=context_json?JSON.parse(context_json):null
 let identityMismatch=!!context&&(!contact.email||context.contact.properties.email?.toLowerCase()!==contact.email.toLowerCase())
 if(context&&row.company_id){
  const domain=context.company?.properties.domain?.toLowerCase()
  const company=await c.env.DB.prepare('SELECT 1 FROM companies c JOIN company_domains d ON d.project_id=c.project_id AND d.company_id=c.id JOIN contact_companies m ON m.project_id=c.project_id AND m.company_id=c.id WHERE c.project_id=? AND c.id=? AND c.merged_into IS NULL AND d.domain=? AND m.contact_id=?').bind(p,row.company_id,domain??'',contactId).first()
  identityMismatch ||= !company
 }
 return c.json({...rest,state:!row.connected?'disconnected':identityMismatch?'identity_mismatch':row.state==='fresh'&&Date.now()-row.refreshed_at>300000?'stale':row.state,context:!row.connected||identityMismatch?null:context,grants_customer_access:false})
}
crmRoutes.get(prefix+'/contacts/:contactId',async c=>{const {actor}=await access(c);return readContext(c,actor.projectId,c.req.param('contactId')!)})
async function refreshContext(c:Context<AppEnv>,contactId:string,ticketGuard:Guard={sql:'1',params:[]}){
 const {actor,guard}=await access(c,true),p=actor.projectId,contact=await native(c,p,contactId),conn=await connection(c,p)
 const mapping=await c.env.DB.prepare('SELECT * FROM crm_mappings WHERE project_id=? AND contact_id=?').bind(p,contact.id).first<any>()
 if(!mapping)throw new HTTPException(409,{message:'Explicitly map this customer first'})
 let state='fresh',context:any=null,companyGuard:Guard={sql:'1',params:[]}
 try{
  const token=await decryptToken(c.env,p,conn.token_cipher)
  if(await account(token)!==conn.account_id)throw new HubSpotError('identity_mismatch')
  const extras=Object.values(JSON.parse(conn.properties_json)) as string[]
  const source=await record(token,'contacts',mapping.source_contact_id,['email','hubspot_owner_id',...extras])
  if(!contact.email||source.properties.email?.toLowerCase()!==contact.email.toLowerCase())throw new HubSpotError('identity_mismatch')
  let company=null
  if(mapping.company_id){
   const local=await c.env.DB.prepare('SELECT c.revision,d.domain FROM companies c JOIN company_domains d ON d.project_id=c.project_id AND d.company_id=c.id JOIN contact_companies m ON m.project_id=c.project_id AND m.company_id=c.id WHERE c.project_id=? AND c.id=? AND c.merged_into IS NULL AND m.contact_id=?').bind(p,mapping.company_id,contact.id).all<any>()
   company=await record(token,'companies',mapping.source_company_id,['domain','name','hubspot_owner_id',...extras])
   const domain=company.properties.domain?.toLowerCase()
   if(!domain||!local.results.some(row=>row.domain===domain)||!source.companies.includes(mapping.source_company_id))throw new HubSpotError('identity_mismatch')
   companyGuard={sql:'EXISTS(SELECT 1 FROM companies c JOIN company_domains d ON d.project_id=c.project_id AND d.company_id=c.id JOIN contact_companies m ON m.project_id=c.project_id AND m.company_id=c.id WHERE c.project_id=? AND c.id=? AND c.revision=? AND c.merged_into IS NULL AND d.domain=? AND m.contact_id=?)',params:[p,mapping.company_id,local.results[0].revision,domain,contact.id]}
  }
  context={provider:'hubspot',account_id:conn.account_id,contact:source,company,fields:JSON.parse(conn.properties_json)}
 }catch(error){state=error instanceof HubSpotError?error.state:'unavailable'}
 await mutate(c,actor,joined(guard,ticketGuard,sameConnection(conn),liveContact(p,contact),companyGuard,{sql:'EXISTS(SELECT 1 FROM crm_mappings WHERE project_id=? AND contact_id=? AND revision=?)',params:[p,contact.id,mapping.revision]}),'refreshed',(claim,id)=>[
  c.env.DB.prepare(`UPDATE crm_mappings SET state=?,context_json=?,checked_at=?,refreshed_at=CASE WHEN ?='fresh' THEN ? ELSE refreshed_at END,revision=? WHERE project_id=? AND contact_id=? AND ${claim}`).bind(state,context?JSON.stringify(context):null,Date.now(),state,Date.now(),crypto.randomUUID(),p,contact.id,id)
 ])
 return c.json({state,context,grants_customer_access:false})
}
crmRoutes.post(prefix+'/contacts/:contactId/refresh',c=>refreshContext(c,c.req.param('contactId')!))
crmRoutes.delete(prefix+'/contacts/:contactId',async c=>{
 const {actor,guard}=await access(c,true);await native(c,actor.projectId,c.req.param('contactId')!)
 await mutate(c,actor,guard,'unmapped',(claim,id)=>[c.env.DB.prepare(`DELETE FROM crm_mappings WHERE project_id=? AND contact_id=? AND ${claim}`).bind(actor.projectId,c.req.param('contactId'),id)])
 return c.json({mapped:false,grants_customer_access:false})
})
// A ticket resolves its native requester; CRM never selects or authenticates one.
crmRoutes.get('/projects/:projectId/conversations/:conversationId/crm',async c=>{
 const {actor}=await access(c),ticket=await c.env.DB.prepare(`SELECT contact_id FROM conversations c WHERE project_id=? AND id=? AND ${contactAvailableSql()}`).bind(actor.projectId,c.req.param('conversationId')).first<any>()
 if(!ticket)throw new HTTPException(404)
 return readContext(c,actor.projectId,ticket.contact_id)
})
crmRoutes.post('/projects/:projectId/conversations/:conversationId/crm/refresh',async c=>{
 const {actor}=await access(c,true),conversationId=c.req.param('conversationId')
 const ticket=await c.env.DB.prepare(`SELECT contact_id FROM conversations c WHERE project_id=? AND id=? AND ${contactAvailableSql()}`).bind(actor.projectId,conversationId).first<any>()
 if(!ticket)throw new HTTPException(404)
 return refreshContext(c,ticket.contact_id,{sql:`EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND c.contact_id=? AND ${contactAvailableSql()})`,params:[actor.projectId,conversationId,ticket.contact_id]})
})
