import {fetchApiPage} from './api-fetch'
import {apiCheckpoint} from './api-lifecycle'
import type { Env } from '../../platform/env'
import {requireAuditedCustody} from './legacy-identities'
import {putPrivate} from './private-custody'
import { sha256 } from '../import-kit/src/d1/index'
import { archiveChunk } from './readers/archive'
import { parseFile,indexFile } from './readers/records'
import { assertAuthority } from './context'
import {approveReview,advanceBatch} from './batches'
import { LIMITS,type Run } from './types'
import {getRun,getWorkRun,objectKey,updateRun} from './run-store'
import {preparePlan} from './plan'
export {getRun,getWorkRun} from './run-store'
export async function enqueue(env:Env,run:Run){await env.JOBS.send({type:'move-in',id:run.id,projectId:run.project_id})}
async function unpack(env:Env,run:Run){const original=await env.FILES.get(run.object_key);if(!original)throw new Error('original_upload_missing');const chunk=await archiveChunk(run.filename,new Uint8Array(await original.arrayBuffer()),run.cursor),files=chunk.files,descriptors=JSON.parse(run.files_json),written:string[]=[]
 for(let i=0;i<files.length;i++){const file=files[i],key=objectKey(run,`files/${run.cursor+i}`);await putPrivate(env,run,key,file.bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{projectId:run.project_id,runId:run.id}});written.push(key);const index=indexFile(file,run.vendor);if(index.length+descriptors.reduce((n:number,f:any)=>n+(f.index?.length||0),0)>LIMITS.records)throw new Error('export_record_limit');descriptors.push({name:file.name,key,sha256:sha256(file.bytes),size:file.bytes.length,index})}
 try{await updateRun(env,run,{state:chunk.done?'parsing':'uploaded',files_json:JSON.stringify(descriptors),file_index:0,cursor:chunk.done?0:chunk.next})}catch(error){const current=await getRun(env,run.id),retained=new Set((JSON.parse(current?.files_json||'[]') as {key:string}[]).map(file=>file.key));for(const key of written)if(!retained.has(key))await env.FILES.delete(key);throw error}
}
async function parseChunk(env:Env,run:Run){const files=JSON.parse(run.files_json),file=files[run.file_index];if(!file){await updateRun(env,run,{state:'planning',cursor:0});return}
 const object=await env.FILES.get(file.key);if(!object)throw new Error('source_file_missing');const bytes=new Uint8Array(await object.arrayBuffer());if(sha256(bytes)!==file.sha256)throw new Error('source_file_changed')
 const chunk=[...parseFile({name:file.name,bytes},run.vendor,run.cursor,LIMITS.parseBatch,file.index)],statements:D1PreparedStatement[]=[],diagnostics=JSON.parse(run.diagnostics_json)
 for(const item of chunk){if(item.diagnostic)diagnostics.push(item.record?item.diagnostic:{...item.diagnostic,kind:'invalid-record'});if(item.record)statements.push(env.DB.prepare('INSERT INTO move_in_records(run_id,ordinal,record_json,serialized) VALUES(?,?,?,?)').bind(run.id,run.parsed_total+statements.length,JSON.stringify(item.record),(item as any).serialized))}
 if(run.parsed_total+statements.length>LIMITS.records)throw new Error('export_record_limit')
 await updateRun(env,run,{cursor:chunk.length===LIMITS.parseBatch?run.cursor+chunk.length:0,file_index:chunk.length===LIMITS.parseBatch?run.file_index:run.file_index+1,parsed_total:run.parsed_total+statements.length,diagnostics_json:JSON.stringify(diagnostics)},statements)
}
export async function approve(env:Env,run:Run,fingerprint:string){await requireAuditedCustody(env,run);await approveReview(env,run,fingerprint);await enqueue(env,run)}
export async function advanceImport(env:Env,run:Run){await assertAuthority(env,run);if(run.error||!['fetching','uploaded','parsing','planning','applying','undoing'].includes(run.state))return
 try{await requireAuditedCustody(env,run);if(run.state==='fetching')await fetchApiPage(env,run);else if(run.state==='uploaded')await unpack(env,run);else if(run.state==='parsing')await parseChunk(env,run);else if(run.state==='planning')await preparePlan(env,run);else await advanceBatch(env,run)}catch(error){const code=error instanceof Error?error.message:'import_failed';await assertAuthority(env,run);await updateRun(env,run,{error:code.startsWith('D1_')?'Import database operation failed':code.slice(0,200)});return}
 await apiCheckpoint(env,run)
 const current=await getWorkRun(env,run.id);if(current&&!current.error&&['fetching','uploaded','parsing','planning','applying','undoing'].includes(current.state))await enqueue(env,current)
}
