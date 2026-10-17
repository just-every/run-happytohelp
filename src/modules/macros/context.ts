import type {Actor,Env} from '../../platform/env'
import {getTicket,ticketReadAccess,fieldAllowed} from '../tickets/model'
/** Context contains only fields this actor may currently read. Unknown personal
 * metadata never becomes an implicit placeholder namespace. */
export async function loadMacroContext(env:Env,actor:Actor,conversationId:string){
 const ticket=await getTicket(env,actor,conversationId),access=await ticketReadAccess(env,actor)
 const [contact,assignee,agent,brand,fields]=await Promise.all([
  env.DB.prepare('SELECT name,email,metadata_json FROM contacts WHERE id=? AND project_id=?').bind(ticket.contact_id,actor.projectId).first<any>(),
  ticket.assigned_to?env.DB.prepare('SELECT u.name,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.project_id=?').bind(ticket.assigned_to,actor.projectId).first<any>():null,
  env.DB.prepare('SELECT name,email FROM users WHERE id=?').bind(actor.id).first<any>(),
  env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(actor.projectId).first<any>(),
  env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=?').bind(actor.projectId).all<any>(),
 ])
 const metadata=JSON.parse(contact?.metadata_json||'{}'),name=metadata.provided_name?.trim()||contact?.name?.trim()||'',email=metadata.provided_email||contact?.email||''
 const context:Record<string,unknown>={
  'requester.name':name,'requester.first_name':name.split(/\s+/)[0]||'','requester.email':email,
  'contact.name':name||'there','contact.email':email,'agent.name':agent?.name,'agent.email':agent?.email,
  'ticket.id':ticket.id,'ticket.subject':ticket.subject,'ticket.link':typeof env.APP_ORIGIN==='string'?new URL(`/projects/${encodeURIComponent(actor.projectId)}/conversations/${encodeURIComponent(ticket.id)}`,env.APP_ORIGIN).href:undefined,
  'assignee.name':assignee?.name,'assignee.email':assignee?.email,'brand.id':brand?.id,'brand.name':brand?.name,
  'organisation.name':metadata.organisation?.name??metadata.organization?.name??metadata.organisation_name??metadata.organization_name,
  'organisation.id':metadata.organisation?.id??metadata.organization?.id,
 }
 context['organization.name']=context['organisation.name'];context['organization.id']=context['organisation.id']
 for(const f of fields.results)if(fieldAllowed(f,access)){
  context[`ticket.custom.${f.id}`]=ticket.fields[f.id]
  if(f.key)context[`ticket.custom.${f.key}`]=ticket.fields[f.id]
 }
 for(const [key,value] of Object.entries(metadata.custom_fields??{}))if(['string','number','boolean'].includes(typeof value))context[`contact.custom.${key}`]=value
 return {context,ticket}
}
