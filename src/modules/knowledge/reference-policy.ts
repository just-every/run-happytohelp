import {activeProjectSql,literal,type Readers} from './door'
import {nativeEmailProofSql} from './native-proof'
/** One relational evaluation for a whole set of blocks. A copied span is an OR
 * of source occurrences for each reader; an answer is an AND of its generation's
 * full source set. A copy's generation id is erasure custody (its generation or
 * its ticket), not an alternative source occurrence. References never grant
 * authority by possession.
 *
 * Real D1 refuses a statement once it names about 100 FROM items with every CTE
 * reference expanded in place, and once nested subqueries pass its expression
 * depth. So each relation is read once: the readers once (with each reader's own
 * account proof and knowledge membership, read by key), the blocks once, and
 * every source, lineage and grant check is a correlated lookup of that block and
 * reader instead of a workspace-wide relation. */
function readerFactsSql(project:string,readers:Readers){
 const native=nativeEmailProofSql.replaceAll('c.','ct.')
 const account=`EXISTS(SELECT 1 FROM contacts ct WHERE r.kind='contact' AND ct.id=r.id AND +ct.project_id=${project} AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)<>1 AND coalesce(json_extract(ct.metadata_json,'$.is_deleted'),0)<>1 AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures erased WHERE erased.project_id=ct.project_id AND erased.contact_id=ct.id) AND (ct.is_verified=1 OR (${native}) OR EXISTS(SELECT 1 FROM portal_identities pi WHERE pi.project_id=ct.project_id AND pi.contact_id=ct.id AND pi.email=lower(trim(ct.email)))))`
 // [selection] for a knowledge member (selection null: every article), null otherwise.
 const member=`(SELECT json_array(json(pr.knowledge_article_ids)) FROM memberships mm LEFT JOIN member_roles mr ON mr.project_id=mm.project_id AND mr.user_id=mm.user_id LEFT JOIN project_roles pr ON pr.project_id=mm.project_id AND pr.id=mr.role_key WHERE r.kind='member' AND mm.project_id=${project} AND mm.user_id=r.id AND (mm.role='owner' OR mr.role_key IS NULL AND mm.role IN ('admin','operator') OR pr.base IN ('admin','operator') AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value IN ('knowledge.read','knowledge.edit'))))`
 return `SELECT r.kind kind,r.id id,${account} account,${member} member,${activeProjectSql(project)} active FROM (${readers.sql}) r`
}
/** True when one source occurrence is not visible to reader `r`: a missing,
 * foreign or unpublished article, a missing, foreign or unpublished category in
 * its lineage, a restricted category the reader is not allowed, or a non-article
 * source that is not a current published knowledge document. Each grant row is
 * unique per category and contact, so the left joins only test presence. */
