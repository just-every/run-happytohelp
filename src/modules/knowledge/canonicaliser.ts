import type {Env} from '../../platform/env'
import {createBlocks} from './reference-store'
import {knowledgeWords,wordShingles,shingleHash} from './words'

/** Source writes leave a durable dirty row in the same SQL transaction. No
 * request cache can hide an edit from the next write. The append-only index also
 * remembers earlier publications after an article is edited or deleted. */
export async function updateKnowledgeIndex(env:Env,projectId:string,limit=2000){
 const dirty=await env.DB.prepare('SELECT source_id,stamp FROM knowledge_index_dirty WHERE project_id=? LIMIT ?').bind(projectId,limit).all<{source_id:string;stamp:string}>()
 if(!dirty.results.length)return true
 for(let offset=0;offset<dirty.results.length;offset+=20){
  const page=dirty.results.slice(offset,offset+20),ids=page.map(row=>row.source_id),selected=JSON.stringify(ids)
  const rows=await env.DB.prepare(`SELECT * FROM (SELECT 'article:'||a.id source_id,'current:'||a.publication_version version,a.title||'\n'||a.content||'\n'||a.summary content FROM knowledge_articles a WHERE a.project_id=?1 AND a.status='published' AND 'article:'||a.id IN (SELECT value FROM json_each(?2))
   UNION ALL SELECT 'article:'||p.article_id,'publication:'||p.source_version,json_extract(p.snapshot_json,'$.title')||char(10)||json_extract(p.snapshot_json,'$.content')||char(10)||coalesce(json_extract(p.snapshot_json,'$.summary'),'') FROM knowledge_article_publications p WHERE p.project_id=?1 AND 'article:'||p.article_id IN (SELECT value FROM json_each(?2))
   UNION ALL SELECT 'article:'||h.article_id,'history:'||h.id,json_extract(h.snapshot_json,'$.title')||'\n'||json_extract(h.snapshot_json,'$.content')||'\n'||coalesce(json_extract(h.snapshot_json,'$.summary'),'') FROM knowledge_article_history h WHERE h.project_id=?1 AND json_extract(h.snapshot_json,'$.status')='published' AND 'article:'||h.article_id IN (SELECT value FROM json_each(?2))
   UNION ALL SELECT 'article:'||a.id,'translation:'||t.locale||':'||t.published_source_version,json_extract(t.published_json,'$.title')||'\n'||json_extract(t.published_json,'$.content')||'\n'||coalesce(json_extract(t.published_json,'$.summary'),'') FROM knowledge_translations t JOIN knowledge_articles a ON a.id=t.article_id WHERE a.project_id=?1 AND t.published_json IS NOT NULL AND 'article:'||a.id IN (SELECT value FROM json_each(?2))
   UNION ALL SELECT 'article:'||p.article_id,'translation-publication:'||p.id,json_extract(p.snapshot_json,'$.title')||char(10)||json_extract(p.snapshot_json,'$.content')||char(10)||coalesce(json_extract(p.snapshot_json,'$.summary'),'') FROM knowledge_translation_publications p WHERE p.project_id=?1 AND 'article:'||p.article_id IN (SELECT value FROM json_each(?2))
   ) UNION ALL SELECT * FROM (SELECT 'knowledge:'||f.id,f.version_id,f.title||'\n'||f.content FROM knowledge_documents f JOIN knowledge_versions v ON v.id=f.version_id JOIN knowledge_datasets d ON d.id=v.dataset_id WHERE d.project_id=?1 AND 'knowledge:'||f.id IN (SELECT value FROM json_each(?2))
   UNION ALL SELECT 'generation:'||g.id,'legacy-output:'||leaf.fullkey,CAST(leaf.value AS TEXT) FROM ai_generations g,json_tree(g.output_json) leaf WHERE g.project_id=?1 AND json_valid(g.output_json) AND leaf.type='text' AND 'generation:'||g.id IN (SELECT value FROM json_each(?2)) AND EXISTS(SELECT 1 FROM knowledge_generation_sources gs WHERE gs.project_id=g.project_id AND gs.generation_id=g.id)
   UNION ALL SELECT 'generation:'||b.generation_id,'answer:'||b.id,json_extract(b.payload_json,'$.text') FROM knowledge_reply_blocks b WHERE b.project_id=?1 AND b.kind='answer' AND 'generation:'||b.generation_id IN (SELECT value FROM json_each(?2)))`).bind(projectId,selected).all<{source_id:string;version:string;content:string}>()
  const shingles=new Map<string,{hash:string;words:string;source_id:string}>(),versions=[]
  for(const row of rows.results){for(const shingle of wordShingles(knowledgeWords(row.content||'')))shingles.set(row.source_id+'\0'+shingle.words,{hash:shingle.hash,words:shingle.words,source_id:row.source_id});versions.push({source_id:row.source_id,version:row.version,fingerprint:shingleHash(row.content||'')})}
  const statements:D1PreparedStatement[]=[]
  // Bound each JSON value below D1's value limit, without a per-shingle statement.
  const entries=[...shingles.values()]
  for(let index=0;index<entries.length;index+=1500)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO knowledge_shingles SELECT ?1,json_extract(value,'$.hash'),json_extract(value,'$.words'),json_extract(value,'$.source_id') FROM json_each(?2)`).bind(projectId,JSON.stringify(entries.slice(index,index+1500))))
  if(versions.length)statements.push(env.DB.prepare(`INSERT OR REPLACE INTO knowledge_source_index SELECT ?1,json_extract(value,'$.source_id'),json_extract(value,'$.version'),json_extract(value,'$.fingerprint') FROM json_each(?2)`).bind(projectId,JSON.stringify(versions)))
  statements.push(env.DB.prepare(`DELETE FROM knowledge_index_dirty WHERE project_id=? AND EXISTS(SELECT 1 FROM json_each(?) selected WHERE json_extract(selected.value,'$.source_id')=knowledge_index_dirty.source_id AND json_extract(selected.value,'$.stamp')=knowledge_index_dirty.stamp)`).bind(projectId,JSON.stringify(page)))
  await env.DB.batch(statements)
 }
 return !await env.DB.prepare('SELECT 1 FROM knowledge_index_dirty WHERE project_id=? LIMIT 1').bind(projectId).first()
}
/** Exactly one indexed corpus lookup per text write, including all normalized
 * shingles. Matching hashes are verified against the full words, so collisions
 * cannot create authority. */
async function refreshKnowledgeIndex(env:Env){
 const projects=await env.DB.prepare('SELECT DISTINCT project_id FROM knowledge_index_dirty').all<{project_id:string}>()
 let remaining=2000
 for(const row of projects.results){if(remaining<=0)throw new Error('KNOWLEDGE_INDEX_NOT_READY');const count=await env.DB.prepare('SELECT count(*) n FROM knowledge_index_dirty WHERE project_id=?').bind(row.project_id).first<{n:number}>();if(!await updateKnowledgeIndex(env,row.project_id,remaining))throw new Error('KNOWLEDGE_INDEX_NOT_READY');remaining-=count?.n||0}
}
type Source={id:string;project:string;incarnation:string|null}
type WriteProject=string|undefined|(()=>Promise<string|undefined>)
type Shingles=ReturnType<typeof wordShingles>
interface CopySpan {start:number;end:number;sources:Source[];sets:string;token?:string}
interface TextLeaf {text:string;output:string;shingles:Shingles;spans:CopySpan[]}

function textLeaf(text:string):TextLeaf{return {text,output:text,shingles:wordShingles(knowledgeWords(text)),spans:[]}}

/** Offsets belong to each original string, while the corpus match set is shared
 * by the entire write. Overlapping occurrences retain their own source sets. */
function copySpans(shingles:Shingles,matches:Map<string,number>,sourceSets:Map<number,Source[]>){
 const events=new Map<number,Map<number,number>>()
 const event=(at:number,sourceSet:number,delta:number)=>{const state=events.get(at)||new Map<number,number>();state.set(sourceSet,(state.get(sourceSet)||0)+delta);events.set(at,state)}
 for(const shingle of shingles){const set=matches.get(shingle.words);if(set!==undefined){event(shingle.start,set,1);event(shingle.end,set,-1)}}
 const spans:CopySpan[]=[],active=new Map<number,number>();let previous=0
 for(const [position,changes] of [...events].sort((a,b)=>a[0]-b[0])){
  if(position>previous&&active.size){const sets=[...active.keys()].sort(),key=JSON.stringify(sets),prior=spans.at(-1);if(prior&&prior.end===previous&&prior.sets===key)prior.end=position;else spans.push({start:previous,end:position,sources:[...new Map(sets.flatMap(set=>sourceSets.get(set)||[]).map(source=>[source.project+'\0'+source.id,source])).values()].sort((a,b)=>(a.project+'\0'+a.id).localeCompare(b.project+'\0'+b.id)),sets:key})}
  for(const [source,delta] of changes){const count=(active.get(source)||0)+delta;if(count)active.set(source,count);else active.delete(source)}previous=position
 }
 return spans
}

async function canonicaliseLeaves(env:Env,projectId:WriteProject,leaves:TextLeaf[],authorContactId:string|undefined,indexReady:boolean,generationId?:string){
 const candidates=leaves.filter(leaf=>leaf.shingles.length)
 // Short fields never consult D1, including the dirty-index refresh. Notification
 // envelopes can contain hundreds of identifiers and other nonmatching leaves.
 if(!candidates.length)return
 const unique=new Map<string,{hash:string;words:string}>()
 for(const leaf of candidates)for(const row of leaf.shingles)unique.set(row.words,{hash:row.hash,words:row.words})
 const lookup=()=>env.DB.prepare(`WITH dirty AS MATERIALIZED (SELECT DISTINCT project_id FROM knowledge_index_dirty WHERE ?2=0),matches AS (SELECT s.words,json_group_array(DISTINCT json_object('id',s.source_id,'project',s.project_id,'incarnation',coalesce(a.source_incarnation,retired.source_incarnation))) sources FROM json_each(?1) incoming CROSS JOIN knowledge_shingles s INDEXED BY knowledge_shingles_lookup LEFT JOIN knowledge_articles a ON s.source_id LIKE 'article:%' AND a.id=substr(s.source_id,9) AND a.project_id=s.project_id LEFT JOIN knowledge_retired_articles retired ON s.source_id LIKE 'article:%' AND retired.article_id=substr(s.source_id,9) AND retired.project_id=s.project_id WHERE NOT EXISTS(SELECT 1 FROM dirty) AND s.hash=json_extract(incoming.value,'$.hash') AND s.words=json_extract(incoming.value,'$.words') GROUP BY s.words) SELECT 'dirty' kind,project_id words,'' sources FROM dirty UNION ALL SELECT 'match',json_group_array(words),sources FROM matches GROUP BY sources`).bind(JSON.stringify([...unique.values()]),indexReady?1:0).all<{kind:string;words:string;sources:string}>()
 let rows=await lookup()
 if(rows.results.some(row=>row.kind==='dirty')){await refreshKnowledgeIndex(env);rows=await lookup()}
 const matches=new Map<string,number>(),sourceSets=new Map<number,Source[]>()
 for(const row of rows.results){const sources=(JSON.parse(row.sources) as Source[]).sort((a,b)=>(a.project+'\0'+a.id).localeCompare(b.project+'\0'+b.id)),key=sourceSets.size;sourceSets.set(key,sources);for(const words of JSON.parse(row.words))matches.set(words,key)}
 if(!matches.size)return
 const targetProject=typeof projectId==='function'?await projectId():projectId
 const groups=new Map<string,{leaf:TextLeaf;span:CopySpan}[]>()
 for(const leaf of candidates){
  leaf.spans=copySpans(leaf.shingles,matches,sourceSets)
  for(const span of leaf.spans){const owner=targetProject||span.sources[0].project,group=groups.get(owner)||[];group.push({leaf,span});groups.set(owner,group)}
 }
 // One creation batch per owning project, across all text fields in this write.
 for(const [owner,occurrences] of groups){
  const tokens=await createBlocks(env,owner,occurrences.map(({leaf,span})=>({kind:'copy',text:leaf.text.slice(span.start,span.end),sources:span.sources.map(source=>source.id),sourceIdentities:span.sources.filter(source=>source.id.startsWith('article:')),authorContactId:targetProject?authorContactId:undefined,generationId})))
  occurrences.forEach(({span},index)=>span.token=tokens[index])
 }
 for(const leaf of candidates){
  if(!leaf.spans.length)continue
  let output='',cursor=0
  for(const span of leaf.spans){output+=leaf.text.slice(cursor,span.start)+span.token!;cursor=span.end}
  leaf.output=output+leaf.text.slice(cursor)
 }
}

export async function canonicaliseKnowledge(env:Env,projectId:string|undefined,text:string,authorContactId?:string,indexReady=false,generationId?:string){
 const leaf=textLeaf(text)
 await canonicaliseLeaves(env,projectId,[leaf],authorContactId,indexReady,generationId)
 return leaf.output
}

export async function canonicaliseFields<T>(env:Env,projectId:WriteProject,value:T,authorContactId?:string,indexReady=false):Promise<T>{
 const leaves=new Map<string,TextLeaf>()
 // Rebuilders preserve JSON-string containers without treating serialized keys or
 // adjacent values as one sentence. Identical leaves share tokenization/storage.
 const collect=(item:unknown):(()=>unknown)=>{
  if(typeof item==='string'){
   if(/^[\[{]/.test(item)){let parsed:unknown;try{parsed=JSON.parse(item)}catch{}if(parsed!==undefined){const rebuild=collect(parsed),original=JSON.stringify(parsed);return ()=>{const output=JSON.stringify(rebuild());return output===original?item:output}}}
   const leaf=leaves.get(item)||textLeaf(item);leaves.set(item,leaf)
   return ()=>leaf.output
  }
  if(Array.isArray(item)){const children=item.map(collect);return ()=>children.map(rebuild=>rebuild())}
  if(item&&typeof item==='object'){const entries=Object.entries(item).map(([key,child])=>[collect(key),collect(child)] as const);return ()=>Object.fromEntries(entries.map(([key,rebuild])=>[String(key()),rebuild()]))}
  return ()=>item
 }
 const rebuild=collect(value)
 await canonicaliseLeaves(env,projectId,[...leaves.values()],authorContactId,indexReady)
 return rebuild() as T
}
