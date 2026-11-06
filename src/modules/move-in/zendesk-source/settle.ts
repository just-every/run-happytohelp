import {canonicalJson,sha256} from '../../import-kit/src/d1/index'
import {sourceIdentity} from '../../import-kit/src/provenance/identity'
import type {PullContext} from './context'
import type {StagedKind} from './staging'
/** Before anything is packed, each staged record is checked against what earlier
 * imports already hold, so a record the engine would refuse never shares a batch
 * with new tickets and holds them waiting:
 * - already imported and unchanged: nothing to import, so it is no batch's primary
 *   record (people, companies and fields stay available as a new ticket's references);
 * - already imported and changed in Zendesk: refused by id with the engine's own
 *   reason, `source_changed_conflict` (the engine never replaces a held record);
 * - a person whose company was so refused, and a ticket whose requester or comment
 *   author the pull refused, are refused by id with the reason the engine gives them.
 * Companies settle before people, and people before tickets. */
const ORDER:StagedKind[]=['organization','user','ticket_field','ticket','article']
const ROWS=1000,TICKET_ROWS=200,HASH_BYTES=4*1024*1024
// A claim with no native effects: historical staff, or a held-back article.
const NO_EFFECTS=sha256(canonicalJson([]))
interface Row {source_id:string;bytes:number;refs_json:string|null;link:string|null;role:string|null}
interface Claim {identity:string;source_hash:string;effects_hash:string}
const list=(values:Iterable<string>)=>JSON.stringify([...values])
const linkOf=(kind:StagedKind)=>kind==='ticket'?"CAST(json_extract(record_json,'$.requester_id') AS TEXT)":kind==='user'?"CAST(json_extract(record_json,'$.organization_id') AS TEXT)":'NULL'
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
 const refusedBy=await dependencyRefusals(ctx,kind,slice),refused=new Map<string,string>(),unchanged:string[]=[]
 for(const row of slice){
  const reason=refusedBy(row);if(reason){refused.set(row.source_id,reason);continue}
  const claim=claims.get(identity(row.source_id));if(!claim)continue
  // The reader's own payload hash: a wrapped record's payload is exactly the staged object.
  let hash:string;try{hash=sha256(canonicalJson(JSON.parse(bodies.get(row.source_id)!)))}catch{continue}
  const same=claim.source_hash===hash
  if(claim.effects_hash===NO_EFFECTS){if(same||kind==='user'&&row.role!=='end-user')unchanged.push(row.source_id);continue}
  if(same)unchanged.push(row.source_id);else refused.set(row.source_id,'source_changed_conflict')
 }
 if(refused.size){const entries=JSON.stringify([...refused].map(([id,reason])=>({id,reason})));ctx.statements.push(
  db.prepare("DELETE FROM move_in_zendesk_staged WHERE pull_id=? AND kind=? AND source_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))").bind(ctx.pull.id,kind,entries),
  db.prepare("INSERT OR REPLACE INTO move_in_zendesk_refusals(pull_id,kind,source_id,reason) SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.reason') FROM json_each(?)").bind(ctx.pull.id,kind,entries))}
 if(unchanged.length)ctx.statements.push(db.prepare(`UPDATE move_in_zendesk_staged SET state='packed'${['ticket','article'].includes(kind)?',record_json=NULL':''} WHERE pull_id=? AND kind=? AND source_id IN (SELECT value FROM json_each(?))`).bind(ctx.pull.id,kind,list(unchanged)))
 ctx.cursor.settle={kind:at.kind,after:Number(slice[slice.length-1].source_id)}
 return false
}
/** Refusals the pull already holds for what these records depend on. */
async function dependencyRefusals(ctx:PullContext,kind:StagedKind,rows:Row[]):Promise<(row:Row)=>string|null>{
 const held=async(of:StagedKind,ids:string[],only?:string)=>ids.length?new Set((await ctx.env.DB.prepare(`SELECT source_id FROM move_in_zendesk_refusals WHERE pull_id=? AND kind=? AND source_id IN (SELECT value FROM json_each(?))${only?' AND reason=?':''}`).bind(ctx.pull.id,of,list(new Set(ids)),...(only?[only]:[])).all<{source_id:string}>()).results.map(r=>r.source_id)):new Set<string>()
 if(kind==='user'){
  // Only a changed company is refused by the engine in the batch with its people.
  const companies=await held('organization',rows.filter(r=>r.role==='end-user'&&r.link).map(r=>r.link!),'source_changed_conflict')
  return row=>row.role==='end-user'&&row.link&&companies.has(row.link)?'contact_company_unavailable':null
 }
 if(kind==='ticket'){
  const refs=(row:Row)=>(JSON.parse(row.refs_json||'{"users":[]}') as {users:string[]}).users
  const people=await held('user',rows.flatMap(refs))
  return row=>row.link&&people.has(row.link)?'conversation_contact_rejected':refs(row).some(id=>people.has(id))?'comment_author_conflict':null
 }
 return ()=>null
}
