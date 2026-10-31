import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'

/** Observed alongside source bytes, never fetched later to authorize them. */
export interface ObservedArticleSource {id:string;project:string;incarnation:string|null}

export function articleSourceIdentities(project:string,sources:readonly {id:string;sourceVersion:string}[]):ObservedArticleSource[]{
 return sources.filter(source=>source.id.startsWith('article:')).map(source=>{
  const separator=source.sourceVersion.indexOf(':')
  if(separator<0)throw new HTTPException(409,{message:'Knowledge source identity changed'})
  return {id:source.id,project,incarnation:source.sourceVersion.slice(0,separator)}
 })
}

/** Retired copies remain protected, including legacy tombstones without an
 * incarnation. A live replacement can never borrow a retired identity. */
export function observedArticleSourceSql(source:string,project:string,incarnation:string){
 return `(EXISTS(SELECT 1 FROM knowledge_articles observed_article WHERE observed_article.id=substr(${source},9) AND observed_article.project_id=${project} AND observed_article.source_incarnation IS ${incarnation}) OR (NOT EXISTS(SELECT 1 FROM knowledge_articles live_article WHERE live_article.id=substr(${source},9)) AND EXISTS(SELECT 1 FROM knowledge_retired_articles retired_article WHERE retired_article.article_id=substr(${source},9) AND retired_article.project_id=${project} AND retired_article.source_incarnation IS ${incarnation})))`
}

/** Register only the publication issued by retrieval. Retained article
 * publications permit edits within an incarnation; dataset revisions are pins
 * on the original document and do not require it to be the latest revision. */
export async function registerToolSource(env:Env,table:'ai_generation_sources'|'knowledge_generation_sources',projectId:string,generationId:string,source:{id:string;sourceVersion:string}){
 const observed=articleSourceIdentities(projectId,[source])[0]
 const admitted=observed
  ? `EXISTS(SELECT 1 FROM knowledge_articles a JOIN knowledge_article_publications publication ON publication.article_id=a.id AND publication.project_id=a.project_id WHERE a.id=substr(?3,9) AND a.project_id=?2 AND a.source_incarnation=?5 AND publication.source_version=CASE WHEN instr(?4,'~')>0 THEN substr(?4,1,instr(?4,'~')-1) ELSE ?4 END)`
  : `?3 LIKE 'knowledge:%' AND EXISTS(SELECT 1 FROM knowledge_documents document JOIN knowledge_versions version ON version.id=document.version_id JOIN knowledge_datasets dataset ON dataset.id=version.dataset_id WHERE document.id=substr(?3,11) AND dataset.project_id=?2 AND document.version_id=?4)`
 const args=[generationId,projectId,source.id,source.sourceVersion,...(observed?[observed.incarnation]:[])]
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO ${table}(generation_id,project_id,source_id,source_version) SELECT ?1,?2,?3,?4 WHERE ${admitted}`).bind(...args),
  env.DB.prepare(`SELECT source_id FROM ${table} WHERE generation_id=?1 AND project_id=?2 AND source_id=?3 AND source_version=?4 AND ${admitted}`).bind(...args)
 ])
 if(result[1].results.length!==1)throw new HTTPException(409,{message:'Knowledge source identity changed'})
}
