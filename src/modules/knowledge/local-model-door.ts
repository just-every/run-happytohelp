import type {Env} from '../../platform/env'
import {canonicaliseFields} from './canonicaliser'
import {modelKnowledgeInput,knowledgeAnswer} from './model-door'
import {currentTicketReaders} from './readers'
import {generationSources} from './generation-sources'
import {createBlocks,tokenPattern,unavailableKnowledge} from './reference-store'

interface LocalJob {id:string;project_id:string;conversation_id:string}

/** Snapshots persisted by the native connector keep references. Only an actual
 * device response becomes a model projection, against today's ticket readers. */
export const protectLocalModelFields=<T>(env:Env,job:LocalJob,value:T)=>canonicaliseFields(env,job.project_id,value)

export async function discloseLocalModelFields<T>(env:Env,job:LocalJob|undefined|null,value:T):Promise<T>{
 if(!job)return value
 return await modelKnowledgeInput(env,job.project_id,value,currentTicketReaders(job.project_id,job.conversation_id,{}),'local:'+job.id) as T
}

/** Device metadata has no ticket authority of its own. An all-workspace device
 * may serve several projects; never borrow one active job's audience for it. */
export async function discloseLocalDeviceFields<T>(env:Env,value:T):Promise<T>{
 const protectedValue=await canonicaliseFields(env,undefined,value)
 const neutral=(item:any):any=>typeof item==='string'?item.replace(tokenPattern,unavailableKnowledge):Array.isArray(item)?item.map(neutral):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).filter(([key])=>key!=='knowledge_provenance').map(([key,entry])=>[key.replace(tokenPattern,unavailableKnowledge),neutral(entry)])):item
 return neutral(protectedValue)
}

/** Call only after the local result schema, cancellation and attachment checks.
 * IDs, authority modes and verified flags remain operational data. */
export async function protectLocalModelResult<T>(env:Env,job:LocalJob,value:T):Promise<T>{
 const result:any=await protectLocalModelFields(env,job,value),generationId='local:'+job.id,sources=await generationSources(env,job.project_id,generationId)
 if(!sources.length)return result
 const leaves:{path:(string|number)[];text:string}[]=[]
 const operational=(path:(string|number)[])=>path[0]==='attachment_ids'||['replies','follow_up_actions'].includes(String(path[0]))&&path.length>=3&&['id','attachment_ids',...(path[0]==='follow_up_actions'?['mode']:[])].includes(String(path[2]))||path[0]==='provider_error'&&path[1]==='provider'
 const visit=(item:any,path:(string|number)[])=>{
  if(operational(path))return
  if(typeof item==='string'){if(item)leaves.push({path,text:item});return}
  if(Array.isArray(item)){item.forEach((entry,index)=>visit(entry,[...path,index]));return}
  if(item&&typeof item==='object')for(const [key,entry] of Object.entries(item))if(key!=='knowledge_provenance')visit(entry,[...path,key])
 }
 visit(result,[])
 const tokens=await createBlocks(env,job.project_id,[...leaves.map(leaf=>({kind:'answer' as const,text:leaf.text,sources,generationId})),{kind:'answer',text:'',sources,generationId}])
 for(const [index,leaf] of leaves.entries()){let target=result;for(const key of leaf.path.slice(0,-1))target=target[key];target[leaf.path.at(-1)!]=tokens[index]}
 result.knowledge_provenance=tokens.at(-1)
 return result
}

export async function protectLocalModelProgress(env:Env,job:LocalJob,message:string){
 const protectedMessage=await protectLocalModelFields(env,job,message)
 return protectedMessage?knowledgeAnswer(env,job.project_id,'local:'+job.id,protectedMessage):protectedMessage
}
