import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {ticketScopeSql} from '../access/ticket-scope'

/** Unattributed contact aggregates are safe only when every source ticket is
 * visible. Ticketless subjects, NULL selections and native owners retain access. */
export function contextSubjectScopeSql(user:string,project:string,subject:string){
 return `NOT EXISTS(SELECT 1 FROM conversations context_ticket WHERE context_ticket.project_id=${project} AND context_ticket.contact_id=${subject} AND NOT ${ticketScopeSql(user,'context_ticket')})`
}
export async function contextSubjectAllowed(env:Env,projectId:string,subjectId:string,userId?:string){
 if(!userId)return true
 return !!await env.DB.prepare(`SELECT 1 FROM (SELECT ? project_id,? subject_id) subject WHERE ${contextSubjectScopeSql('?','subject.project_id','subject.subject_id')}`).bind(projectId,subjectId,userId).first()
}
export async function requireContextSubjectScope(env:Env,projectId:string,subjectId:string,userId?:string){
 if(!await contextSubjectAllowed(env,projectId,subjectId,userId))throw new HTTPException(404,{message:'Context subject missing'})
}
