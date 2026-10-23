import {localResultFrontier} from '../local-computer/result-frontier'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
export type Authoring = {kind:'human'}|{kind:'ai';generationId:string;selection?:number}|{kind:'local';jobId:string;proposalId:string|null}
export interface Authorship {kind:'visitor'|'human'|'ai'|'assisted'|'unknown';sourceKind:string|null;sourceId:string|null;sourcePart:string|null;guard?:{sql:string;params:unknown[]}}
/** A draft's content may be edited after adoption. Its source is still checked
 * against the stored completed proposal, tenant and live operator authority. */
export async function authoringSource(env:Env,actor:Actor,conversationId:string,source:Authoring|undefined,generationId?:string):Promise<Authorship>{
 if(generationId)return {kind:'ai',sourceKind:'generation',sourceId:generationId,sourcePart:null}
 if(actor.role==='contact'){if(source!==undefined)throw new HTTPException(403,{message:'Visitors cannot set reply authorship'});return {kind:'visitor',sourceKind:null,sourceId:null,sourcePart:null}}
 if(source===undefined)return {kind:'unknown',sourceKind:null,sourceId:null,sourcePart:null}
 if(!source||typeof source!=='object')throw new HTTPException(400,{message:'Invalid reply authorship'})
 if(source.kind==='human')return {kind:'human',sourceKind:'composer',sourceId:actor.id,sourcePart:null}
 if(source.kind==='ai'){
  if(typeof source.generationId!=='string'||source.generationId.length>200||source.selection!==undefined&&(!Number.isSafeInteger(source.selection)||source.selection<0))throw new HTTPException(400,{message:'Invalid draft source'})
  const row=await env.DB.prepare("SELECT output_json FROM ai_generations WHERE id=? AND project_id=? AND conversation_id=? AND kind='suggestions' AND state='completed'").bind(source.generationId,actor.projectId,conversationId).first<{output_json:string}>();if(!row)throw new HTTPException(409,{message:'Draft source unavailable'})
  const result=JSON.parse(row.output_json).result,proposal=source.selection===undefined?result?.response:result?.responses?.[source.selection]?.response;if(typeof proposal!=='string'||!proposal.trim())throw new HTTPException(409,{message:'Draft proposal unavailable'})
  return {kind:'assisted',sourceKind:'ai-draft',sourceId:source.generationId,sourcePart:source.selection===undefined?'response':String(source.selection),guard:{sql:"EXISTS(SELECT 1 FROM ai_generations g WHERE g.id=? AND g.project_id=c.project_id AND g.conversation_id=c.id AND g.kind='suggestions' AND g.state='completed' AND g.output_json=?)",params:[source.generationId,row.output_json]}}
 }
 if(source.kind==='local'){
  if(typeof source.jobId!=='string'||source.jobId.length>200||source.proposalId!==null&&(typeof source.proposalId!=='string'||source.proposalId.length>200))throw new HTTPException(400,{message:'Invalid draft source'})
  const sql="SELECT j.result FROM local_jobs j JOIN local_devices d ON d.id=j.device_id AND d.user_id=j.operator_id WHERE j.id=? AND j.project_id=? AND j.conversation_id=? AND j.operator_id=? AND j.status='completed' AND j.cancel_requested=0 AND d.revoked_at IS NULL AND (d.project_id IS NULL OR d.project_id=j.project_id) AND (d.grant_id IS NULL OR EXISTS(SELECT 1 FROM local_grants g WHERE g.id=d.grant_id AND g.user_id=j.operator_id AND (g.project_id IS NULL OR g.project_id=j.project_id) AND g.revoked_at IS NULL))"
  const liveSql=sql+` AND ${localResultFrontier}`
  const params=[source.jobId,actor.projectId,conversationId,actor.id],row=await env.DB.prepare(liveSql).bind(...params).first<{result:string}>();if(!row)throw new HTTPException(409,{message:'Draft source unavailable'});const result=JSON.parse(row.result),proposal=source.proposalId===null?result.reply_draft:result.replies?.find((p:any)=>p.id===source.proposalId)?.body;if(typeof proposal!=='string'||!proposal.trim())throw new HTTPException(409,{message:'Draft proposal unavailable'})
  return {kind:'assisted',sourceKind:'local-draft',sourceId:source.jobId,sourcePart:source.proposalId??'legacy',guard:{sql:`EXISTS(${liveSql} AND j.result=?)`,params:[...params,row.result]}}
 }
 throw new HTTPException(400,{message:'Invalid reply authorship'})
}
export function authorshipStatement(env:Env,messageId:string,source:Authorship,now:number){return env.DB.prepare('INSERT INTO message_authorship(message_id,project_id,kind,source_kind,source_id,source_part,recorded_at) SELECT id,project_id,?,?,?,?,? FROM messages WHERE id=?').bind(source.kind,source.sourceKind,source.sourceId,source.sourcePart,now,messageId)}
