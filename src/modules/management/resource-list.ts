import {requireActor} from '../../platform/auth'
import {ticketScopeSql} from '../access/ticket-scope'
import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'

export function resourcePage(c:Context<AppEnv>){
 const integer=(key:string,fallback:number,max:number)=>{const value=c.req.query(key);if(value===undefined)return fallback;if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)throw new HTTPException(400,{message:`Invalid ${key}`});return Number(value)}
 return {page:integer('page',1,1000000),limit:integer('limit',50,200)}
}
export async function listResources(c:Context<AppEnv>,projectId:string,kind:'contacts'|'macros'){
 const {page,limit}=resourcePage(c),search=c.req.query('search')||''
 if(search.length>500)throw new HTTPException(400,{message:'Search is too long'})
 const contact=kind==='contacts',meta=(key:string)=>`json_extract(metadata_json,'$.${key}')`
 const sorts:Record<string,string>=contact?{
  last_seen_at:`CAST(coalesce(${meta('last_seen_at')},0) AS INTEGER)`,
  name:`coalesce(nullif(${meta('provided_name')},''),name,'') COLLATE NOCASE`,
  email:`coalesce(nullif(${meta('provided_email')},''),email,'') COLLATE NOCASE`,
  country:`coalesce(nullif(${meta('country_name')},''),${meta('country_code')},'') COLLATE NOCASE`,
 }:{title:'title COLLATE NOCASE',created_at:'created_at',created_by_name:'created_by_name COLLATE NOCASE'}
 const sort=c.req.query('sort')||(contact?'last_seen_at':'title'),direction=c.req.query('direction')||(sort==='last_seen_at'?'desc':'asc')
 if(!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))throw new HTTPException(400,{message:'Invalid sort order'})
 const fields=contact?['name','email',meta('provided_name'),meta('provided_email')]:['title','content']
 const where=`project_id=? ${contact?`AND coalesce(${meta('is_deleted')},0)!=1`:''} AND (${fields.map(field=>`coalesce(${field},'') LIKE ? ESCAPE '\\'`).join(' OR ')})`
 const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`,params=[projectId,...fields.map(()=>term)]
 const selected=contact?'NULL created_by_name':"(SELECT name FROM users WHERE id=macros.created_by) created_by_name"
 const [count,result]=await Promise.all([
  c.env.DB.prepare(`SELECT count(*) total FROM ${kind} WHERE ${where}`).bind(...params).first<{total:number}>(),
  c.env.DB.prepare(`SELECT *,${selected} FROM ${kind} WHERE ${where} ORDER BY ${sorts[sort]} ${direction},id ASC LIMIT ? OFFSET ?`).bind(...params,limit,(page-1)*limit).all(),
 ])
 const total=count?.total||0
 return {data:result.results,pagination:{page,limit,total,hasMore:page*limit<total},sort,direction}
}

export async function contactConversations(c:Context<AppEnv>,projectId:string){
 const contactId=c.req.param('resourceId'),{page,limit}=resourcePage(c)
 const contact=await c.env.DB.prepare('SELECT id FROM contacts WHERE id=? AND project_id=?').bind(contactId,projectId).first()
 if(!contact)throw new HTTPException(404)
 const actor=await requireActor(c)
 const where=`${ticketScopeSql('?')} AND c.project_id=? AND (c.contact_id=? OR EXISTS(SELECT 1 FROM conversation_participants p WHERE p.conversation_id=c.id AND p.contact_id=?))`,params=[actor.id,projectId,contactId,contactId]
 const [count,result]=await Promise.all([
  c.env.DB.prepare(`SELECT count(*) total FROM conversations c WHERE ${where}`).bind(...params).first<{total:number}>(),
  c.env.DB.prepare(`SELECT c.id,c.updated_at,c.created_at,c.resolved_at,(SELECT substr(m.content,1,240) FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id ORDER BY m.revision DESC LIMIT 1) preview FROM conversations c WHERE ${where} ORDER BY c.updated_at DESC,c.id ASC LIMIT ? OFFSET ?`).bind(...params,limit,(page-1)*limit).all(),
 ])
 const total=count?.total||0
 return {data:result.results,pagination:{page,limit,total,hasMore:page*limit<total}}
}
