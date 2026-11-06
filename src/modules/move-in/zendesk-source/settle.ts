import {canonicalJson,sha256} from '../../import-kit/src/d1/index'
import {sourceIdentity} from '../../import-kit/src/provenance/identity'
import {nativeId} from '../readers/common'
import type {PullContext} from './context'
import type {StagedKind} from './staging'
/** Before anything is packed, each staged record is settled against what earlier
 * imports already hold, so nothing held is offered to the engine as a replacement:
 * - already imported and unchanged: nothing to import, so it is no batch's primary
 *   record (people, companies and fields stay available as a new record's references);
 * - a person, company or ticket that changed in Zendesk since: kept as imported and
 *   counted, never refused. New tickets and replies link to it by its source ID;
 * - a ticket that gained replies: each new comment is staged as a reply of its own
 *   (kind `ticket_comment`, keyed by the comment ID), attached to the conversation
 *   the earlier import holds;
 * - any other changed record (a field definition or article) is refused by id with
 *   the engine's own reason, `source_changed_conflict`;
 * - a ticket or reply whose requester or author the pull refused is refused by id
 *   with the reason the engine gives it.
 * Companies settle before people, people before tickets, and tickets before replies. */
const ORDER:StagedKind[]=['organization','user','ticket_field','ticket','ticket_comment','article']
const KEPT=new Set<StagedKind>(['organization','user','ticket'])
const ROWS=1000,TICKET_ROWS=200,HASH_BYTES=4*1024*1024
// A claim with no native effects: historical staff, or a held-back article.
const NO_EFFECTS=sha256(canonicalJson([]))
interface Row {source_id:string;bytes:number;refs_json:string|null;link:string|null;role:string|null}
interface Claim {identity:string;source_hash:string;effects_hash:string}
const list=(values:Iterable<string>)=>JSON.stringify([...values])
const linkOf=(kind:StagedKind)=>kind==='ticket'?"CAST(json_extract(record_json,'$.requester_id') AS TEXT)":'NULL'
/** A ticket's own fields, without its comments and the clocks a reply moves. */
export function ticketFieldsHash(ticket:Record<string,unknown>){const {comments:_c,updated_at:_u,generated_timestamp:_g,...fields}=ticket;return sha256(canonicalJson(fields))}
export const emptyHeld=()=>({tickets:{unchanged:0,changed:0},users:{unchanged:0,changed:0},organizations:{unchanged:0,changed:0}})
const heldKey:Partial<Record<StagedKind,'tickets'|'users'|'organizations'>>={ticket:'tickets',user:'users',organization:'organizations'}
/** One bounded slice per invocation; true once every kind has settled. */
export async function settled(ctx:PullContext):Promise<boolean>{
 const at=ctx.cursor.settle??{kind:0,after:-1};if(at.kind>=ORDER.length)return true
 const kind=ORDER[at.kind],db=ctx.env.DB,project=ctx.pull.project_id
 const rows=(await db.prepare(`SELECT source_id,length(CAST(record_json AS BLOB)) bytes,refs_json,${linkOf(kind)} link,${kind==='user'?"json_extract(record_json,'$.role')":'NULL'} role FROM move_in_zendesk_staged WHERE pull_id=? AND kind=? AND state='ready' AND CAST(source_id AS INTEGER)>? ORDER BY CAST(source_id AS INTEGER) LIMIT ?`).bind(ctx.pull.id,kind,at.after,kind==='ticket'?TICKET_ROWS:ROWS).all<Row>()).results
 ctx.more=true
 if(!rows.length){ctx.cursor.settle={kind:at.kind+1,after:-1};return false}
 const identity=(id:string)=>sourceIdentity(project,'zendesk',kind,id)
 const claims=new Map((await db.prepare('SELECT s.identity,s.source_hash,s.effects_hash FROM json_each(?3) wanted CROSS JOIN ik_sources s ON s.identity=wanted.value CROSS JOIN ik_jobs j ON j.id=s.job_id WHERE j.destination=?1 AND j.namespace=?2').bind(project,'zendesk',list(rows.map(r=>identity(r.source_id)))).all<Claim>()).results.map(c=>[c.identity,c]))
 // Hash only claimed records, within a byte budget; the cursor stops where it stopped.
 let budget=0,taken=rows.length
 for(let i=0;i<rows.length;i++)if(claims.has(identity(rows[i].source_id))){budget+=rows[i].bytes;if(budget>HASH_BYTES&&i>0){taken=i;break}}
 const slice=rows.slice(0,taken),claimed=slice.filter(r=>claims.has(identity(r.source_id))).map(r=>r.source_id)
 const bodies=claimed.length?new Map((await db.prepare('SELECT source_id,record_json FROM move_in_zendesk_staged WHERE pull_id=? AND kind=? AND source_id IN (SELECT value FROM json_each(?))').bind(ctx.pull.id,kind,list(claimed)).all<{source_id:string;record_json:string}>()).results.map(r=>[r.source_id,r.record_json])):new Map<string,string>()
 const refusedBy=await dependencyRefusals(ctx,kind,slice),refused=new Map<string,string>(),held:string[]=[],changedTickets:{id:string;ticket:any}[]=[]
 const tally=ctx.counts.held??=emptyHeld(),count=(state:'unchanged'|'changed')=>{const key=heldKey[kind];if(key)tally[key][state]++}
 for(const row of slice){
  const reason=refusedBy(row);if(reason){refused.set(row.source_id,reason);continue}
  const claim=claims.get(identity(row.source_id));if(!claim)continue
  // The reader's own payload hash: a wrapped record's payload is exactly the staged object.
  let record:any;try{record=JSON.parse(bodies.get(row.source_id)!)}catch{continue}
  const same=claim.source_hash===sha256(canonicalJson(record))
  if(same){held.push(row.source_id);count('unchanged');continue}
  // Historical staff and held-back articles have no native effects to keep; any
  // other record an earlier import rejected goes back to the engine as it stands.
  if(claim.effects_hash===NO_EFFECTS){if(kind==='user'&&row.role!=='end-user'){held.push(row.source_id);count('changed')}continue}
  if(kind==='ticket'){held.push(row.source_id);changedTickets.push({id:row.source_id,ticket:record});continue}
  if(KEPT.has(kind)){held.push(row.source_id);count('changed');continue}
  refused.set(row.source_id,'source_changed_conflict')
 }
 if(changedTickets.length)await stageReplies(ctx,changedTickets,tally)
 if(refused.size){const entries=JSON.stringify([...refused].map(([id,reason])=>({id,reason})));ctx.statements.push(
  db.prepare("DELETE FROM move_in_zendesk_staged WHERE pull_id=? AND kind=? AND source_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))").bind(ctx.pull.id,kind,entries),
  db.prepare("INSERT OR REPLACE INTO move_in_zendesk_refusals(pull_id,kind,source_id,reason) SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.reason') FROM json_each(?)").bind(ctx.pull.id,kind,entries))}
 if(held.length)ctx.statements.push(db.prepare(`UPDATE move_in_zendesk_staged SET state='packed'${['ticket','ticket_comment','article'].includes(kind)?',record_json=NULL':''} WHERE pull_id=? AND kind=? AND source_id IN (SELECT value FROM json_each(?))`).bind(ctx.pull.id,kind,list(held)))
 ctx.cursor.settle={kind:at.kind,after:Number(slice[slice.length-1].source_id)}
 return false
}
/** A ticket an earlier import holds keeps its conversation as imported. Its own
 * fields count as changed when they differ from the packed version; each comment
 * its conversation does not yet carry is staged as a reply of its own. */
