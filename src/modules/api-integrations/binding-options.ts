import type {Env} from '../../platform/env'

/** Names and IDs only, scoped to the same workspace as the credential issuer. */
export async function bindingOptions(env:Env,project:string,credentials:any[]){
 const [brands,mailboxes,groups,forms,tags]=await env.DB.batch<{id:string;name:string}>([
  env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(project),
  env.DB.prepare("SELECT id,CASE WHEN display_name<>'' THEN display_name||' ('||address||')' ELSE address END name FROM mailbox_connections WHERE project_id=? ORDER BY name,id").bind(project),
  env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=? ORDER BY name,id').bind(project),
  env.DB.prepare("SELECT id,json_extract(config_json,'$.title') name FROM request_forms WHERE project_id=? ORDER BY name,id").bind(project),
  env.DB.prepare('SELECT id,name FROM workspace_tags WHERE project_id=? ORDER BY name,id').bind(project),
 ])
 return {brands:brands.results,mailboxes:mailboxes.results,groups:groups.results,forms:forms.results,tags:tags.results,
  priorities:['low','normal','high','urgent'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1)})),
  credentials:credentials.map(row=>({id:row.id,name:row.name}))}
}
