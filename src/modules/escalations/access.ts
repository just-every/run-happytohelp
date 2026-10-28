import {ticketScopeSql} from '../access/ticket-scope'
import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import type {Permission} from '../access/catalogue'
import {contactAvailableSql} from '../conversations/contact-privacy'
export async function escalationAccess(c:Context<AppEnv>,permission?:Permission){
 const actor=await scope(c) as Actor,access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(permission&&!access?.permissions.has(permission))throw new HTTPException(403,{message:'Your role cannot perform this escalation action'})
 const conversationId=c.req.param('conversationId')
 const conversation=conversationId?await c.env.DB.prepare(`SELECT c.* FROM conversations c WHERE c.project_id=? AND c.id=? AND ${contactAvailableSql()} AND ${ticketScopeSql('?')} AND NOT EXISTS(SELECT 1 FROM conversation_merges m WHERE m.source_id=c.id AND m.undone_at IS NULL)`).bind(actor.projectId,conversationId,actor.id).first<any>():null
 if(conversationId&&!conversation)throw new HTTPException(404)
 return {actor,conversation}
}
export function string(value:unknown,name:string,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new HTTPException(400,{message:`Invalid ${name}`});return value.trim()}

export async function requestBody(c:Context<AppEnv>){
 const body=await c.req.json().catch(()=>null)
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HTTPException(400,{message:'Submit a JSON object'})
 return body
}
