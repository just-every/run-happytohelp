import type {Env} from '../../platform/env'
import {anonymousReaders,memberReaders,readerSet,type Readers} from './door'
import {currentTicketReaders} from './readers'
import {canonicaliseFields} from './canonicaliser'
import {renderKnowledgeFields,createBlocks} from './reference-store'
import {generationKey,generationSources,recordModelSources} from './generation-sources'
import {referenceResult} from './result-fields'

export async function generationReaders(env:Env,projectId:string,generationId:string|undefined,conversationId?:string):Promise<Readers>{
 if(generationId){const row=await env.DB.prepare('SELECT conversation_id FROM ai_generations WHERE project_id=? AND id=?').bind(projectId,generationId).first<{conversation_id:string}>();conversationId=row?.conversation_id||conversationId}
 return conversationId?currentTicketReaders(projectId,conversationId,{}):anonymousReaders
}
export async function modelKnowledgeInput(env:Env,projectId:string,value:unknown,readers:Readers,generationId?:string){
 const normalized=await canonicaliseFields(env,projectId,value)
 if(generationId)await recordModelSources(env,projectId,generationId,normalized,readers)
 return renderKnowledgeFields(env,projectId,normalized,readers,'model')
}
export async function scopedGenerationReaders(env:Env,projectId:string,family:string,attempt:string):Promise<Readers>{
 let conversationId:string|undefined
  if(family==='triage')conversationId=(await env.DB.prepare('SELECT conversation_id FROM triage_jobs WHERE id=? AND project_id=?').bind(attempt,projectId).first<{conversation_id:string}>())?.conversation_id
  let readers=await generationReaders(env,projectId,family==='generations'?attempt:undefined,conversationId)
  if(family==='context'){
   const job=await env.DB.prepare('SELECT kind,subject_id FROM context_jobs WHERE id=? AND project_id=?').bind(attempt,projectId).first<{kind:string;subject_id:string}>()
   if(!job)throw new Error('KNOWLEDGE_CONTEXT_GENERATION_REQUIRED')
   if(['contact','monitoring','optimizeContact'].includes(job.kind))readers=readerSet([{kind:'contact',id:job.subject_id}])
   else if(job.kind==='agent')readers=memberReaders(job.subject_id)
  }
  if(family==='training'){
   const run=await env.DB.prepare('SELECT r.operator_id FROM training_cases c JOIN training_runs r ON r.id=c.run_id WHERE c.attempt_id=? AND r.project_id=?').bind(attempt,projectId).first<{operator_id:string}>()
   if(!run)throw new Error('KNOWLEDGE_TRAINING_GENERATION_REQUIRED')
   readers=memberReaders(run.operator_id)
  }
 return readers
}
/** Called for every provider round. Stored prompts, context, tool continuations
 * and model-written history all pass here immediately before dispatch. */
export function knowledgeModelProvider<T extends {createResponseStream:Function}>(provider:T,runtime:{settings?:Env;scope?:string}):T{
 const wrapper=Object.create(provider)
 wrapper.createResponseStream=async function*(messages:any,model:any,agent:any,requestId:any){
  const env=runtime.settings,parts=runtime.scope?.split('/'),projectId=parts?.[1]
  if(!env||!projectId)throw new Error('KNOWLEDGE_MODEL_AUDIENCE_REQUIRED')
  const family=parts?.[2],attempt=parts?.[3]
  if(!family||!attempt)throw new Error('KNOWLEDGE_MODEL_GENERATION_REQUIRED')
  const generationId=generationKey(family,attempt)
  const readers=await scopedGenerationReaders(env,projectId,family,attempt)
  const input=await Promise.all(messages.map(async(message:any)=>{if(generationId&&message.type==='function_call_output'&&['search_knowledge','read_knowledge_source'].includes(message.name)){const normalized=await canonicaliseFields(env,projectId,message);await modelKnowledgeInput(env,projectId,normalized,readers,generationId);return renderKnowledgeFields(env,projectId,normalized,readers,'body')}return modelKnowledgeInput(env,projectId,message,readers,generationId)}))
  yield* provider.createResponseStream(input,model,agent,requestId)
 }
 return wrapper
}
export async function knowledgeAnswer(env:Env,projectId:string,generationId:string,text:string){
 const sources=await generationSources(env,projectId,generationId)
 if(!sources.length)return text
 const [token]=await createBlocks(env,projectId,[{kind:'answer',text,sources,generationId}]);return token
}
export async function knowledgeAnswerFields(env:Env,projectId:string,generationId:string,value:any):Promise<any>{
 return referenceResult(env,projectId,generationId,value,'support')
}
