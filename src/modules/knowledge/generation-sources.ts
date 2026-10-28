import type {Env} from '../../platform/env'
import {literal,visibleSourceSql,type Readers} from './door'
import {visibleBlockSql} from './reference-policy'
import {referenceIds} from './reference-store'

/** Support retains its public generation identity; other engines own namespaced
 * attempts. This ledger deliberately has no support-job foreign key. */
export const generationKey=(family:string,id:string)=>family==='generations'?id:`${family}:${id}`

export async function generationSources(env:Env,projectId:string,generationId:string){
 return (await env.DB.prepare('SELECT DISTINCT source_id FROM knowledge_generation_sources WHERE project_id=? AND generation_id=?').bind(projectId,generationId).all<{source_id:string}>()).results.map(row=>row.source_id)
}

/** Record only occurrences the actual model audience may see. Copy blocks can
 * have other, restricted occurrences; those never enter the generation set.
 * Stored generation edges are flattened so every answer requires the full set. */
export async function recordModelSources(env:Env,projectId:string,generationId:string,value:unknown,readers:Readers){
 const ids=referenceIds(JSON.stringify(value)||'');if(!ids.length)return
 const project=literal(projectId)
 await env.DB.prepare(`WITH RECURSIVE admitted AS MATERIALIZED (SELECT b.* FROM knowledge_reply_blocks b WHERE b.project_id=?1 AND b.id IN (SELECT value FROM json_each(?2)) AND ${visibleBlockSql('b',project,readers)}), roots(source_id) AS (SELECT s.value FROM admitted b,json_each(b.sources_json) s UNION SELECT 'generation:'||b.generation_id FROM admitted b WHERE b.generation_id IS NOT NULL AND b.kind<>'copy'), expanded(source_id) AS (SELECT source_id FROM roots UNION SELECT gs.source_id FROM expanded e JOIN knowledge_generation_sources gs ON gs.project_id=?1 AND gs.generation_id=substr(e.source_id,12) WHERE e.source_id LIKE 'generation:%'), visible AS MATERIALIZED (SELECT DISTINCT e.source_id FROM expanded e WHERE e.source_id NOT LIKE 'generation:%' AND ${visibleSourceSql('e.source_id',project,readers)}) INSERT OR IGNORE INTO knowledge_generation_sources(generation_id,project_id,source_id,source_version) SELECT ?3,?1,v.source_id,coalesce((SELECT CAST(a.publication_version AS TEXT) FROM knowledge_articles a WHERE v.source_id='article:'||a.id AND a.project_id=?1),(SELECT d.version_id FROM knowledge_documents d WHERE v.source_id='knowledge:'||d.id),'') FROM visible v`).bind(projectId,JSON.stringify(ids),generationId).run()
 // Existing support citation and tool contracts continue to use their original
 // table. Its insert trigger mirrors tool-issued sources in the other direction.
 await env.DB.prepare(`INSERT OR IGNORE INTO ai_generation_sources(generation_id,project_id,source_id,source_version) SELECT s.generation_id,s.project_id,s.source_id,s.source_version FROM knowledge_generation_sources s WHERE s.project_id=? AND s.generation_id=? AND EXISTS(SELECT 1 FROM ai_generations g WHERE g.id=s.generation_id AND g.project_id=s.project_id)`).bind(projectId,generationId).run()
}
