import {policyCtes,activeProjectSql,literal,type Readers} from './door'
/** One relational evaluation for a whole set of blocks. A copied span is an OR
 * of source occurrences for each reader; an answer is an AND of its generation's
 * full source set. A copy's generation id is erasure custody, not an alternative
 * source occurrence. References never grant authority by possession. */
export function referencePolicyCtes(selected:string,project:string,readers:Readers){
 const prelude=`selected AS MATERIALIZED (${selected}), original_readers AS MATERIALIZED (${readers.sql}),
 targets AS MATERIALIZED (SELECT b.id block_id,b.kind,b.author_contact_id,r.kind reader_kind,r.id reader_id,json_array(b.id,r.kind,r.id) target_key FROM selected b CROSS JOIN original_readers r),
 roots AS MATERIALIZED (SELECT b.id block_id,s.value root_source_id FROM selected b,json_each(b.sources_json) s UNION SELECT b.id,'generation:'||b.generation_id FROM selected b WHERE b.generation_id IS NOT NULL AND b.kind<>'copy'),
 expanded AS MATERIALIZED (SELECT block_id,root_source_id,root_source_id source_id FROM roots WHERE root_source_id NOT LIKE 'generation:%' UNION SELECT r.block_id,r.root_source_id,gs.source_id FROM roots r JOIN knowledge_generation_sources gs ON gs.project_id=${project} AND gs.generation_id=substr(r.root_source_id,12) WHERE r.root_source_id LIKE 'generation:%'),
 issued AS MATERIALIZED (SELECT t.block_id,t.target_key,e.root_source_id,e.source_id,json_array(t.target_key,e.root_source_id) policy_key FROM targets t JOIN expanded e ON e.block_id=t.block_id WHERE NOT (t.reader_kind='contact' AND t.reader_id IS t.author_contact_id)),
 source_articles AS MATERIALIZED (SELECT i.*,a.id article_id,a.category_id,a.project_id article_project,a.status FROM issued i LEFT JOIN knowledge_articles a ON a.id=substr(i.source_id,9) WHERE i.source_id LIKE 'article:%')`
 const scopedReaders:Readers={sql:`SELECT target_key,reader_kind kind,reader_id id FROM targets WHERE NOT (reader_kind='contact' AND reader_id IS author_contact_id)`}
 const seed=`SELECT policy_key,article_id,category_id FROM source_articles WHERE category_id IS NOT NULL UNION SELECT a.policy_key,a.article_id,ac.category_id FROM source_articles a JOIN knowledge_article_categories ac ON ac.article_id=a.article_id`
 const policy=policyCtes(project,scopedReaders,seed,"r.target_key=json_extract(l.source_id,'$[0]')")
 const invalid=`invalid_sources AS MATERIALIZED (SELECT policy_key FROM source_articles WHERE article_id IS NULL OR article_project<>${project} OR status<>'published' UNION SELECT i.policy_key FROM issued i WHERE i.source_id NOT LIKE 'article:%' AND (i.source_id NOT LIKE 'knowledge:%' OR NOT EXISTS(SELECT 1 FROM knowledge_documents original JOIN knowledge_versions v ON v.id=original.version_id JOIN knowledge_datasets ds ON ds.id=v.dataset_id JOIN knowledge_documents current ON current.version_id=ds.published_version AND current.url=original.url WHERE original.id=substr(i.source_id,11) AND ds.project_id=${project}))),
 visible_choices AS MATERIALIZED (SELECT DISTINCT i.block_id,i.target_key,i.root_source_id FROM issued i WHERE ${activeProjectSql(project)} AND NOT EXISTS(SELECT 1 FROM invalid_sources bad WHERE bad.policy_key=i.policy_key) AND NOT EXISTS(SELECT 1 FROM invalid_lineage bad WHERE bad.source_id=i.policy_key) AND NOT EXISTS(SELECT 1 FROM blocked bad WHERE bad.source_id=i.policy_key)),
 source_counts AS MATERIALIZED (SELECT block_id,count(*) n FROM roots GROUP BY block_id),
 choice_success AS MATERIALIZED (SELECT block_id,target_key,count(*) n FROM visible_choices GROUP BY block_id,target_key),
 choice_failure AS MATERIALIZED (SELECT t.block_id,t.target_key,count(*) n FROM targets t JOIN roots r ON r.block_id=t.block_id LEFT JOIN visible_choices v ON v.block_id=t.block_id AND v.target_key=t.target_key AND v.root_source_id=r.root_source_id WHERE v.block_id IS NULL GROUP BY t.block_id,t.target_key),
 blocked_targets AS MATERIALIZED (SELECT t.block_id FROM targets t LEFT JOIN source_counts sc ON sc.block_id=t.block_id LEFT JOIN choice_success success ON success.block_id=t.block_id AND success.target_key=t.target_key LEFT JOIN choice_failure failure ON failure.block_id=t.block_id AND failure.target_key=t.target_key WHERE NOT (t.reader_kind='contact' AND t.reader_id IS t.author_contact_id) AND (t.kind='copy' AND coalesce(success.n,0)=0 OR t.kind<>'copy' AND (coalesce(sc.n,0)=0 OR coalesce(failure.n,0)>0))),
 visible_blocks AS MATERIALIZED (SELECT b.id FROM selected b WHERE b.project_id=${project} AND EXISTS(SELECT 1 FROM original_readers) AND NOT EXISTS(SELECT 1 FROM blocked_targets blocked_target WHERE blocked_target.block_id=b.id))`
 return `${prelude},${policy},${invalid}`
}
export const visibleBlockSql=(block:string,project:string,readers:Readers)=>`EXISTS(WITH RECURSIVE ${referencePolicyCtes(`SELECT ${['id','project_id','kind','sources_json','generation_id','author_contact_id'].map(column=>`${block}.${column} ${column}`).join(',')}`,project,readers)} SELECT 1 FROM visible_blocks WHERE id=${block}.id)`
export function referenceSetAdmittedSql(ids:string[],project:string,readers:Readers){
 if(!ids.length)return '1=1'
 return `NOT EXISTS(WITH RECURSIVE requested AS MATERIALIZED (SELECT value id FROM json_each(${literal(JSON.stringify(ids))})),${referencePolicyCtes('SELECT b.* FROM knowledge_reply_blocks b JOIN requested r ON r.id=b.id',project,readers)} SELECT 1 FROM requested r WHERE NOT EXISTS(SELECT 1 FROM visible_blocks visible WHERE visible.id=r.id))`
}

