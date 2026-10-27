import type {Env} from '../../platform/env'
/** Workspace labels stay separate from the customer membership offer. */
export async function workspaceAccountOptions(env:Env,projectId:string,history=false){
 const rows=await env.DB.prepare(`SELECT id,name,merged_into FROM companies WHERE project_id=? ${history?'':'AND merged_into IS NULL'} ORDER BY name,id`).bind(projectId).all<{id:string;name:string;merged_into:string|null}>()
 return rows.results.map(row=>({value:row.id,label:row.name,disabled:!!row.merged_into}))
}
