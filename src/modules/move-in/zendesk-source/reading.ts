import {ZendeskError} from '../zendesk-connection/errors'
import type {PullContext} from './context'
import {afterCursor,list,sourceGet} from './requests'
import {stableUser} from './sanitize'
import {stage,stageRecord,zendeskId} from './staging'
import {sanitize} from './sanitize'
const PAGES=5
const after=(cursor:string|null|undefined)=>cursor?`&page[after]=${encodeURIComponent(cursor)}`:''
/** Ticket fields and Help Center articles are listed whole with cursor pages. */
async function listed(ctx:PullContext,key:'fields'|'articles',path:string,collection:string,kind:'ticket_field'|'article',next:PullContext['phase']){
 for(let page=0;page<PAGES;page++){
  const data=await sourceGet(ctx,path+after(ctx.cursor[key]),{missing:kind==='article'})
  // A 404 here means the account has no Help Center: there are no articles to read.
  if(data===null){ctx.counts.articlesUnavailable=404;ctx.phase=next;delete ctx.cursor[key];break}
  for(const record of list(data,collection))stageRecord(ctx,kind,record)
  const cursor=afterCursor(data)
  if(!cursor){ctx.phase=next;delete ctx.cursor[key];break}
  ctx.cursor[key]=cursor
 }
 ctx.more=true
}
export const readFields=(ctx:PullContext)=>listed(ctx,'fields','/api/v2/ticket_fields.json?page[size]=100','ticket_fields','ticket_field','articles')
export const readArticles=(ctx:PullContext)=>listed(ctx,'articles','/api/v2/help_center/articles.json?page[size]=100','articles','article','organizations')
/** Organizations have only a time-based incremental export. */
export async function readOrganizations(ctx:PullContext){
 const start=Number(ctx.cursor.organizations??(ctx.pull.start_json?JSON.parse(ctx.pull.start_json).organizations:undefined)??0)
 const data=await sourceGet(ctx,`/api/v2/incremental/organizations.json?per_page=100&start_time=${start}`,{incremental:true})
 for(const record of list(data,'organizations'))stageRecord(ctx,'organization',record)
 if(data.end_of_stream===true){ctx.resume.organizations=Number.isSafeInteger(data.end_time)?data.end_time:start;delete ctx.cursor.organizations;ctx.phase='users'}
 else{if(!Number.isSafeInteger(data.end_time)||data.end_time<=start)throw new ZendeskError('zendesk_export_stalled');ctx.cursor.organizations=data.end_time}
 ctx.more=true
}
/** Cursor-based incremental exports keep their cursor for the next pull. */
async function cursorExport(ctx:PullContext,key:'users'|'tickets',path:string){
 const saved=ctx.cursor[key]??JSON.parse(ctx.pull.start_json||'{}')[key]
 const data=await sourceGet(ctx,path+(saved?`cursor=${encodeURIComponent(saved)}`:'start_time=0'),{incremental:true})
 const rows=list(data,key),next=typeof data.after_cursor==='string'&&data.after_cursor?data.after_cursor:null
 if(data.end_of_stream!==true&&!next)throw new ZendeskError('zendesk_response_invalid')
 return {rows,next,done:data.end_of_stream===true,saved}
}
export async function readUsers(ctx:PullContext){
 const page=await cursorExport(ctx,'users','/api/v2/incremental/users/cursor.json?per_page=100&')
 for(const record of page.rows)stageRecord(ctx,'user',record,stableUser)
 if(page.done){ctx.resume.users=page.next??page.saved??null;delete ctx.cursor.users;ctx.phase='tickets'}else ctx.cursor.users=page.next
 ctx.more=true
}
/** Every ticket, archived ones included (Listing Tickets omits them). Deleted
 * tickets are recorded as source tombstones: never imported, never a refusal. */
export async function readTickets(ctx:PullContext){
 const page=await cursorExport(ctx,'tickets','/api/v2/incremental/tickets/cursor.json?per_page=100&support_type_scope=all&')
 for(const raw of page.rows){
  const id=zendeskId(raw?.id)
  if(raw.status==='deleted'){ctx.statements.push(stage(ctx,'ticket',id,'deleted',null));continue}
  const {comments:_comments,...ticket}=sanitize(raw,ctx.counts as {redacted:number}) as Record<string,unknown>
  ctx.statements.push(stage(ctx,'ticket',id,'comments',{...ticket,comments:[]}))
 }
 if(page.done){ctx.resume.tickets=page.next??page.saved??null;delete ctx.cursor.tickets;ctx.phase='comments'}else ctx.cursor.tickets=page.next
 ctx.more=true
}