export function referenceAdmissionPolicy(ids:string[],project:string,readers:Readers){
 if(!ids.length)return {prefix:'',sql:'1=1',params:[] as unknown[]}
 return {prefix:`WITH RECURSIVE requested AS MATERIALIZED (SELECT value id FROM json_each(?)),${referencePolicyCtes('SELECT b.* FROM knowledge_reply_blocks b JOIN requested r ON r.id=b.id',project,readers)} `,sql:'NOT EXISTS(SELECT 1 FROM requested r WHERE NOT EXISTS(SELECT 1 FROM visible_blocks visible WHERE visible.id=r.id))',params:[JSON.stringify(ids)] as unknown[]}
}

/** Current visibility of a generated artifact's complete retained source set. */
export function sourceSetAdmittedSql(sources:string,project:string,readers:Readers){
 const selected=`SELECT 'sources' id,${project} project_id,'answer' kind,json_group_array(source_id) sources_json,NULL generation_id,NULL author_contact_id FROM (${sources}) HAVING count(*)>0`
 return `NOT EXISTS(WITH RECURSIVE ${referencePolicyCtes(selected,project,readers)} SELECT 1 FROM selected b WHERE NOT EXISTS(SELECT 1 FROM visible_blocks v WHERE v.id=b.id))`
}
