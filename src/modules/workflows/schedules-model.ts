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
export async function scheduleReferences(env:Env,projectId:string,ticketId:string,value:ReturnType<typeof scheduleDefinition>){
 if(!await env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(projectId,value.owner_id).first())invalid('The responsible teammate must belong to this workspace')
 if(value.dependency_id&&(value.dependency_id===ticketId||!await env.DB.prepare('SELECT 1 FROM conversations WHERE project_id=? AND id=?').bind(projectId,value.dependency_id).first()))invalid('Choose another ticket in this workspace as the dependency')
}
export async function scheduleRows(env:Env,projectId:string,id?:string){return (await env.DB.prepare(`SELECT * FROM workflow_schedules WHERE project_id=? ${id?'AND conversation_id=?':''} ORDER BY created_at DESC LIMIT 200`).bind(projectId,...(id?[id]:[])).all()).results}
export async function workflowTicketData(env:Env,projectId:string,id:string){
 const [schedules,parent,children]=await Promise.all([scheduleRows(env,projectId,id),env.DB.prepare('SELECT original_id FROM ticket_followups WHERE project_id=? AND conversation_id=?').bind(projectId,id).first<{original_id:string}>(),env.DB.prepare('SELECT c.id,c.subject,c.status_category FROM ticket_followups f JOIN conversations c ON c.id=f.conversation_id WHERE f.project_id=? AND f.original_id=? ORDER BY f.created_at').bind(projectId,id).all()])
 return {schedules,followup_of:parent?.original_id??null,followups:children.results}
}
export const scheduleConflict=()=>new HTTPException(409,{message:'Schedule, ticket or authority changed. Reload before continuing.'})
