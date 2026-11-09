import {requireActor} from '../../platform/auth'
import {ticketScopeSql} from '../access/ticket-scope'
import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'

export function resourcePage(c:Context<AppEnv>){
 const integer=(key:string,fallback:number,max:number)=>{const value=c.req.query(key);if(value===undefined)return fallback;if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)throw new HTTPException(400,{message:`Invalid ${key}`});return Number(value)}
 return {page:integer('page',1,1000000),limit:integer('limit',50,200)}
}
export async function contactConversations(c:Context<AppEnv>,projectId:string){
 const contactId=c.req.param('resourceId'),{page,limit}=resourcePage(c)
 const contact=await c.env.DB.prepare('SELECT id FROM contacts WHERE id=? AND project_id=?').bind(contactId,projectId).first()
 if(!contact)throw new HTTPException(404)
 const actor=await requireActor(c)
 // The contact's own conversations and the ones it takes part in, each through its own key, never every conversation.
 const where=`c.id IN (SELECT own.id FROM conversations own WHERE own.project_id=? AND own.contact_id=? UNION SELECT p.conversation_id FROM conversation_participants p WHERE p.contact_id=?) AND ${ticketScopeSql('?')} AND +c.project_id=?`,params=[projectId,contactId,contactId,actor.id,projectId]
 const [count,result]=await Promise.all([
  c.env.DB.prepare(`SELECT count(*) total FROM conversations c WHERE ${where}`).bind(...params).first<{total:number}>(),
  c.env.DB.prepare(`SELECT c.id,c.updated_at,c.created_at,c.resolved_at,(SELECT substr(m.content,1,240) FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id ORDER BY m.revision DESC LIMIT 1) preview FROM conversations c WHERE ${where} ORDER BY c.updated_at DESC,c.id ASC LIMIT ? OFFSET ?`).bind(...params,limit,(page-1)*limit).all(),
 ])
 const total=count?.total||0
 return {data:result.results,pagination:{page,limit,total,hasMore:page*limit<total}}
}
