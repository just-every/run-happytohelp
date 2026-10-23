import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import type {Permission} from '../access/catalogue'
import {active,type Connection,type Link} from './model'
export async function access(c:Context<AppEnv>,permission?:Permission){
 const actor=await scope(c) as Actor,member=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(permission&&!member?.permissions.has(permission))throw new HTTPException(403,{message:'Your role cannot perform this business action'})
 const conversationId=c.req.param('conversationId')
 const conversation=conversationId?await c.env.DB.prepare(`SELECT cv.* FROM conversations cv JOIN contacts ct ON ct.id=cv.contact_id AND ct.project_id=cv.project_id WHERE cv.project_id=? AND cv.id=? AND ${active} AND NOT EXISTS(SELECT 1 FROM conversation_merges m WHERE m.source_id=cv.id AND m.undone_at IS NULL)`).bind(actor.projectId,conversationId).first<any>():null
 if(conversationId&&!conversation)throw new HTTPException(404)
 return {actor,conversation}
}
export async function connection(c:Context<AppEnv>){const {actor,conversation}=await access(c),row=await c.env.DB.prepare('SELECT * FROM business_connections WHERE project_id=? AND id=?').bind(actor.projectId,c.req.param('connectionId')!).first<Connection>();if(!row)throw new HTTPException(404);return {actor,conversation,row}}
export async function link(c:Context<AppEnv>){const result=await connection(c);const mapped=await c.env.DB.prepare('SELECT * FROM business_links WHERE project_id=? AND connection_id=? AND conversation_id=?').bind(result.actor.projectId,result.row.id,result.conversation.id).first<Link>();if(!mapped)throw new HTTPException(409,{message:'Explicitly map a provider customer first'});return {...result,mapped}}
/** Every completion is fenced against disconnect, remapping, erasure and session/role changes. */
export function guard(c:Context<AppEnv>,row:Connection,mapped:Link){return {sql:`EXISTS(SELECT 1 FROM business_connections bc JOIN business_links bl ON bl.connection_id=bc.id AND bl.project_id=bc.project_id JOIN conversations cv ON cv.id=bl.conversation_id AND cv.project_id=bl.project_id JOIN contacts ct ON ct.id=cv.contact_id AND ct.project_id=cv.project_id WHERE bc.id=? AND bc.project_id=? AND bc.version=? AND bc.token_cipher IS NOT NULL AND (bc.expires_at IS NULL OR bc.expires_at>?) AND bl.conversation_id=? AND bl.version=? AND ${active})`,params:[row.id,row.project_id,row.version,Date.now(),mapped.conversation_id,mapped.version]}}
