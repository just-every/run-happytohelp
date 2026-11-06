import {LIMITS} from '../types'
import {sha256} from '../../import-kit/src/d1/index'
import {admitExport} from '../routes'
import {zendeskField} from '../readers/zendesk-fields'
import {ZendeskError} from '../zendesk-connection/errors'
import type {PullContext} from './context'
import {settled,ticketFieldsHash} from './settle'
import {refuse,type StagedKind} from './staging'
/** A batch is an ordinary Move in upload in every bound but its source: at most
 * 2 MiB and 5,000 records, carrying the people, companies and field definitions its
 * tickets and replies reference, framed as the Zendesk reader takes them
 * (`{"ticket":{...}}`, `{"ticket_comment":{...}}`). */
const BATCH_BYTES=LIMITS.inputBytes-16*1024,BATCH_RECORDS=LIMITS.records,CANDIDATES=200,READMISSIONS=100
interface Row {source_id:string;bytes:number;refs_json?:string|null;organization?:string|null}
interface Batch {lines:string[];primary:{kind:StagedKind;id:string}[];packed:Partial<Record<StagedKind,string[]>>;tickets?:Map<string,string>}
const ids=(values:Iterable<string>)=>JSON.stringify([...values])
async function sized(ctx:PullContext,kind:StagedKind,states:string[],wanted?:string[],limit=1000){
 if(wanted&&!wanted.length)return [] as Row[]
 return (await ctx.env.DB.prepare(`SELECT source_id,length(CAST(record_json AS BLOB)) bytes,refs_json${kind==='user'?",CAST(json_extract(record_json,'$.organization_id') AS TEXT) organization":''} FROM move_in_zendesk_staged WHERE pull_id=? AND kind=? AND state IN (SELECT value FROM json_each(?)) ${wanted?'AND source_id IN (SELECT value FROM json_each(?))':''} ORDER BY CAST(source_id AS INTEGER) LIMIT ?`).bind(ctx.pull.id,kind,JSON.stringify(states),...(wanted?[ids(wanted)]:[]),limit).all<Row>()).results
}
async function bodies(ctx:PullContext,kind:StagedKind,wanted:string[]){
 if(!wanted.length)return new Map<string,string>()
 const rows=(await ctx.env.DB.prepare('SELECT source_id,record_json FROM move_in_zendesk_staged WHERE pull_id=? AND kind=? AND source_id IN (SELECT value FROM json_each(?))').bind(ctx.pull.id,kind,ids(wanted)).all<{source_id:string;record_json:string}>()).results
 return new Map(rows.map(row=>[row.source_id,row.record_json]))
}
/** A field definition the reader would refuse is left out of ticket batches: the
 * ticket then imports with that value kept in its source custody, named as an
 * omission. Every definition is still reviewed in the fields batch. */
