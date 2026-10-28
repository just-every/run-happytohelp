import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import type {Permission} from '../access/catalogue'
import {contactAvailableSql} from '../conversations/contact-privacy'

export const root='/projects/:projectId'
export const ticket=root+'/conversations/:conversationId'
export function text(value:unknown,label:string,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new HTTPException(400,{message:`Invalid ${label}`});return value.trim()}
export function link(value:unknown){try{const url=new URL(text(value,'record URL'));if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();return url.href}catch{throw new HTTPException(400,{message:'Use a public HTTPS record URL without credentials, query or fragment'})}}
export async function access(c:Context<AppEnv>,permission?:Permission){
 const actor=await scope(c) as Actor,member=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(permission&&!member?.permissions.has(permission))throw new HTTPException(403,{message:'Your role cannot perform this feedback action'})
 const id=c.req.param('conversationId')
 const conversation=id?await c.env.DB.prepare(`SELECT c.* FROM conversations c WHERE c.project_id=? AND c.id=? AND ${contactAvailableSql()} AND NOT EXISTS(SELECT 1 FROM conversation_merges WHERE source_id=c.id AND undone_at IS NULL)`).bind(actor.projectId,id).first<any>():null
 if(id&&!conversation)throw new HTTPException(404)
 return {actor,conversation}
}
