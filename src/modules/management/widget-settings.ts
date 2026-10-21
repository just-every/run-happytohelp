import {emailMode} from '../integrations/email-provider'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {teamAvailability} from './live-availability'
import {hashToken} from '../../platform/auth'
import {scope} from './common'
import {websiteAddress} from './website-address'
import {person} from './dashboard-data'
import {publicAppearance} from '../widget/appearance.js'
export const widgetSettings=new Hono<AppEnv>()
export const publicWidget=new Hono<AppEnv>()
export async function settingsFor(env:AppEnv['Bindings'],projectId:string){const project=await env.DB.prepare('SELECT p.id,p.name,p.allowed_origin,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.id=?').bind(projectId).first<any>();if(!project)throw new HTTPException(404);const settings=JSON.parse(project.settings_json||'{}');if(settings.deleted_at)throw new HTTPException(404);const agents=(await env.DB.prepare("SELECT u.id,u.name,s.avatar_url FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN user_settings s ON s.user_id=u.id WHERE m.project_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.id").bind(projectId).all()).results.map(person),ais=(await env.DB.prepare('SELECT id,name,role,avatar_url,is_animated FROM ai_profiles WHERE project_id=? AND is_enabled=1').bind(projectId).all()).results;return {mailMode:emailMode(env),availability:await teamAvailability(env,projectId,settings),projectId,project:{id:project.id,name:project.name},settings:settings.widget_settings||{},brand:publicAppearance(settings,project.name),agents,ais,currentAgent:agents[0]||null,is_human_response_enabled:settings.is_human_response_enabled!==false,collectorEnabled:settings.is_contact_tracking_enabled===true,proactiveHelpEnabled:settings.proactive_help_enabled===true&&settings.is_contact_tracking_enabled===true,allowedOrigin:project.allowed_origin}}
widgetSettings.get('/projects/:projectId/widget-settings',async c=>{const a=await scope(c),value=await settingsFor(c.env,a.projectId);const secret=await c.env.DB.prepare('SELECT verification_secret,widget_key FROM projects WHERE id=?').bind(a.projectId).first<{verification_secret:string;widget_key:string}>();return c.json({...value,appOrigin:String(c.env.APP_ORIGIN||new URL(c.req.url).origin),previewAgent:value.currentAgent,previewBrand:value.brand,widgetKey:secret?.widget_key,verificationSecret:['owner','admin'].includes(a.role)?secret?.verification_secret:undefined})})
widgetSettings.put('/projects/:projectId/widget-settings',async c=>{
 const a=await scope(c,true),input=await c.req.json()
 if(!input||Array.isArray(input)||typeof input!=='object'||JSON.stringify(input).length>30000)throw new HTTPException(400)
 const {allowed_origin,...settings}=input
 const origin=allowed_origin===undefined?undefined:websiteAddress(allowed_origin,'Widget website origin',true)
 const old=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(a.projectId).first<{settings_json:string}>(),value=JSON.parse(old?.settings_json||'{}')
 value.widget_settings=settings
 const statements=[c.env.DB.prepare('INSERT INTO project_settings VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').bind(a.projectId,JSON.stringify(value),Date.now())]
 if(origin)statements.push(c.env.DB.prepare('UPDATE projects SET allowed_origin=? WHERE id=?').bind(origin,a.projectId))
 await c.env.DB.batch(statements)
 return c.json({settings,...(origin?{allowedOrigin:origin}:{})})
})
publicWidget.get('/settings',async c=>{const project=await c.env.DB.prepare('SELECT id,allowed_origin FROM projects WHERE widget_key=?').bind(c.req.query('widgetKey')||'').first<{id:string;allowed_origin:string}>();if(!project)throw new HTTPException(403);const origin=c.req.header('Origin')||new URL(c.req.url).origin;if(origin!==project.allowed_origin&&origin!==new URL(c.req.url).origin){if(origin!==c.env.PREVIEW_ORIGIN||!await c.env.DB.prepare('SELECT token_hash FROM preview_grants WHERE project_id=? AND token_hash=? AND expires_at>? AND remaining_requests>0').bind(project.id,await hashToken(c.req.query('previewToken')||''),Date.now()).first())throw new HTTPException(403)}return c.json(await settingsFor(c.env,project.id))})