async function acceptedFields(ctx:PullContext,wanted:string[]){
 const accepted=new Set<string>()
 for(const [id,body] of await bodies(ctx,'ticket_field',wanted)){try{zendeskField({sourceId:id,payload:JSON.parse(body)} as any,ctx.pull.project_id);accepted.add(id)}catch{}}
 return accepted
}
/** New tickets first, then replies on tickets earlier imports hold, with what they reference. */
async function ticketBatch(ctx:PullContext,limit:number):Promise<Batch|null>{
 const tickets=await sized(ctx,'ticket',['ready'],undefined,Math.min(limit,CANDIDATES)),replies=tickets.length<Math.min(limit,CANDIDATES)?await sized(ctx,'ticket_comment',['ready'],undefined,Math.min(limit,CANDIDATES)-tickets.length):[]
 const candidates=[...tickets.map(row=>({kind:'ticket' as StagedKind,row})),...replies.map(row=>({kind:'ticket_comment' as StagedKind,row}))];if(!candidates.length)return null
 const refs=new Map(candidates.map(c=>[`${c.kind}/${c.row.source_id}`,JSON.parse(c.row.refs_json||'{"users":[],"fields":[]}') as {users:string[];fields:string[]}]))
 const users=new Map((await sized(ctx,'user',['ready','packed'],[...new Set([...refs.values()].flatMap(r=>r.users))])).map(u=>[u.source_id,u]))
 const organizations=new Map((await sized(ctx,'organization',['ready','packed'],[...new Set([...users.values()].map(u=>u.organization).filter((id):id is string=>!!id))])).map(o=>[o.source_id,o]))
 const fieldRows=new Map((await sized(ctx,'ticket_field',['ready','packed'],[...new Set([...refs.values()].flatMap(r=>r.fields))])).map(f=>[f.source_id,f])),accepted=await acceptedFields(ctx,[...fieldRows.keys()])
 const chosen:{kind:StagedKind;id:string}[]=[],people=new Set<string>(),companies=new Set<string>(),fields=new Set<string>();let bytes=0,records=0
 for(const {kind,row} of candidates){
  const ref=refs.get(`${kind}/${row.source_id}`)!,addUsers=ref.users.filter(id=>users.has(id)&&!people.has(id)),addCompanies=[...new Set(addUsers.map(id=>users.get(id)!.organization).filter((id):id is string=>!!id&&organizations.has(id)&&!companies.has(id)))],addFields=ref.fields.filter(id=>accepted.has(id)&&!fields.has(id))
  const cost=row.bytes+kind.length+6+addUsers.reduce((n,id)=>n+users.get(id)!.bytes+10,0)+addCompanies.reduce((n,id)=>n+organizations.get(id)!.bytes+18,0)+addFields.reduce((n,id)=>n+fieldRows.get(id)!.bytes+18,0),count=1+addUsers.length+addCompanies.length+addFields.length
  if(chosen.length&&(bytes+cost>BATCH_BYTES||records+count>BATCH_RECORDS))break
  chosen.push({kind,id:row.source_id});addUsers.forEach(id=>people.add(id));addCompanies.forEach(id=>companies.add(id));addFields.forEach(id=>fields.add(id));bytes+=cost;records+=count
 }
 const of=(kind:StagedKind)=>chosen.filter(c=>c.kind===kind).map(c=>c.id)
 const [t,c,u,o,f]=await Promise.all([bodies(ctx,'ticket',of('ticket')),bodies(ctx,'ticket_comment',of('ticket_comment')),bodies(ctx,'user',[...people]),bodies(ctx,'organization',[...companies]),bodies(ctx,'ticket_field',[...fields])])
 const lines=[...[...companies].map(id=>`{"organization":${o.get(id)}}`),...[...fields].map(id=>`{"ticket_field":${f.get(id)}}`),...[...people].map(id=>`{"user":${u.get(id)}}`),...chosen.map(({kind,id})=>`{"${kind}":${(kind==='ticket'?t:c).get(id)}}`)]
 return {lines,primary:chosen,packed:{user:[...people],organization:[...companies],ticket_field:[...fields]},tickets:t}
}
/** After every ticket: people no ticket referenced (with their companies), then
 * companies, field definitions and articles, each kind in batches of its own. */
async function remainingBatch(ctx:PullContext,limit:number):Promise<Batch|null>{
 for(const kind of ['user','organization','ticket_field','article'] as StagedKind[]){
  const rows=await sized(ctx,kind,['ready'],undefined,Math.min(limit,1000));if(!rows.length)continue
  const organizations=kind==='user'?new Map((await sized(ctx,'organization',['ready','packed'],[...new Set(rows.map(r=>r.organization).filter((id):id is string=>!!id))])).map(o=>[o.source_id,o])):new Map<string,Row>()
  const chosen:string[]=[],companies=new Set<string>();let bytes=0
  for(const row of rows){
   const company=row.organization??null,add=company&&organizations.has(company)&&!companies.has(company)?[company]:[],cost=row.bytes+kind.length+6+add.reduce((n,id)=>n+organizations.get(id)!.bytes+18,0)
   if(chosen.length&&(bytes+cost>BATCH_BYTES||chosen.length+companies.size+add.length>=BATCH_RECORDS))break
   chosen.push(row.source_id);add.forEach(id=>companies.add(id));bytes+=cost
  }
  const [main,o]=await Promise.all([bodies(ctx,kind,chosen),bodies(ctx,'organization',[...companies])])
  return {lines:[...[...companies].map(id=>`{"organization":${o.get(id)}}`),...chosen.map(id=>`{"${kind}":${main.get(id)}}`)],primary:chosen.map(id=>({kind,id})),packed:{organization:[...companies]}}
 }
 return null
}
/** One batch per invocation enters Move in through the same admission as an
 * upload, once every staged record has settled against earlier imports. Packing is
 * deterministic, so a repeated step finds the same run; a batch identical to one
 * that stopped, was undone or was erased is admitted again as a new run. A batch
 * admission refuses is halved until the one record it names is refused by name. */
