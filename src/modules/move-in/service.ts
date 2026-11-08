import type { Env } from '../../platform/env'
import {requireAuditedCustody} from './legacy-identities'
import {putPrivate} from './private-custody'
import { sha256 } from '../import-kit/src/d1/index'
import { archiveChunk } from './readers/archive'
import { parseFile,indexFile,type RecordPosition } from './readers/records'
import { assertAuthority } from './context'
import {approveReview,advanceBatch} from './batches'
import { LIMITS,runLimits,type Run } from './types'
import {failRun,getRun,getWorkRun,objectKey,touchRun,updateRun} from './run-store'
import {preparePlan} from './plan'
import {notifyPull} from './zendesk-source/notify'
export {getRun,getWorkRun} from './run-store'
export async function enqueue(env:Env,run:Run,delaySeconds=0){const message={type:'move-in',id:run.id,projectId:run.project_id};if(delaySeconds>0)await env.JOBS.send(message,{delaySeconds});else await env.JOBS.send(message)}
async function unpack(env:Env,run:Run){const original=await env.FILES.get(run.object_key);if(!original)throw new Error('original_upload_missing');const chunk=await archiveChunk(run.filename,new Uint8Array(await original.arrayBuffer()),run.cursor),files=chunk.files,descriptors=JSON.parse(run.files_json),written:string[]=[]
 for(let i=0;i<files.length;i++){const file=files[i],key=objectKey(run,`files/${run.cursor+i}`);await putPrivate(env,run,key,file.bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{projectId:run.project_id,runId:run.id}});written.push(key);const index=indexFile(file,run.vendor);if(index.length+descriptors.reduce((n:number,f:any)=>n+(f.index?.length||0),0)>LIMITS.records)throw new Error('export_record_limit');descriptors.push({name:file.name,key,sha256:sha256(file.bytes),size:file.bytes.length,index})}
 try{await updateRun(env,run,{state:chunk.done?'parsing':'uploaded',files_json:JSON.stringify(descriptors),file_index:0,cursor:chunk.done?0:chunk.next})}catch(error){const current=await getRun(env,run.id),retained=new Set((JSON.parse(current?.files_json||'[]') as {key:string}[]).map(file=>file.key));for(const key of written)if(!retained.has(key))await env.FILES.delete(key);throw error}
}
/** Exhaust the parser into durable bindings before the awaited write. The full
 * file buffer and parsed payloads have no owner in the checkpoint operation. */
async function parsedStatements(env:Env,run:Run,file:{key:string;name:string;sha256:string;index:RecordPosition[]}){
 const object=await env.FILES.get(file.key);if(!object)throw new Error('source_file_missing');const bytes=new Uint8Array(await object.arrayBuffer());if(sha256(bytes)!==file.sha256)throw new Error('source_file_changed')
 const statements:D1PreparedStatement[]=[],diagnostics=JSON.parse(run.diagnostics_json);let consumed=0
 for(const item of parseFile({name:file.name,bytes},run.vendor,run.cursor,LIMITS.parseBatch,file.index,runLimits(run).recordBytes)){consumed++;if(item.diagnostic)diagnostics.push(item.record?item.diagnostic:{...item.diagnostic,kind:'invalid-record'});if(item.record)statements.push(env.DB.prepare('INSERT INTO move_in_records(run_id,ordinal,record_json,serialized) VALUES(?,?,?,?)').bind(run.id,run.parsed_total+statements.length,JSON.stringify(item.record),item.serialized))}
 return {statements,diagnostics,consumed}
}
async function parseChunk(env:Env,run:Run){const files=JSON.parse(run.files_json),file=files[run.file_index];if(!file){await updateRun(env,run,{state:'planning',cursor:0});return}
 const {statements,diagnostics,consumed}=await parsedStatements(env,run,file)
 if(run.parsed_total+statements.length>LIMITS.records)throw new Error('export_record_limit')
 await updateRun(env,run,{cursor:consumed===LIMITS.parseBatch?run.cursor+consumed:0,file_index:consumed===LIMITS.parseBatch?run.file_index:run.file_index+1,parsed_total:run.parsed_total+statements.length,diagnostics_json:JSON.stringify(diagnostics)},statements)
}
export async function approve(env:Env,run:Run,fingerprint:string){await requireAuditedCustody(env,run);await approveReview(env,run,fingerprint);await enqueue(env,run)}
/** A pulled batch whose step cannot run at all (its reviewer's session ended, say)
 * also hands control back to its pull, which then stops and names the reason. */
export async function advanceImport(env:Env,run:Run){try{await advance(env,run)}catch(error){await notifyPull(env,run);throw error}}
const WORKING=['uploaded','parsing','planning','applying','undoing']
/** A conditional private-custody write that found another delivery's bytes at its key.
 * That delivery moves the run on or stops it, unless this one started after it (it then
 * leaves the run to this one): the step is then delivered again after a pause long
 * enough for it to finish, and that delivery ends quietly if the run has moved on. */
const LOST_RACE=['source_custody_race','source_custody_erased'],RACE_RETRY_SECONDS=60
/** One step per queue message. A message can arrive more than once (a queue retry, or
 * Resume handing on a run whose message looked lost); a duplicate delivery ends quietly
 * once another has started the same step, moved the run on or holds its custody writes,
 * so the run advances once and is never stopped by the loser. */
async function advance(env:Env,read:Run){await assertAuthority(env,read);if(read.error||!WORKING.includes(read.state))return
 let run=read
 try{await requireAuditedCustody(env,read);const touched=await touchRun(env,read);if(!touched)return;run=touched;if(run.state==='uploaded')await unpack(env,run);else if(run.state==='parsing')await parseChunk(env,run);else if(run.state==='planning')await preparePlan(env,run);else await advanceBatch(env,run)}catch(error){const code=error instanceof Error?error.message:'import_failed';if(LOST_RACE.includes(code)){const current=await getWorkRun(env,run.id);if(current&&!current.error&&current.state===run.state&&current.cursor===run.cursor&&current.updated_at===run.updated_at)await enqueue(env,current,RACE_RETRY_SECONDS);return}await assertAuthority(env,run);if(await failRun(env,run,code.startsWith('D1_')?'Import database operation failed':code.slice(0,200)))await notifyPull(env,run);return}
 const current=await getWorkRun(env,run.id);if(current&&!current.error&&WORKING.includes(current.state))await enqueue(env,current);else await notifyPull(env,current??run)
}
