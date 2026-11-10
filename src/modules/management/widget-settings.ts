import {campaignRoutes} from '../widget/campaigns/routes'
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
import {saveSettings} from './settings-save'
import {proactiveHelpOn} from '../customer-context/widget-policy'
export const widgetSettings=new Hono<AppEnv>()
widgetSettings.route('/',campaignRoutes)
export const publicWidget=new Hono<AppEnv>()
/** The installation's origin, which makes a stored root-relative image URL (an imported file's) absolute on a customer's site. */
const appOrigin=(c:any)=>new URL(String(c.env.APP_ORIGIN||c.req.url)).origin
const absolute=(origin:string|undefined,value:unknown)=>origin&&typeof value==='string'&&/^\/(?!\/)/.test(value)?origin+value:value
const withAvatar=<T extends {avatar_url?:unknown}>(origin:string|undefined)=>(row:T):T=>row.avatar_url?{...row,avatar_url:absolute(origin,row.avatar_url)}:row
/** A workspace imported from legacy shows an unassigned visitor its team as the workspace, as legacy did: "<name> Team" with the workspace's image. */
function workspaceTeam(brand:{name:string;avatar_url:string;logo_url:string}){return {id:null,name:`${brand.name} Team`,initials:brand.name.split(/\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase(),...(brand.avatar_url||brand.logo_url?{avatar_url:brand.avatar_url||brand.logo_url}:{})}}
export async function settingsFor(env:AppEnv['Bindings'],projectId:string,origin?:string){const project=await env.DB.prepare('SELECT p.id,p.name,p.allowed_origin,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.id=?').bind(projectId).first<any>();if(!project)throw new HTTPException(404);const settings=JSON.parse(project.settings_json||'{}');if(settings.deleted_at)throw new HTTPException(404);const agents=(await env.DB.prepare("SELECT u.id,u.name,s.avatar_url FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN user_settings s ON s.user_id=u.id WHERE m.project_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.id").bind(projectId).all()).results.map(person).map(withAvatar(origin)),ais=(await env.DB.prepare('SELECT id,name,role,avatar_url,is_animated FROM ai_profiles WHERE project_id=? AND is_enabled=1').bind(projectId).all()).results.map(withAvatar(origin));const appearance=publicAppearance(settings,project.name),brand={...appearance,logo_url:absolute(origin,appearance.logo_url) as string,avatar_url:absolute(origin,appearance.avatar_url) as string,brand_image_url:absolute(origin,appearance.brand_image_url) as string};const campaignTiming=await env.DB.prepare("SELECT min(max(json_extract(config_json,'$.delaySeconds'),CASE WHEN json_extract(config_json,'$.trigger.type')='time' THEN json_extract(config_json,'$.trigger.seconds') ELSE 0 END)) delay FROM widget_campaigns WHERE project_id=? AND json_extract(config_json,'$.enabled')=1").bind(projectId).first<{delay:number|null}>();return {campaignsEnabled:campaignTiming?.delay!=null,campaignsStartAfter:campaignTiming?.delay??0,mailMode:emailMode(env),availability:await teamAvailability(env,projectId,settings),projectId,project:{id:project.id,name:project.name},settings:settings.widget_settings||{},brand,agents,ais,currentAgent:settings.widget_team_display==='workspace'?workspaceTeam(brand):agents[0]||null,is_human_response_enabled:settings.is_human_response_enabled!==false,collectorEnabled:settings.is_contact_tracking_enabled===true,proactiveHelpEnabled:proactiveHelpOn(settings),allowedOrigin:project.allowed_origin}}
widgetSettings.get('/projects/:projectId/widget-settings',async c=>{const a=await scope(c),value=await settingsFor(c.env,a.projectId,appOrigin(c));const secret=await c.env.DB.prepare('SELECT verification_secret,widget_key FROM projects WHERE id=?').bind(a.projectId).first<{verification_secret:string;widget_key:string}>();return c.json({...value,appOrigin:String(c.env.APP_ORIGIN||new URL(c.req.url).origin),previewAgent:value.currentAgent,previewBrand:value.brand,widgetKey:secret?.widget_key,verificationSecret:['owner','admin'].includes(a.role)?secret?.verification_secret:undefined})})
widgetSettings.put('/projects/:projectId/widget-settings',async c=>{
 const a=await scope(c,true),input=await c.req.json()
 if(!input||Array.isArray(input)||typeof input!=='object'||JSON.stringify(input).length>30000)throw new HTTPException(400)
 const {allowed_origin,...settings}=input
 const origin=allowed_origin===undefined?undefined:websiteAddress(allowed_origin,'Widget website origin',true)
 await saveSettings(c.env,a.projectId,{widget_settings:settings},(_old,_value,guard)=>origin?[c.env.DB.prepare(`UPDATE projects SET allowed_origin=? WHERE id=? AND ${guard.sql}`).bind(origin,a.projectId,...guard.params)]:[])
 return c.json({settings,...(origin?{allowedOrigin:origin}:{})})
})
publicWidget.get('/settings',async c=>{const project=await c.env.DB.prepare('SELECT id,allowed_origin FROM projects WHERE widget_key=?').bind(c.req.query('widgetKey')||'').first<{id:string;allowed_origin:string}>();if(!project)throw new HTTPException(403);const origin=c.req.header('Origin')||new URL(c.req.url).origin;if(origin!==project.allowed_origin&&origin!==new URL(c.req.url).origin){if(origin!==c.env.PREVIEW_ORIGIN||!await c.env.DB.prepare('SELECT token_hash FROM preview_grants WHERE project_id=? AND token_hash=? AND expires_at>? AND remaining_requests>0').bind(project.id,await hashToken(c.req.query('previewToken')||''),Date.now()).first())throw new HTTPException(403)}return c.json(await settingsFor(c.env,project.id,appOrigin(c)))})