interface ReaderColumns {kind:string;id:string;account:string;member:string}
const factsOf=(alias:string):ReaderColumns=>({kind:`${alias}.kind`,id:`${alias}.id`,account:`${alias}.account`,member:`${alias}.member`})
function sourceBadSql(project:string,source:string,r:ReaderColumns){
 const article=`substr(${source},9)`
 const memberAllowed=`${r.member} IS NOT NULL AND (json_extract(${r.member},'$[0]') IS NULL OR l.article_id IS NULL OR l.article_id IN (SELECT value FROM json_each(json_extract(${r.member},'$[0]'))))`
 const grants=`LEFT JOIN knowledge_collection_entitlements g ON g.project_id=${project} AND g.category_id=k.id AND g.contact_id=${r.id} LEFT JOIN contact_companies cc ON cc.project_id=${project} AND cc.contact_id=${r.id} LEFT JOIN companies company ON company.project_id=cc.project_id AND company.id=cc.company_id AND company.merged_into IS NULL LEFT JOIN knowledge_company_entitlements cg ON cg.project_id=company.project_id AND cg.company_id=company.id AND cg.category_id=k.id`
 const lineage=`EXISTS(WITH RECURSIVE lineage(article_id,id) AS (SELECT a.id,a.category_id FROM knowledge_articles a WHERE a.id=${article} AND a.category_id IS NOT NULL UNION SELECT a.id,ac.category_id FROM knowledge_articles a JOIN knowledge_article_categories ac ON ac.article_id=a.id WHERE a.id=${article} UNION SELECT l.article_id,k.parent_id FROM lineage l JOIN knowledge_categories k ON k.id=l.id WHERE k.parent_id IS NOT NULL) SELECT 1 FROM lineage l LEFT JOIN knowledge_categories k ON k.id=l.id ${grants} WHERE k.id IS NULL OR k.project_id<>${project} OR k.is_published<>1 OR (k.audience<>'public' OR k.requires_entitlement=1) AND NOT (${memberAllowed} OR k.audience='signed-in' AND k.requires_entitlement=0 AND (${r.account} OR ${r.kind}='verified') OR ${r.account} AND (g.contact_id IS NOT NULL OR cg.company_id IS NOT NULL)))`
 const articleBad=`coalesce((SELECT CASE WHEN a.project_id<>${project} OR a.status<>'published' THEN 1 ELSE 0 END FROM knowledge_articles a WHERE a.id=${article}),1)=1`
 // A document of the published version with a URL is its own current document
 // (equal URLs), so only other versions' documents look for one by URL.
 const documentCurrent=`EXISTS(SELECT 1 FROM knowledge_documents original JOIN knowledge_versions v ON v.id=original.version_id JOIN knowledge_datasets ds ON ds.id=v.dataset_id WHERE original.id=substr(${source},11) AND ds.project_id=${project} AND (original.version_id=ds.published_version AND original.url IS NOT NULL OR EXISTS(SELECT 1 FROM knowledge_documents current WHERE current.version_id=ds.published_version AND current.url=original.url)))`
 return `(${source} LIKE 'article:%' AND (${articleBad} OR ${lineage}) OR ${source} NOT LIKE 'article:%' AND (${source} NOT LIKE 'knowledge:%' OR NOT ${documentCurrent}))`
}
/** A block's roots are its sources, plus its generation for any block but a
 * copy. A root is a visible choice for a reader when the workspace is active and
 * every source of it is visible: a generation root's sources are that
 * generation's retained sources (none: not a choice), a null root never is. A
 * copy needs one visible choice per reader, any other block needs every root and
 * at least one; the author always sees its own copy, and its sources are not read
 * for that reader; a block needs at least one reader. Like the selection,
 * visible_blocks has one row per selected row.
 *
 * Each (block, reader) is one search over the block's roots that stops at the
 * first root that decides it (a copy's first visible root, any other block's
 * first failing one), so a block of hundreds of sources costs a few lookups, not
 * one per source. A generation root is its own unit (its retained sources as one
 * array, decided by the same search), which keeps the source test one subquery
 * below the (block, reader) row under D1's expression depth. Generation roots
 * inside sources_json are looked for only when its text can hold one (the
 * prefix, or a JSON escape that could spell it) and json_each accepts it: JSON5
 * text or JSONB, as json_valid(…,6) tests (D1 does not authorize json_error_position). */
