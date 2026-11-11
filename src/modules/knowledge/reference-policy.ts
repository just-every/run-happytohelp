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
 const documentCurrent=`EXISTS(SELECT 1 FROM knowledge_documents original JOIN knowledge_versions v ON v.id=original.version_id JOIN knowledge_datasets ds ON ds.id=v.dataset_id JOIN knowledge_documents current ON current.version_id=ds.published_version AND current.url=original.url WHERE original.id=substr(${source},11) AND ds.project_id=${project})`
 return `(${source} LIKE 'article:%' AND (${articleBad} OR ${lineage}) OR ${source} NOT LIKE 'article:%' AND (${source} NOT LIKE 'knowledge:%' OR NOT ${documentCurrent}))`
}
/** Every (block, reader, root, expanded source) occurrence with its verdict. A
 * root with no expansion (or a block with no roots) is one null source, which is
 * never visible. The author's own copy is not a target, so its sources are not
 * read for that reader. A generation root expands to that generation's retained sources. */
function occurrencesSql(project:string){
 const roots=`(SELECT json_group_array(root) FROM (SELECT value root FROM json_each(b.sources_json) UNION SELECT 'generation:'||b.generation_id WHERE b.generation_id IS NOT NULL AND b.kind<>'copy'))`
 return `SELECT o.*,CASE WHEN o.source IS NULL THEN 1 WHEN ${sourceBadSql(project,'o.source',{kind:'o.reader_kind',id:'o.reader_id',account:'o.account',member:'o.member'})} THEN 1 ELSE 0 END bad FROM (SELECT b.id block_id,b.kind,b.author_contact_id,r.kind reader_kind,r.id reader_id,r.account,r.member,r.active,ro.value root,CASE WHEN ro.value LIKE 'generation:%' THEN gs.source_id ELSE ro.value END source FROM selected b CROSS JOIN reader_facts r LEFT JOIN json_each(CASE WHEN NOT (r.kind='contact' AND r.id IS b.author_contact_id) THEN ${roots} END) ro LEFT JOIN knowledge_generation_sources gs ON ro.value LIKE 'generation:%' AND gs.project_id=${project} AND gs.generation_id=substr(ro.value,12) WHERE b.project_id=${project}) o`
}
/** A root is a visible choice for a reader when the workspace is active and all
 * its sources are visible. A copy needs one visible choice per reader, any other
 * block needs every root; the author always sees its own copy; a block needs at
 * least one reader. Like the selection, visible_blocks has one row per selected row. */
export function referencePolicyCtes(selected:string,project:string,readers:Readers){
 const choices=`SELECT block_id,kind,author_contact_id,reader_kind,reader_id,CASE WHEN active AND max(bad)=0 THEN 1 ELSE 0 END ok FROM occurrences GROUP BY block_id,reader_kind,reader_id,root`
 const targets=`SELECT block_id,CASE WHEN NOT (reader_kind='contact' AND reader_id IS author_contact_id) THEN CASE WHEN kind='copy' THEN max(ok)=0 WHEN kind<>'copy' THEN min(ok)=0 ELSE 0 END ELSE 0 END blocked FROM (${choices}) GROUP BY block_id,reader_kind,reader_id`
 return `selected AS MATERIALIZED (${selected}),
 reader_facts AS MATERIALIZED (${readerFactsSql(project,readers)}),
 occurrences AS MATERIALIZED (${occurrencesSql(project)}),
 visible_blocks AS MATERIALIZED (SELECT b.id FROM selected b JOIN (SELECT block_id FROM (${targets}) GROUP BY block_id HAVING max(blocked)=0) visible ON visible.block_id=b.id)`
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
