import type {Env} from '../../platform/env'
import type {Run} from './types'
import type {D1Sql} from '../import-kit/src/d1/types'
/** A source-owned contact/tag can be used later by a native or another import's
 * conversation. Those references are never part of this job's undo authority. */
export function undoReferencesClear(run:Run,jobId?:string):D1Sql {
 const owned="EXISTS(SELECT 1 FROM ik_provenance owned WHERE owned.job_id IN (SELECT sibling.kit_job_id FROM move_in_batches sibling JOIN move_in_batches original ON original.run_id=sibling.run_id WHERE original.kit_job_id=p.job_id) AND owned.destination=p.destination AND owned.target_kind='conversation' AND owned.target_id=c.id AND owned.reversed=0)"
 const ownedArticle=owned.replace("owned.target_kind='conversation'","owned.target_kind='article'").replace('owned.target_id=c.id','owned.target_id=a.id'),ownedCategory=owned.replace("owned.target_kind='conversation'","owned.target_kind='category'")
 const categoryReferences=`EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.project_id=p.destination AND (a.category_id=p.target_id OR EXISTS(SELECT 1 FROM knowledge_article_categories linked WHERE linked.article_id=a.id AND linked.category_id=p.target_id)) AND NOT ${ownedArticle}) OR EXISTS(SELECT 1 FROM knowledge_categories c WHERE c.project_id=p.destination AND c.parent_id=p.target_id AND NOT ${ownedCategory})`
 const ownedForm=owned.replace("owned.target_kind='conversation'","owned.target_kind='form'").replace('owned.target_id=c.id','owned.target_id=f.id')
 const ownedContact=owned.replace("owned.target_kind='conversation'","owned.target_kind='contact'").replace('owned.target_id=c.id','owned.target_id=linked.contact_id')
 const fieldReferences=`EXISTS(SELECT 1 FROM ticket_field_values v JOIN conversations c ON c.project_id=v.project_id AND c.id=v.conversation_id WHERE v.project_id=p.destination AND v.field_id=p.target_id AND NOT ${owned}) OR EXISTS(SELECT 1 FROM request_forms f,json_each(f.config_json,'$.fields') ref WHERE f.project_id=p.destination AND json_extract(ref.value,'$.fieldId')=p.target_id AND NOT ${ownedForm})`
 const references=[
  `SELECT 1 FROM conversations c WHERE c.project_id=p.destination AND c.contact_id=p.target_id AND NOT ${owned}`,
  `SELECT 1 FROM conversation_participants participant JOIN conversations c ON c.id=participant.conversation_id WHERE participant.contact_id=p.target_id AND c.project_id=p.destination AND NOT ${owned}`,
  `SELECT 1 FROM messages authored JOIN conversations c ON c.id=authored.conversation_id WHERE authored.actor_role='contact' AND authored.actor_id=p.target_id AND c.project_id=p.destination AND NOT ${owned}`,
  `SELECT 1 FROM conversation_tags tagged JOIN conversations c ON c.id=tagged.conversation_id WHERE tagged.tag_id=p.target_id AND tagged.project_id=p.destination AND NOT ${owned}`,
  // Customer access established after import belongs to the customer, not to
  // the import journal. Refuse reversal before any child is removed; deleting
  // the contact would otherwise fail its session foreign key mid-undo.
  `SELECT 1 FROM sessions session WHERE session.project_id=p.destination AND session.contact_id=p.target_id`
 ]
 return {sql:`NOT EXISTS(SELECT 1 FROM ik_provenance p WHERE ${jobId?'p.job_id=?':'p.job_id IN (SELECT kit_job_id FROM move_in_batches WHERE run_id=?)'} AND p.destination=? AND p.reversed=0 AND ((p.target_kind='contact' AND (EXISTS(${references[0]}) OR EXISTS(${references[1]}) OR EXISTS(${references[2]}) OR EXISTS(${references[4]}))) OR (p.target_kind='company' AND EXISTS(SELECT 1 FROM contact_companies linked WHERE linked.project_id=p.destination AND linked.company_id=p.target_id AND NOT ${ownedContact})) OR (p.target_kind='tag' AND EXISTS(${references[3]})) OR (p.target_kind='category' AND (${categoryReferences})) OR (p.target_kind='field' AND (${fieldReferences})) OR (p.target_kind='form' AND EXISTS(SELECT 1 FROM request_form_submissions s WHERE s.project_id=p.destination AND s.form_id=p.target_id))))`,params:[jobId??run.id,run.project_id]}
}
export async function assertUndoReferences(env:Env,run:Run,jobId?:string){const guard=undoReferencesClear(run,jobId),row=await env.DB.prepare(`SELECT (${guard.sql}) clear`).bind(...guard.params!).first<{clear:number}>();if(!row?.clear)throw new Error('NATIVE_EDIT_CONFLICT')}
