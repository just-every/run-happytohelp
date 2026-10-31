import type {Env} from '../../platform/env'
import type {Readers} from './door'
import {searchKnowledge} from './service'
import {readKnowledgeSource,safePublicUrl,type PublicReference} from './public-sources'
import {createBlocks} from './reference-store'
// @ts-ignore Retained bounded history formatting; chunk source bytes before pinning.
import {fullHistoryEntryChunk} from '../ai-support/assist/historyOutput.js'

interface SourceFields extends PublicReference {title:string;url:string;content?:string}
/** Even a one-word title or short URL must carry source authority. These fields
 * never rely on copied-run detection, and stored tool history keeps only tokens. */
async function pinSourceFields(env:Env,projectId:string,sources:SourceFields[]){
 const output=sources.map(source=>({...source})),blocks:Parameters<typeof createBlocks>[2]=[]
 const fields:Array<{index:number;field:'content'|'title'|'url'}>=[]
 for(const [index,source] of sources.entries())for(const field of ['content','title','url'] as const){
  const value=source[field]
  if(value===undefined)continue
  fields.push({index,field})
  blocks.push({kind:'text',text:value,title:source.title,url:source.url,sources:[source.id]})
 }
 const tokens=await createBlocks(env,projectId,blocks)
 for(const [index,{index:sourceIndex,field}] of fields.entries())output[sourceIndex][field]=tokens[index]
 return output
}
export async function searchKnowledgeToolSources(env:Env,projectId:string,query:string,readers:Readers){
 const rows=await searchKnowledge(env,projectId,query,readers)
 // Select metadata explicitly: raw slug or future retrieval fields cannot escape
 // via an object spread from the source repository.
 const pinned=await pinSourceFields(env,projectId,rows.map(row=>({id:row.id,sourceVersion:row.sourceVersion,title:row.title,url:row.url,content:row.content})))
 return pinned.map((row,index)=>({...row,score:rows[index].score,evidence_id:row.id,citation_allowed:Boolean(safePublicUrl(rows[index].url))}))
}
export async function readKnowledgeToolSource(env:Env,projectId:string,ref:PublicReference,readers:Readers,startOffset:number){
 const row=await readKnowledgeSource(env,projectId,ref,readers)
 if(!row)return {found:false}
 const chunk=fullHistoryEntryChunk({...row,kind:'message',evidence_id:ref.id},{startOffset})
 const [pinned]=await pinSourceFields(env,projectId,[{id:ref.id,sourceVersion:row.sourceVersion,title:row.title,url:row.url,content:chunk.content}])
 // Offsets and budgets describe the source chunk, not the opaque token length.
 return {...chunk,content:pinned.content,title:pinned.title,url:pinned.url,sourceVersion:pinned.sourceVersion}
}
export async function citeKnowledgeToolSources(env:Env,projectId:string,refs:PublicReference[],readers:Readers){
 const sources:SourceFields[]=[]
 for(const ref of refs){
  const row=await readKnowledgeSource(env,projectId,ref,readers)
  if(!row||!safePublicUrl(row.url))throw new Error('Stale or unsafe public citation')
  sources.push({id:ref.id,sourceVersion:ref.sourceVersion,title:row.title,url:row.url})
 }
 return pinSourceFields(env,projectId,sources)
}
