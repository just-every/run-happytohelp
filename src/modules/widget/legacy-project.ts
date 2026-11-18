import {widgetAddressAllowed} from './allowed-addresses'
import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'

/** Resolve an imported public project id/slug to native admission, never to a session. */
export const legacyWidget = new Hono<AppEnv>()
legacyWidget.get('/legacy-project', async c => {
 c.header('Cache-Control','no-store')
 const key=c.req.query('projectId') || ''
 if(!key || key.length>200)return c.json({error:'A legacy project id is required'},400)
 const project=await c.env.DB.prepare(`SELECT p.id,p.widget_key,p.allowed_origin FROM projects p
 LEFT JOIN public_project_aliases a ON a.project_id=p.id
 WHERE (p.id=? OR a.slug=?) AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL) LIMIT 1`)
 .bind(key,key).first<{id:string;widget_key:string;allowed_origin:string}>()
 const origin=c.req.header('Origin') || new URL(c.req.url).origin
 if(!project || origin!==new URL(c.req.url).origin && origin!==project.allowed_origin && !await widgetAddressAllowed(c.env,project.id,origin))return c.json({error:'Widget project is unavailable on this origin'},403)
 return c.json({widgetKey:project.widget_key})
})
