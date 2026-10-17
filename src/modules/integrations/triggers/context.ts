import type {Env} from '../../../platform/env'
export async function notificationTemplateContext(env:Env,ticket:any,options:{expectedReplyTime?:string;actorId?:string}={}){
 const primary=await env.DB.prepare('SELECT name,email,metadata_json FROM contacts WHERE project_id=? AND id=?').bind(ticket.project_id,ticket.contact_id).first<any>(),metadata=JSON.parse(primary?.metadata_json||'{}')
 const requesterName=metadata.provided_name?.trim()||ticket.requester_name
 const context:Record<string,unknown>={'requester.name':requesterName,'requester.first_name':requesterName?.split(/\s+/)[0],'requester.email':primary?.email,'ticket.id':ticket.id,'ticket.subject':ticket.subject,'ticket.status':ticket.status_category,'ticket.priority':ticket.priority,'brand.name':ticket.brand_name,'brand.id':ticket.brand_id??ticket.project_id,expected_reply_time:options.expectedReplyTime}
 context['contact.name']=requesterName;context['contact.email']=primary?.email
 context['organisation.name']=metadata.organisation?.name??metadata.organization?.name??metadata.organisation_name??metadata.organization_name
 context['organisation.id']=metadata.organisation?.id??metadata.organization?.id
 context['organization.name']=context['organisation.name'];context['organization.id']=context['organisation.id']
 for(const [key,value] of Object.entries(metadata.custom_fields??{}))if(['string','number','boolean'].includes(typeof value))context[`contact.custom.${key}`]=value
 if(typeof env.APP_ORIGIN==='string')context['ticket.link']=new URL(`/projects/${encodeURIComponent(ticket.project_id)}/conversations/${encodeURIComponent(ticket.id)}`,env.APP_ORIGIN).href
 const fields=await env.DB.prepare("SELECT f.id,v.value_json FROM ticket_fields f JOIN ticket_field_values v ON v.field_id=f.id AND v.project_id=f.project_id WHERE f.project_id=? AND v.conversation_id=? AND f.read_roles_json='[]'").bind(ticket.project_id,ticket.id).all<any>()
 for(const field of fields.results)context[`ticket.custom.${field.id}`]=JSON.parse(field.value_json)
 if(ticket.assigned_to){const user=await env.DB.prepare('SELECT name,email FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.project_id=?').bind(ticket.assigned_to,ticket.project_id).first<any>();if(user){context['assignee.name']=user.name;context['assignee.email']=user.email}}
 if(options.actorId){const agent=await env.DB.prepare('SELECT u.name,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND m.user_id=?').bind(ticket.project_id,options.actorId).first<any>();if(agent){context['agent.name']=agent.name;context['agent.email']=agent.email}}
 return context
}
