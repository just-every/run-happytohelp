import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {ticketScopeSql} from './ticket-scope'

/** Check a prospective ticket with the same stored selection as an existing one.
 * SQL expressions are supplied only by code; caller values remain bound. */
export function destinationScopeSql(user:string,project:string,group:string){
 return `EXISTS(SELECT 1 FROM (SELECT ${user} scope_user,${group} scope_destination) destination WHERE ${ticketScopeSql('destination.scope_user',project,'destination.scope_destination')})`
}
export async function requireDestinationScope(env:Env,actor:Pick<Actor,'id'|'projectId'>,groupId:string|null){
 const allowed=await env.DB.prepare(`SELECT 1 FROM (SELECT ? project_id) prospective WHERE ${destinationScopeSql('?','prospective','?')}`).bind(actor.projectId,actor.id,groupId).first()
 if(!allowed)throw new HTTPException(403,{message:'Your role does not allow the destination group.'})
}
