import {ticketScopeSql,requireTicketScope} from '../access/ticket-scope'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {object,invalid} from '../tickets/model'
export function scheduleDefinition(input:unknown,now:number,existing?:any){
 const b={...existing,...object(input)},kind=b.kind
 if(!['snooze','reply'].includes(kind))invalid('Choose snooze or reply')
 if(typeof b.timezone!=='string')invalid('Choose an IANA timezone')
 try{new Intl.DateTimeFormat('en-US',{timeZone:b.timezone}).format()}catch{invalid('Choose a valid IANA timezone')}
 let due:number|null=b.due_at===null||b.due_at===undefined||b.due_at===''?null:typeof b.due_at==='number'?b.due_at:Date.parse(b.due_at)
 if(due!==null&&(!Number.isSafeInteger(due)||due<=now))invalid('Choose a future date and time, including its timezone offset')
 // A local datetime without an offset is ambiguous at DST fall-back; require an instant.
 if(typeof b.due_at==='string'&&b.due_at&&!/(?:Z|[+-]\d\d:\d\d)$/.test(b.due_at))invalid('Date and time must include a timezone offset')
 const dependency=b.dependency_id||null
 if(dependency!==null&&typeof dependency!=='string')invalid('Choose a dependency ticket')
 if(kind==='reply'&&dependency)invalid('Scheduled replies need an exact due time')
 if(due===null&&!(kind==='snooze'&&dependency))invalid('Choose a due time or a dependency')
 const body=kind==='reply'?b.body:''
 if(kind==='reply'&&(typeof body!=='string'||!body.trim()||body.length>100000))invalid('Write a reply of up to 100,000 characters')
 if(typeof b.owner_id!=='string'||!b.owner_id)invalid('Choose a responsible teammate')
 return {kind,due_at:due,timezone:b.timezone,body,owner_id:b.owner_id,dependency_id:dependency}
}
export async function scheduleReferences(env:Env,projectId:string,ticketId:string,value:ReturnType<typeof scheduleDefinition>,userId:string){
 if(!await env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(projectId,value.owner_id).first())invalid('The responsible teammate must belong to this workspace')
 if(value.dependency_id)await requireTicketScope(env,userId,projectId,value.dependency_id)
 if(value.dependency_id&&(value.dependency_id===ticketId||!await env.DB.prepare('SELECT 1 FROM conversations WHERE project_id=? AND id=?').bind(projectId,value.dependency_id).first()))invalid('Choose another ticket in this workspace as the dependency')
}
export async function scheduleRows(env:Env,projectId:string,userId:string,id?:string){
 const rows=await env.DB.prepare(`SELECT s.*,CASE WHEN s.dependency_id IS NULL OR EXISTS(SELECT 1 FROM conversations d WHERE d.id=s.dependency_id AND d.project_id=s.project_id AND ${ticketScopeSql('?','d')}) THEN s.dependency_id ELSE NULL END visible_dependency_id FROM workflow_schedules s JOIN conversations c ON c.project_id=s.project_id AND c.id=s.conversation_id WHERE s.project_id=? AND ${ticketScopeSql('?')} ${id?'AND s.conversation_id=?':''} ORDER BY s.created_at DESC LIMIT 200`).bind(userId,projectId,userId,...(id?[id]:[])).all<any>()
 return rows.results.map(({visible_dependency_id,...row})=>({...row,dependency_id:visible_dependency_id}))
}
export async function workflowTicketData(env:Env,projectId:string,id:string,userId:string){
 const [schedules,parent,children]=await Promise.all([scheduleRows(env,projectId,userId,id),env.DB.prepare(`SELECT f.original_id FROM ticket_followups f JOIN conversations c ON c.project_id=f.project_id AND c.id=f.original_id WHERE f.project_id=? AND f.conversation_id=? AND ${ticketScopeSql('?')}`).bind(projectId,id,userId).first<{original_id:string}>(),env.DB.prepare(`SELECT c.id,c.subject,c.status_category FROM ticket_followups f JOIN conversations c ON c.id=f.conversation_id AND c.project_id=f.project_id WHERE f.project_id=? AND f.original_id=? AND ${ticketScopeSql('?')} ORDER BY f.created_at`).bind(projectId,id,userId).all()])
 return {schedules,followup_of:parent?.original_id??null,followups:children.results}
}
export const scheduleConflict=()=>new HTTPException(409,{message:'Schedule, ticket or authority changed. Reload before continuing.'})
