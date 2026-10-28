import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {ticketAuthority,type TicketAuthority} from '../tickets/model'
import {contactAvailableSql} from '../conversations/contact-privacy'
import type {Permission} from '../access/catalogue'

export type CollaborationAuthority=TicketAuthority
export function memberIds(value:unknown){
 if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!id||id.length>200))throw new HTTPException(400,{message:'Choose up to 100 teammates.'})
 return [...new Set(value)] as string[]
}
/** The same predicate is read during validation and applied again inside the write batch. */
export async function collaborationGuard(env:Env,actor:Actor,conversationId:string,ids:string[],authority:CollaborationAuthority,permission:Permission){
 // Integration tokens cannot create internal collaboration authority.
 if(authority.tokenAuthority)throw new HTTPException(403)
 const access=await ticketAuthority(env,actor,authority,permission,conversationId)
 const sql=`SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND EXISTS(${access.sql}) AND NOT EXISTS(SELECT 1 FROM json_each(?) target WHERE NOT EXISTS(SELECT 1 FROM memberships member JOIN users u ON u.id=member.user_id WHERE member.project_id=c.project_id AND member.user_id=target.value))`
 const params=[conversationId,actor.projectId,...access.params,JSON.stringify(ids)]
 if(!await env.DB.prepare(sql).bind(...params).first())throw new HTTPException(403,{message:'This conversation or a selected teammate is no longer available in this workspace.'})
 return {sql,params}
}
