import type {Env} from '../../platform/env'
import {visibleArticleSql,type Readers} from './door'
import {articleCanonicalUrl} from './public-sources'
/** A copied span has no embedded identifying metadata. Derive model labels only
 * from currently visible occurrences, so a shared public span cannot name a
 * restricted occurrence. The pinned body remains in its reference store. */
export async function modelReferenceLabels(env:Env,projectId:string,ids:string[],readers:Readers){
 const rows=await env.DB.prepare(`WITH roots AS MATERIALIZED (SELECT b.id block_id,s.value source_id FROM knowledge_reply_blocks b,json_each(b.sources_json) s WHERE b.project_id=?1 AND b.id IN (SELECT value FROM json_each(?2)) UNION SELECT b.id,'generation:'||b.generation_id FROM knowledge_reply_blocks b WHERE b.project_id=?1 AND b.id IN (SELECT value FROM json_each(?2)) AND b.generation_id IS NOT NULL), sources AS MATERIALIZED (SELECT block_id,source_id FROM roots WHERE source_id NOT LIKE 'generation:%' UNION SELECT r.block_id,g.source_id FROM roots r JOIN knowledge_generation_sources g ON g.project_id=?1 AND g.generation_id=substr(r.source_id,12) WHERE r.source_id LIKE 'generation:%') SELECT s.block_id,a.title,a.slug,NULL url FROM sources s JOIN knowledge_articles a ON s.source_id='article:'||a.id WHERE a.project_id=?1 AND ${visibleArticleSql('a',readers)} UNION SELECT s.block_id,f.title,NULL,f.url FROM sources s JOIN knowledge_documents f ON s.source_id='knowledge:'||f.id JOIN knowledge_versions v ON v.id=f.version_id JOIN knowledge_datasets d ON d.id=v.dataset_id WHERE d.project_id=?1 AND EXISTS(SELECT 1 FROM knowledge_documents current WHERE current.version_id=d.published_version AND current.url=f.url)`).bind(projectId,JSON.stringify(ids)).all<{block_id:string;title:string;slug:string|null;url:string|null}>()
 const labels=new Map<string,string[]>()
 for(const row of rows.results){const label=`[${row.title.replace(/[\[\]\\]/g,'')}](${row.url||articleCanonicalUrl(env,projectId,row.slug!)})`,prior=labels.get(row.block_id)||[];if(!prior.includes(label))prior.push(label);labels.set(row.block_id,prior)}
 return new Map([...labels].map(([id,values])=>[id,values.join('\n')]))
}
