import type {Env} from '../../platform/env'

/** Additional addresses are explicit owner approvals; the primary address stays editable. */
export async function widgetAddressAllowed(env:Env, projectId:string, address:string) {
 return Boolean(await env.DB.prepare(`SELECT p.id FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id
  WHERE p.id=? AND (p.allowed_origin=? OR EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(s.settings_json,'$.widget_allowed_addresses'),'[]')) WHERE value=?))`).bind(projectId,address,address).first())
}

/** Keep one recent diagnostic, at most one write per five minutes. It grants no authority. */
export async function recordRejectedAddress(env:Env, widgetKey:string, address:string) {
 try {
  const url=new URL(address)
  if(address.length>2000 || url.origin!==address || url.username || url.password || !['https:','http:'].includes(url.protocol))return
 } catch { return }
 await env.DB.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at)
  SELECT p.id,json_object('widget_rejected_address',?,'widget_rejected_at',?),? FROM projects p
  WHERE p.widget_key=? AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)
  ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(project_settings.settings_json,'$.widget_rejected_address',?,'$.widget_rejected_at',?)
  WHERE COALESCE(json_extract(project_settings.settings_json,'$.widget_rejected_at'),0)<?`).bind(address,Date.now(),Date.now(),widgetKey,address,Date.now(),Date.now()-300000).run()
}