export async function packBatch(ctx:PullContext){
 if(!await settled(ctx))return
 const ordinal=Number(ctx.cursor.ordinal??0),limit=Number(ctx.cursor.limit??CANDIDATES)
 const batch=await ticketBatch(ctx,limit)??await remainingBatch(ctx,limit)
 if(!batch){await finishPacking(ctx);return}
 const bytes=await admissible(ctx,batch.lines)
 const result=await admitExport(ctx.env,{project_id:ctx.pull.project_id,actor_id:ctx.pull.actor_id,session_hash:ctx.pull.session_hash},'zendesk',`zendesk-pull-${ctx.pull.id.slice(0,8)}-${ordinal+1}.jsonl`,bytes,'zendesk-pull')
 if(result.status===200||result.status===201){
  const runId=String(result.body.data.id)
  ctx.statements.push(ctx.env.DB.prepare('INSERT INTO move_in_zendesk_pull_runs(pull_id,ordinal,run_id) VALUES(?,?,?) ON CONFLICT(pull_id,ordinal) DO NOTHING').bind(ctx.pull.id,ordinal,runId))
  const primary=[...new Set(batch.primary.map(p=>p.kind))].map(kind=>[kind,batch.primary.filter(p=>p.kind===kind).map(p=>p.id)])
  for(const [kind,list] of [...primary,...Object.entries(batch.packed)] as [StagedKind,string[]][])if(list?.length)ctx.statements.push(ctx.env.DB.prepare(`UPDATE move_in_zendesk_staged SET state='packed'${['ticket','ticket_comment','article'].includes(kind)?',record_json=NULL':''} WHERE pull_id=? AND kind=? AND source_id IN (SELECT value FROM json_each(?))`).bind(ctx.pull.id,kind,ids(list)))
  // Each packed ticket's own fields, so a later pull can tell a field change from new replies.
  if(batch.tickets?.size)ctx.statements.push(ctx.env.DB.prepare("INSERT OR REPLACE INTO move_in_zendesk_ticket_fields(project_id,source_id,fields_hash) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.hash') FROM json_each(?)").bind(ctx.pull.project_id,JSON.stringify([...batch.tickets].map(([id,body])=>({id,hash:ticketFieldsHash(JSON.parse(body))})))))
  ctx.cursor.ordinal=ordinal+1;delete ctx.cursor.limit
 }else if(result.status===422||result.status===410){
  if(batch.primary.length>1)ctx.cursor.limit=Math.max(1,Math.floor(batch.primary.length/2))
  else{refuse(ctx,batch.primary[0].kind,batch.primary[0].id,String(result.body?.diagnostic?.code??result.body?.code??'import_admission_refused'));delete ctx.cursor.limit}
 }else throw new ZendeskError('zendesk_batch_admission_failed',result.status)
 ctx.more=true
}
/** The same bytes as an earlier run return that run while it can still carry them:
 * one ready for review, applying or completed, or this step repeated finding its own
 * batch still being admitted or prepared under this pull's session, without a stop.
 * Any other earlier run (stopped, undone, erased, or left in preparation by another
 * session) is admitted again as a new run: a trailing blank line, which the reader
 * skips, makes it a new file with the same records. */
const CARRIES=['ready','applying','completed'],PREPARING=['uploading','uploaded','parsing','planning']
async function admissible(ctx:PullContext,lines:string[]){
 for(let blank=0;blank<READMISSIONS;blank++){
  const bytes=new TextEncoder().encode(lines.join('\n')+'\n'+'\n'.repeat(blank))
  const prior=await ctx.env.DB.prepare("SELECT state,error,session_hash FROM move_in_runs WHERE project_id=? AND vendor='zendesk' AND artifact_hash=?").bind(ctx.pull.project_id,sha256(bytes)).first<{state:string;error:string|null;session_hash:string}>()
  if(!prior||CARRIES.includes(prior.state)||!prior.error&&PREPARING.includes(prior.state)&&prior.session_hash===ctx.pull.session_hash)return bytes
 }
 throw new ZendeskError('zendesk_batch_readmission_limit')
}
/** Every source record is now held by a run's private custody; staged copies go. */
async function finishPacking(ctx:PullContext){
 const rows=(await ctx.env.DB.prepare('SELECT kind,state,COUNT(*) n FROM move_in_zendesk_staged WHERE pull_id=? GROUP BY kind,state').bind(ctx.pull.id).all<{kind:string;state:string;n:number}>()).results
 const n=(kind:string,...states:string[])=>rows.filter(row=>row.kind===kind&&(!states.length||states.includes(row.state))).reduce((sum,row)=>sum+row.n,0)
 const refused=(await ctx.env.DB.prepare('SELECT kind,COUNT(*) n FROM move_in_zendesk_refusals WHERE pull_id=? GROUP BY kind').bind(ctx.pull.id).all<{kind:string;n:number}>()).results,r=(kind:string)=>refused.find(row=>row.kind===kind)?.n??0
 ctx.counts.source={tickets:n('ticket')+r('ticket'),deleted:n('ticket','deleted'),replies:n('ticket_comment')+r('ticket_comment'),users:n('user','packed','ready')+r('user'),missingUsers:n('user','missing'),organizations:n('organization','packed','ready')+r('organization'),ticketFields:n('ticket_field')+r('ticket_field'),articles:n('article')+r('article')}
 ctx.statements.push(ctx.env.DB.prepare('DELETE FROM move_in_zendesk_staged WHERE pull_id=?').bind(ctx.pull.id))
 ctx.patch.resume_json=JSON.stringify(ctx.resume);ctx.state='reviewing';ctx.phase='review';ctx.cursor={}
}
