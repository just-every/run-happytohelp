import type {Env} from '../../platform/env'
import {decode} from './common'
/** Shared native Settings read. Callers establish current project membership. */
export async function readProjectSettings(env:Env,projectId:string){
 return decode(await env.DB.prepare('SELECT p.id,p.name,p.widget_key,p.allowed_origin,p.created_at,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.id=?').bind(projectId).first())
}
