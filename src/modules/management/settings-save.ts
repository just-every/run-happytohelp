import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'

export type SettingsGuard={sql:string;params:unknown[]}

/** Compare the complete stored snapshot inside the write transaction. Every companion
 * statement uses the same guard before the settings write; a lost race changes nothing
 * and retries from the winner's values, including mode-change clocks and audit details. */
export async function saveSettings(env:Env,projectId:string,patch:Record<string,unknown>|((old:any)=>Record<string,unknown>),also:(old:any,value:any,guard:SettingsGuard)=>D1PreparedStatement[]=()=>[]){
 for(let attempt=0;attempt<5;attempt++){
  const row=await env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(projectId).first<{settings_json:string}>()
  const snapshot=row?.settings_json??'{}',old=JSON.parse(snapshot),value={...old,...(typeof patch==='function'?patch(old):patch)}
  const guard={sql:"coalesce((SELECT settings_json FROM project_settings WHERE project_id=?),'{}')=?",params:[projectId,snapshot]}
  const results=await env.DB.batch([
   ...also(old,value,guard),
   env.DB.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) SELECT ?,?,? WHERE ${guard.sql} ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at`).bind(projectId,JSON.stringify(value),Date.now(),...guard.params),
  ])
  if(results.at(-1)!.meta.changes)return value
 }
 throw new HTTPException(409,{message:'Workspace settings changed while saving. Please try again.'})
}