export function referencePolicyCtes(selected:string,project:string,readers:Readers){
 const generationRoots=`CASE WHEN (b.sources_json LIKE '%generation:%' OR instr(b.sources_json,char(92))>0) AND json_valid(b.sources_json,6) THEN b.sources_json END`
 const retained=(root:string)=>`(SELECT json_group_array(gs.source_id) FROM knowledge_generation_sources gs WHERE gs.project_id=${project} AND gs.generation_id=substr(${root},12))`
 // gen 0: the block's own roots (generation roots are decided by their own unit); gen 1: one generation root's retained sources.
 const units=`SELECT b.id block_id,b.kind,b.author_contact_id,0 gen,b.sources_json sources FROM selected b WHERE b.project_id=${project}
 UNION ALL SELECT b.id,b.kind,b.author_contact_id,1,${retained(`'generation:'||b.generation_id`)} FROM selected b WHERE b.project_id=${project} AND b.generation_id IS NOT NULL AND b.kind<>'copy'
 UNION ALL SELECT b.id,b.kind,b.author_contact_id,1,${retained('ro.value')} FROM selected b,json_each(${generationRoots}) ro WHERE b.project_id=${project} AND ro.value LIKE 'generation:%'`
 const target=(kind:string,id:string,author:string)=>`NOT (${kind}='contact' AND ${id} IS ${author})`
 // A target's roots of the unit (none for the author's own copy: its sources are not read).
 const read=`json_each(CASE WHEN ${target('r.kind','r.id','u.author_contact_id')} THEN u.sources END) ro`
 // 1 bad, 0 visible, null skipped (gen 0 leaves generation roots to their own units).
 const bad=`CASE WHEN u.gen=0 AND ro.value IS NOT NULL AND ro.value LIKE 'generation:%' THEN NULL WHEN ro.value IS NULL THEN 1 WHEN ${sourceBadSql(project,'ro.value',factsOf('r'))} THEN 1 ELSE 0 END`
 // found: gen 0 of a copy, some root of its own is visible; otherwise some root (or retained source) is not.
 const found=`EXISTS(SELECT 1 FROM ${read} WHERE ${bad}=CASE WHEN u.gen=0 AND u.kind='copy' THEN 0 ELSE 1 END)`
 // roots: gen 0 of any other block, whether sources_json holds a root; gen 1, whether it retains a source.
 const roots=`CASE WHEN u.gen=1 THEN json_array_length(u.sources)>0 WHEN u.kind<>'copy' THEN EXISTS(SELECT 1 FROM ${read}) END`
 const copyVisible=`max(active) AND (max(CASE WHEN gen=0 THEN found END)=1 OR max(CASE WHEN gen=1 THEN roots AND NOT found END)=1)`
 const otherVisible=`max(active) AND (max(CASE WHEN gen=0 THEN roots END)=1 OR max(gen)=1) AND max(CASE WHEN gen=0 THEN found END)=0 AND coalesce(min(CASE WHEN gen=1 THEN roots AND NOT found END),1)=1`
 const blocked=`CASE WHEN ${target('reader_kind','reader_id','author_contact_id')} THEN CASE WHEN kind='copy' THEN CASE WHEN ${copyVisible} THEN 0 ELSE 1 END WHEN kind<>'copy' THEN CASE WHEN ${otherVisible} THEN 0 ELSE 1 END ELSE 0 END ELSE 0 END`
 return `selected AS MATERIALIZED (${selected}),
 reader_facts AS MATERIALIZED (${readerFactsSql(project,readers)}),
 units AS MATERIALIZED (${units}),
 decisions AS MATERIALIZED (SELECT u.block_id,u.kind,u.author_contact_id,u.gen,r.kind reader_kind,r.id reader_id,r.active,${found} found,${roots} roots FROM units u CROSS JOIN reader_facts r),
 visible_blocks AS MATERIALIZED (SELECT b.id FROM selected b JOIN (SELECT block_id FROM (SELECT block_id,${blocked} blocked FROM decisions GROUP BY block_id,reader_kind,reader_id) GROUP BY block_id HAVING max(blocked)=0) visible ON visible.block_id=b.id)`
}
export const visibleBlockSql=(block:string,project:string,readers:Readers)=>`EXISTS(WITH ${referencePolicyCtes(`SELECT ${['id','project_id','kind','sources_json','generation_id','author_contact_id'].map(column=>`${block}.${column} ${column}`).join(',')}`,project,readers)} SELECT 1 FROM visible_blocks WHERE id=${block}.id)`
export function referenceSetAdmittedSql(ids:string[],project:string,readers:Readers){
 if(!ids.length)return '1=1'
 return `NOT EXISTS(WITH requested AS MATERIALIZED (SELECT value id FROM json_each(${literal(JSON.stringify(ids))})),${referencePolicyCtes('SELECT b.* FROM knowledge_reply_blocks b JOIN requested r ON r.id=b.id',project,readers)} SELECT 1 FROM requested r WHERE NOT EXISTS(SELECT 1 FROM visible_blocks visible WHERE visible.id=r.id))`
}

export function referenceAdmissionPolicy(ids:string[],project:string,readers:Readers){
 if(!ids.length)return {prefix:'',sql:'1=1',params:[] as unknown[]}
 return {prefix:`WITH RECURSIVE requested AS MATERIALIZED (SELECT value id FROM json_each(?)),${referencePolicyCtes('SELECT b.* FROM knowledge_reply_blocks b JOIN requested r ON r.id=b.id',project,readers)} `,sql:'NOT EXISTS(SELECT 1 FROM requested r WHERE NOT EXISTS(SELECT 1 FROM visible_blocks visible WHERE visible.id=r.id))',params:[JSON.stringify(ids)] as unknown[]}
}

/** Current visibility of a generated artifact's complete retained source set. */
export function sourceSetAdmittedSql(sources:string,project:string,readers:Readers){
 const selected=`SELECT 'sources' id,${project} project_id,'answer' kind,json_group_array(source_id) sources_json,NULL generation_id,NULL author_contact_id FROM (${sources}) HAVING count(*)>0`
 return `NOT EXISTS(WITH ${referencePolicyCtes(selected,project,readers)} SELECT 1 FROM selected b WHERE NOT EXISTS(SELECT 1 FROM visible_blocks v WHERE v.id=b.id))`
}

/** Visibility of one non-generation source occurrence to every reader: the
 * decision visibleSourceSql makes for it, without a workspace-wide relation. */
export function sourceOccurrenceVisibleSql(source:string,project:string,readers:Readers){
 return `(SELECT count(*)>0 AND coalesce(max(CASE WHEN r.active AND NOT ${sourceBadSql(project,source,factsOf('r'))} THEN 0 ELSE 1 END),0)=0 FROM (${readerFactsSql(project,readers)}) r)`
}