async function stageReplies(ctx:PullContext,tickets:{id:string;ticket:any}[],tally:ReturnType<typeof emptyHeld>){
 const db=ctx.env.DB,project=ctx.pull.project_id
 const stored=new Map((await db.prepare('SELECT source_id,fields_hash FROM move_in_zendesk_ticket_fields WHERE project_id=? AND source_id IN (SELECT value FROM json_each(?))').bind(project,list(tickets.map(t=>t.id))).all<{source_id:string;fields_hash:string}>()).results.map(r=>[r.source_id,r.fields_hash]))
 const candidates=tickets.flatMap(({id,ticket})=>(Array.isArray(ticket.comments)?ticket.comments:[]).map((comment:any)=>({ticket:id,comment,target:nativeId(project,'zendesk','message',`${id}:${comment?.id}`)})))
 const present=new Set<string>()
 for(let start=0;start<candidates.length;start+=5000){const ids=list(candidates.slice(start,start+5000).map(c=>c.target));for(const row of (await db.prepare('SELECT n.id FROM json_each(?2) wanted CROSS JOIN messages n ON n.id=wanted.value AND n.project_id=?1 UNION SELECT n.id FROM json_each(?2) wanted CROSS JOIN move_in_notes n ON n.id=wanted.value AND n.project_id=?1').bind(project,ids).all<{id:string}>()).results)present.add(row.id)}
 for(const {id,ticket} of tickets){
  if(stored.get(id)===ticketFieldsHash(ticket))tally.tickets.unchanged++;else tally.tickets.changed++
  const replies=candidates.filter(c=>c.ticket===id&&!present.has(c.target)).map(({comment})=>{const record={...comment,ticket_id:ticket.id};return {id:String(comment.id),record,refs:{users:[String(comment.author_id)],fields:[]}}})
  if(replies.length)ctx.statements.push(db.prepare("INSERT INTO move_in_zendesk_staged(pull_id,kind,source_id,state,record_json,refs_json) SELECT ?1,'ticket_comment',json_extract(value,'$.id'),'ready',json_extract(value,'$.record'),json_extract(value,'$.refs') FROM json_each(?2) WHERE true ON CONFLICT(pull_id,kind,source_id) DO NOTHING").bind(ctx.pull.id,JSON.stringify(replies)))
 }
}
/** Refusals the pull already holds for what these records depend on. */
async function dependencyRefusals(ctx:PullContext,kind:StagedKind,rows:Row[]):Promise<(row:Row)=>string|null>{
 if(kind!=='ticket'&&kind!=='ticket_comment')return ()=>null
 const refs=(row:Row)=>(JSON.parse(row.refs_json||'{"users":[]}') as {users:string[]}).users,ids=new Set(rows.flatMap(refs))
 const people=ids.size?new Set((await ctx.env.DB.prepare("SELECT source_id FROM move_in_zendesk_refusals WHERE pull_id=? AND kind='user' AND source_id IN (SELECT value FROM json_each(?))").bind(ctx.pull.id,list(ids)).all<{source_id:string}>()).results.map(r=>r.source_id)):new Set<string>()
 return row=>row.link&&people.has(row.link)?'conversation_contact_rejected':refs(row).some(id=>people.has(id))?'comment_author_conflict':null
}
