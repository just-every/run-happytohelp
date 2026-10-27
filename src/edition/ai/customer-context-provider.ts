import {requireActiveProject} from '../../platform/project-status'
import {assertModelConfigured} from '../../modules/ai-support/configuration'
import type { Env } from '../../platform/env'
import {referenceResult} from '../../modules/knowledge/result-fields'
import {canonicaliseFields} from '../../modules/knowledge/canonicaliser'
import {modelReadTools} from '../../modules/knowledge/model-tools'
// @ts-ignore Retained Worker-compatible orchestration module.
import { runStream } from '../../modules/ai-support/llm/orchestrator.js'
// @ts-ignore Request-local provider/storage context.
import { withWorkerRuntime } from '../../modules/ai-support/vendor/ensemble/worker-runtime.js'
export async function requestContextModel(env:Env,job:any,task:string,request:any){
 await requireActiveProject(env,job.project_id)
 assertModelConfigured(env,job.model)
 const record=async(kind:string,payload:unknown)=>env.DB.prepare('INSERT INTO context_job_events(job_id,kind,payload,created_at) VALUES(?,?,?,?)').bind(job.id,kind,JSON.stringify(await referenceResult(env,job.project_id,'context:'+job.id,await canonicaliseFields(env,job.project_id,payload),'trace')),Date.now()).run()
 const tools=await modelReadTools(env,job.project_id,'context',job.id,request.packet)
 const messages=[{role:'developer',content:'Knowledge references in the packet are title/link pointers. If exact source words are needed, search_knowledge then read_knowledge_source. Use the supplied packet evidence_id for claims, never invent one. A title or URL alone does not establish source facts.'},...request.messages]
 const result=await withWorkerRuntime({apiKey:env.OPENAI_API_KEY,files:env.FILES,scope:`projects/${job.project_id}/context/${job.id}`,settings:env},()=>runStream({project_id:job.project_id,task,messages,schema:request.schema,response_name:`context_${task}`,tools,options:{model:job.model,maxToolCalls:4,maxToolCallRoundsPerTurn:4},trace:{onEvent:async(event:any)=>{if(event.type==='agent_start')await env.DB.prepare('UPDATE context_jobs SET provider_started=1 WHERE id=?').bind(job.id).run();await record(event.type,event)},onUsage:async(usage:unknown)=>record('usage',usage)}}))
 return request.schema.parse(result)
}
