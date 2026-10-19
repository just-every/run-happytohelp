import type {Env} from '../../../platform/env'

/** Read current and retained identities; the caller carries them across the erasure fence. */
export async function csvErasureIdentities(env:Env,projectId:string,contactId:string,emails:string[]){
 const subjects=`SELECT ?2 id UNION SELECT contact_id FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2`
 const [contacts,images]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT id,name,email,external_id,metadata_json FROM contacts WHERE project_id=?1 AND id IN (${subjects})`).bind(projectId,contactId),
  env.DB.prepare(`SELECT data_json,before_json,after_json FROM csv_customer_import_rows WHERE project_id=?1 AND entity_id IN (${subjects}) AND run_id IN (SELECT id FROM csv_customer_imports WHERE project_id=?1 AND kind='contacts')`).bind(projectId,contactId),
 ])
 const values=new Set<string>([contactId,...emails].filter(Boolean)),identityKeys=new Set(['id','name','email','external_id','externalId','provided_name','provided_email','phone'])
 const collect=(object:any)=>{if(!object||typeof object!=='object')return;for(const [key,value] of Object.entries(object)){if(identityKeys.has(key)&&typeof value==='string'&&value.trim())values.add(value);if(key==='metadata_json'&&typeof value==='string')collect(JSON.parse(value));if(value&&typeof value==='object')collect(value)}}
 contacts.results.forEach(collect)
 for(const image of images.results)for(const value of Object.values(image))if(typeof value==='string')collect(JSON.parse(value))
 return [...values]
}

/** Match decoded cells, including attributes_json nested inside company snapshots. */
export function csvCustomerErasureStatements(env:Env,projectId:string,contactId:string,identities:string[]=[]){
 const matches=(expression:string)=>`EXISTS(SELECT 1 FROM json_each(?3) pii WHERE typeof(pii.value)='text' AND trim(pii.value)<>'' AND instr(lower(CAST(${expression} AS TEXT)),lower(pii.value))>0)`
 const match=`project_id=?1 AND (entity_id=?2 OR ${matches('reason')} OR EXISTS(SELECT 1 FROM json_tree(json_array(json(data_json),json(domain_match_json),json(before_json),json(after_json))) cell WHERE ${matches('cell.key')} OR cell.type='text' AND (${matches('cell.atom')} OR EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(cell.atom) THEN cell.atom ELSE '{}' END) nested WHERE ${matches('nested.key')} OR nested.type='text' AND ${matches('nested.atom')}))))`
 const bound=(sql:string)=>env.DB.prepare(sql).bind(projectId,contactId,JSON.stringify([...new Set([contactId,...identities])]))
 return [
  bound(`UPDATE csv_customer_imports SET status='erased' WHERE project_id=?1 AND id IN (SELECT run_id FROM csv_customer_import_rows WHERE ${match})`),
  bound(`UPDATE csv_customer_import_rows SET erased=1 WHERE ${match}`),
  env.DB.prepare("UPDATE csv_customer_import_rows SET entity_id=NULL,data_json='{}',domain_match_json='null',before_json='null',after_json='null',reason='Contact erased' WHERE project_id=? AND erased=1").bind(projectId),
 ]
}
