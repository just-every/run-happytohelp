import type {Env} from '../../platform/env'
import {createBlocks} from './reference-store'
import {generationSources} from './generation-sources'

export type ResultFamily='support'|'profile'|'monitoring'|'triage'|'training'|'trace'
const profileNarrative=new Set(['describe','short_name','legal_name','brand_personality','personality','common_greetings','common_sign_off','uniqueness','upcoming_events','problem','solutions_needed','job','role'])
const narrative=new Set(['response','content','text','button','use_when','user_goal','missing_information','summary','help','loading','quote','description','evidence','reply_draft','question','instructions','title','input','thinking_content','reasoning_content'])
const narrativeChecks=new Set(['must_include_any_per_reply','must_include_all_per_reply','must_not_include_per_reply','private_note_disclosure_per_reply','language_es_per_reply','possible_unobserved_completion_claim','possible_language_mismatch','operator_owns_next_step','bot_rehandoff','selected_ai_as_sender','assumed_human_name','downstream_specialist'])

/** Schemas, grounding and operational decisions consume the original typed
 * object. Only narrative leaves change representation at persistence. */
export async function referenceResult<T>(env:Env,projectId:string,generationId:string,value:T,family:ResultFamily,profileType?:string):Promise<T>{
 const sources=await generationSources(env,projectId,generationId)
 if(!sources.length)return value
 const leaves:{path:(string|number)[];text:string}[]=[]
 const visit=(item:any,path:(string|number)[],selected=false)=>{
  if(typeof item==='string'){if(selected&&item)leaves.push({path,text:item});return}
  if(Array.isArray(item)){item.forEach((entry,index)=>visit(entry,[...path,index],selected));return}
  if(item&&typeof item==='object')for(const [key,entry] of Object.entries(item)){
   if(key==='knowledge_provenance')continue
   const parent=String(path.at(-1)||'')
   const profileValue=key==='value'&&profileNarrative.has(parent)&&!(profileType==='contact'&&parent==='personality')
   const checkNarrative=family==='training'&&narrativeChecks.has(item.check)&&['actual','expected'].includes(key)
   const pick=family==='profile'?(profileValue||key==='text'):family==='triage'?key==='quote':narrative.has(key)||(key==='output'&&typeof entry==='string')||family==='training'&&(profileValue||checkNarrative)||['training','trace'].includes(family)&&['arguments','error','message'].includes(key)
   visit(entry,[...path,key],pick)
  }
 }
 visit(value,[],typeof value==='string')
 const tokens=await createBlocks(env,projectId,[...leaves.map(leaf=>({kind:'answer' as const,text:leaf.text,sources,generationId})),{kind:'answer',text:'',sources,generationId}])
 const result=structuredClone(value) as any
 if(typeof result==='string')return (tokens[0]||result) as T
 for(const [index,leaf] of leaves.entries()){let target=result;for(const key of leaf.path.slice(0,-1))target=target[key];target[leaf.path.at(-1)!]=tokens[index]}
 if(result&&typeof result==='object'&&!Array.isArray(result))result.knowledge_provenance=tokens.at(-1)
 return result
}
