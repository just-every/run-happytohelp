import type {Env} from '../../../platform/env'
import type {ImportRun} from './types'

/** Set-based operations keep a thousand-row run within one atomic D1 batch. */
export function mutationStatements(env:Env,run:ImportRun,undo:boolean,now:number){
 const image=undo?'before_json':'after_json',p=run.project_id,id=run.id
 const rows=`SELECT *,${image} image FROM csv_customer_import_rows WHERE run_id=? AND project_id=? AND action<>'skip'`
 const field=(name:string)=>`json_extract(r.image,'$.${name}')`
 const bind=(sql:string,...params:(string|number)[])=>env.DB.prepare(sql).bind(...params)
 const statements:D1PreparedStatement[]=[]
 if(run.kind==='contacts'){
  if(!undo)statements.push(bind(`INSERT INTO contacts(id,project_id,name,email,external_id,metadata_json,is_verified,created_at) SELECT r.entity_id,?,${['name','email','external_id','metadata_json','is_verified','created_at'].map(field).join(',')} FROM (${rows}) r WHERE r.action='create'`,p,id,p))
  statements.push(bind(`UPDATE contacts AS c SET name=${field('name')},email=${field('email')},external_id=${field('external_id')},metadata_json=${field('metadata_json')},is_verified=${field('is_verified')} FROM (${rows}) r WHERE c.project_id=? AND c.id=r.entity_id AND r.action='update'`,id,p,p))
  const changed=`SELECT * FROM (${rows}) WHERE json_extract(before_json,'$.company_id') IS NOT json_extract(after_json,'$.company_id')`
  statements.push(bind(`DELETE FROM contact_companies WHERE project_id=? AND contact_id IN (SELECT entity_id FROM (${changed}))`,p,id,p))
  statements.push(bind(`INSERT INTO contact_companies(project_id,contact_id,company_id) SELECT ?,r.entity_id,${field('company_id')} FROM (${changed}) r WHERE ${field('company_id')} IS NOT NULL`,p,id,p))
  statements.push(bind(`UPDATE companies SET revision=revision+1,updated_at=? WHERE project_id=? AND id IN (SELECT json_extract(before_json,'$.company_id') FROM (${changed}) UNION SELECT json_extract(after_json,'$.company_id') FROM (${changed}))`,now,p,id,p,id,p))
  if(undo){
   const created=`SELECT entity_id FROM (${rows}) WHERE action='create'`
   statements.push(bind(`INSERT INTO csv_customer_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM context_subjects WHERE project_id=? AND subject_id IN (${created}) AND (consent<>0 OR revision<>0 OR help_types<>'[]' OR bot_enabled<>1)) THEN 1 ELSE 0 END`,p,id,p))
   statements.push(bind(`DELETE FROM context_subjects WHERE project_id=? AND subject_id IN (${created})`,p,id,p))
   statements.push(bind(`DELETE FROM contacts WHERE project_id=? AND id IN (${created})`,p,id,p))
  }
 }else{
  if(!undo)statements.push(bind(`INSERT INTO companies(id,project_id,name,attributes_json,portal_company_view,revision,created_at,updated_at,merged_into) SELECT r.entity_id,?,${['name','attributes_json','portal_company_view','revision','created_at','updated_at','merged_into'].map(field).join(',')} FROM (${rows}) r WHERE r.action='create'`,p,id,p))
  statements.push(bind(`UPDATE companies AS c SET name=${field('name')},attributes_json=${field('attributes_json')},portal_company_view=${field('portal_company_view')},revision=c.revision+1,updated_at=?,merged_into=${field('merged_into')} FROM (${rows}) r WHERE c.project_id=? AND c.id=r.entity_id AND r.action='update'`,now,id,p,p))
  statements.push(bind(`DELETE FROM company_domains WHERE project_id=? AND company_id IN (SELECT entity_id FROM (${rows}))`,p,id,p))
  statements.push(bind(`INSERT INTO company_domains(project_id,domain,company_id) SELECT ?,d.value,r.entity_id FROM (${rows}) r JOIN json_each(${field('domains')}) d WHERE r.image<>'null'`,p,id,p))
  if(undo)statements.push(bind(`DELETE FROM companies WHERE project_id=? AND id IN (SELECT entity_id FROM (${rows}) WHERE action='create')`,p,id,p))
 }
 return statements
}
