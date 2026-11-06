import {PULL_LIMITS} from '../types'
import {auditShape} from '../readers/shapes'
import {Deferred,type PullContext} from './context'
import {afterCursor,list,sourceGet} from './requests'
import {sanitize,stableUser} from './sanitize'
import {bytesOf,refuse,stage,stageRecord,zendeskId} from './staging'
const REQUESTS=10,TICKETS=10
/** The people and field definitions a ticket's import needs in its own batch. */
export function ticketRefs(ticket:any){
 const users=new Set<string>(),fields=new Set<string>()
 const add=(set:Set<string>,value:unknown)=>{try{set.add(zendeskId(value))}catch{}}
 add(users,ticket.requester_id)
 for(const comment of Array.isArray(ticket.comments)?ticket.comments:[])add(users,comment?.author_id)
 for(const value of Array.isArray(ticket.custom_fields)?ticket.custom_fields:[])if(value&&value.value!==null&&value.value!=='')add(fields,value.id)
 return {users:[...users].sort(),fields:[...fields].sort()}
}
/** Every comment page of each ticket, with inline images listed, until the ticket
 * is complete. A ticket the engine cannot carry whole is refused by name. */
export async function readComments(ctx:PullContext){
 const rows=(await ctx.env.DB.prepare("SELECT source_id,record_json,comments_cursor FROM move_in_zendesk_staged WHERE pull_id=? AND kind='ticket' AND state='comments' ORDER BY CAST(source_id AS INTEGER) LIMIT ?").bind(ctx.pull.id,TICKETS).all<{source_id:string;record_json:string;comments_cursor:string|null}>()).results
 if(!rows.length){ctx.phase='people';ctx.more=true;return}
 for(const row of rows){
  if(ctx.requests>=REQUESTS)break
  const ticket=JSON.parse(row.record_json),id=row.source_id
  let cursor=row.comments_cursor,outcome:'partial'|'complete'|'gone'|'oversized'='partial'
  try{
   while(ctx.requests<REQUESTS){
    const data=await sourceGet(ctx,`/api/v2/tickets/${id}/comments.json?page[size]=100&include_inline_images=true${cursor?`&page[after]=${encodeURIComponent(cursor)}`:''}`,{missing:true})
    if(data===null){outcome='gone';break}
    ticket.comments.push(...(sanitize(list(data,'comments'),ctx.counts as {redacted:number}) as unknown[]))
    cursor=afterCursor(data)
    if(bytesOf(JSON.stringify({ticket}))>PULL_LIMITS.recordBytes){outcome='oversized';break}
    if(!cursor){outcome='complete';break}
   }
  }catch(error){if(error instanceof Deferred)ctx.statements.push(partial(ctx,id,ticket,cursor));throw error}
  if(outcome==='gone')ctx.statements.push(stage(ctx,'ticket',id,'deleted',null))
  else if(outcome==='oversized')refuse(ctx,'ticket',id,'ticket_size_limit')
  else if(outcome==='complete'){
   if(auditShape('zendesk','ticket',ticket,PULL_LIMITS.shapeNodes).exhausted!==undefined)refuse(ctx,'ticket',id,'source_identity_node_limit')
   else ctx.statements.push(stage(ctx,'ticket',id,'ready',ticket,ticketRefs(ticket)))
  }else ctx.statements.push(partial(ctx,id,ticket,cursor))
 }
 ctx.more=true
}
const partial=(ctx:PullContext,id:string,ticket:unknown,cursor:string|null)=>ctx.env.DB.prepare("UPDATE move_in_zendesk_staged SET record_json=?,comments_cursor=? WHERE pull_id=? AND kind='ticket' AND source_id=? AND state='comments'").bind(JSON.stringify(ticket),cursor,ctx.pull.id,id)
/** People a ticket references but the export did not bring (a repeat pull reads
 * only changed people) are read by id. Ids Zendesk no longer has stay missing,
 * and the reader then refuses the tickets that need them by name. */
export async function readPeople(ctx:PullContext){
 const users=(await ctx.env.DB.prepare("SELECT DISTINCT r.value id FROM move_in_zendesk_staged t, json_each(t.refs_json,'$.users') r WHERE t.pull_id=?1 AND t.kind='ticket' AND t.state='ready' AND NOT EXISTS(SELECT 1 FROM move_in_zendesk_staged u WHERE u.pull_id=?1 AND u.kind='user' AND u.source_id=r.value) AND NOT EXISTS(SELECT 1 FROM move_in_zendesk_refusals f WHERE f.pull_id=?1 AND f.kind='user' AND f.source_id=r.value) ORDER BY CAST(r.value AS INTEGER) LIMIT 100").bind(ctx.pull.id).all<{id:string}>()).results.map(row=>String(row.id))
 if(users.length){await showMany(ctx,'user','users',users,stableUser);return}
 const organizations=(await ctx.env.DB.prepare("SELECT DISTINCT CAST(json_extract(u.record_json,'$.organization_id') AS TEXT) id FROM move_in_zendesk_staged u WHERE u.pull_id=?1 AND u.kind='user' AND u.state='ready' AND json_extract(u.record_json,'$.organization_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM move_in_zendesk_staged o WHERE o.pull_id=?1 AND o.kind='organization' AND o.source_id=CAST(json_extract(u.record_json,'$.organization_id') AS TEXT)) AND NOT EXISTS(SELECT 1 FROM move_in_zendesk_refusals f WHERE f.pull_id=?1 AND f.kind='organization' AND f.source_id=CAST(json_extract(u.record_json,'$.organization_id') AS TEXT)) ORDER BY CAST(id AS INTEGER) LIMIT 100").bind(ctx.pull.id).all<{id:string}>()).results.map(row=>String(row.id))
 if(organizations.length){await showMany(ctx,'organization','organizations',organizations);return}
 ctx.phase='packing';ctx.more=true
}
async function showMany(ctx:PullContext,kind:'user'|'organization',collection:string,ids:string[],shape?:(record:any)=>any){
 const data=await sourceGet(ctx,`/api/v2/${collection}/show_many.json?ids=${ids.join(',')}`),found=new Set<string>()
 for(const record of list(data,collection)){const id=zendeskId(record?.id);if(!ids.includes(id))continue;found.add(id);stageRecord(ctx,kind,record,shape)}
 for(const id of ids)if(!found.has(id))ctx.statements.push(stage(ctx,kind,id,'missing',null))
 ctx.more=true
}
