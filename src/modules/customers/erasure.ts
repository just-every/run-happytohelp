import type {Env} from '../../platform/env'

// Evaluate before canonical contact redaction, including aliases, so a history
// snapshot or arbitrary typed attribute cannot put erased identity back via undo.
const subject=`SELECT ?2 id UNION SELECT contact_id FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2`
const personal=`SELECT c.id value FROM contacts c WHERE c.project_id=?1 AND c.id IN (${subject})
 UNION SELECT c.name FROM contacts c WHERE c.project_id=?1 AND c.id IN (${subject}) AND c.name IS NOT NULL AND c.name<>''
 UNION SELECT c.email FROM contacts c WHERE c.project_id=?1 AND c.id IN (${subject}) AND c.email IS NOT NULL AND c.email<>''
 UNION SELECT c.external_id FROM contacts c WHERE c.project_id=?1 AND c.id IN (${subject}) AND c.external_id IS NOT NULL AND c.external_id<>''
 UNION SELECT j.atom FROM contacts c,json_tree(c.metadata_json) j WHERE c.project_id=?1 AND c.id IN (${subject}) AND j.type='text' AND j.atom<>''`
function matches(expression:string){return `EXISTS(SELECT 1 FROM (${personal}) pii WHERE pii.value=${expression} OR EXISTS(SELECT 1 FROM contacts c WHERE c.project_id=?1 AND c.id IN (${subject}) AND ((c.email IS NOT NULL AND c.email<>'' AND instr(lower(${expression}),lower(c.email))>0) OR (c.name IS NOT NULL AND c.name<>'' AND instr(${expression},c.name)>0))))`}
function snapshotAttributes(column:string){return `EXISTS(SELECT 1 FROM json_each(${column}) state,json_tree(json_extract(state.value,'$.company.attributes_json')) attr WHERE attr.type='text' AND ${matches('attr.atom')})`}
const historyAffected=`project_id=?1 AND (EXISTS(SELECT 1 FROM json_tree(before_json) j WHERE j.type='text' AND ${matches('j.atom')}) OR EXISTS(SELECT 1 FROM json_tree(after_json) j WHERE j.type='text' AND ${matches('j.atom')}) OR EXISTS(SELECT 1 FROM json_tree(provenance_json) j WHERE j.type='text' AND ${matches('j.atom')}) OR ${snapshotAttributes('before_json')} OR ${snapshotAttributes('after_json')})`
const attributesAffected=`EXISTS(SELECT 1 FROM json_each(attributes_json) a WHERE a.type='text' AND ${matches('a.atom')})`
const companyAffected=`project_id=?1 AND (${matches('companies.name')} OR ${attributesAffected} OR id IN (SELECT company_id FROM contact_companies WHERE project_id=?1 AND contact_id IN (${subject})))`
export const customerErasureCount=`(SELECT count(*) FROM customer_identity_links WHERE project_id=?1 AND (contact_id IN (${subject}) OR linked_contact_id IN (${subject})))+(SELECT count(*) FROM contact_companies WHERE project_id=?1 AND contact_id IN (${subject}))+(SELECT count(*) FROM company_history WHERE ${historyAffected})+(SELECT count(*) FROM companies WHERE ${companyAffected})+(SELECT count(*) FROM company_domains WHERE project_id=?1 AND ${matches('company_domains.domain')})+(SELECT count(*) FROM company_attribute_definitions WHERE project_id=?1 AND (${matches('company_attribute_definitions.name')} OR EXISTS(SELECT 1 FROM json_each(options_json) o WHERE ${matches('o.value')})))`
export function customerErasureStatements(env:Env,projectId:string,contactId:string){
 const bound=(sql:string)=>env.DB.prepare(sql).bind(projectId,contactId)
 return [
  bound(`DELETE FROM customer_identity_links WHERE project_id=?1 AND (contact_id IN (${subject}) OR linked_contact_id IN (${subject}))`),
  // Remove complete affected undo records, including their provenance. Keeping a
  // partial snapshot would make restoration destructive or revive private data.
  bound(`DELETE FROM company_history WHERE ${historyAffected}`),
  bound(`UPDATE companies SET name=CASE WHEN ${matches('companies.name')} THEN 'Erased company' ELSE name END,
   attributes_json=coalesce((SELECT json_group_object(a.key,json(a.value)) FROM (SELECT key,CASE type WHEN 'text' THEN json_quote(value) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' ELSE CAST(value AS TEXT) END value FROM json_each(companies.attributes_json) e WHERE NOT(e.type='text' AND ${matches('e.atom')})) a),'{}'),
   revision=revision+1,updated_at=max(updated_at+1,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) WHERE ${companyAffected}`),
  bound(`DELETE FROM company_domains WHERE project_id=?1 AND ${matches('company_domains.domain')}`),
  bound(`UPDATE company_attribute_definitions SET name=CASE WHEN ${matches('company_attribute_definitions.name')} THEN 'Erased attribute' ELSE name END,
   options_json=(SELECT json_group_array(value) FROM json_each(company_attribute_definitions.options_json) o WHERE NOT ${matches('o.value')})
   WHERE project_id=?1 AND (${matches('company_attribute_definitions.name')} OR EXISTS(SELECT 1 FROM json_each(options_json) o WHERE ${matches('o.value')}))`),
  bound(`DELETE FROM contact_companies WHERE project_id=?1 AND contact_id IN (${subject})`),
 ]
}
