import {widgetAddressAllowed,recordRejectedAddress} from '../widget/allowed-addresses'
import {listForms} from '../forms/store'
import {campaignRoutes} from '../widget/campaigns/routes'
import {emailMode} from '../integrations/email-provider'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {teamAvailability} from './live-availability'
import {hashToken} from '../../platform/auth'
import {requiredString} from '../../platform/db'
import {scope} from './common'
import {websiteAddress} from './website-address'
import {person} from './dashboard-data'
import {publicAppearance} from '../widget/appearance.js'
import {saveSettings} from './settings-save'
import {primaryWidgetAddressChange,widgetAddressAudit} from './widget-address-changes'
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
export async function settingsFor(env:AppEnv['Bindings'],projectId:string,origin?:string){
 // The widget's project, team, assistants and campaign timing are one D1 round trip.
 const [projects,members,assistants,campaigns]=await env.DB.batch<any>([
  env.DB.prepare('SELECT p.id,p.name,p.allowed_origin,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.id=?').bind(projectId),
  env.DB.prepare("SELECT u.id,u.name,s.avatar_url FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN user_settings s ON s.user_id=u.id WHERE m.project_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.id").bind(projectId),
  env.DB.prepare('SELECT id,name,role,avatar_url,is_animated FROM ai_profiles WHERE project_id=? AND is_enabled=1').bind(projectId),
  env.DB.prepare("SELECT min(max(json_extract(config_json,'$.delaySeconds'),CASE WHEN json_extract(config_json,'$.trigger.type')='time' THEN json_extract(config_json,'$.trigger.seconds') ELSE 0 END)) delay FROM widget_campaigns WHERE project_id=? AND json_extract(config_json,'$.enabled')=1").bind(projectId),
 ])
 const project=projects.results[0];if(!project)throw new HTTPException(404);const settings=JSON.parse(project.settings_json||'{}');if(settings.deleted_at)throw new HTTPException(404);const agents=members.results.map(person).map(withAvatar(origin)),ais=assistants.results.map(withAvatar(origin)),campaignTiming=campaigns.results[0] as {delay:number|null}|undefined;const appearance=publicAppearance(settings,project.name),brand={...appearance,logo_url:absolute(origin,appearance.logo_url) as string,avatar_url:absolute(origin,appearance.avatar_url) as string,brand_image_url:absolute(origin,appearance.brand_image_url) as string};for(const agent of agents){if(String(agent.name||'').trim().toLowerCase()==='owner'){agent.name=`${brand.name} support`;agent.display_name=agent.name;agent.initials=brand.name.split(/\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase()}}return {campaignsEnabled:campaignTiming?.delay!=null,campaignsStartAfter:campaignTiming?.delay??0,mailMode:emailMode(env),availability:await teamAvailability(env,projectId,settings),projectId,project:{id:project.id,name:project.name},settings:settings.widget_settings||{},brand,agents,ais,currentAgent:settings.widget_team_display==='workspace'?workspaceTeam(brand):agents[0]||null,is_human_response_enabled:settings.is_human_response_enabled!==false,collectorEnabled:settings.is_contact_tracking_enabled===true,proactiveHelpEnabled:proactiveHelpOn(settings),allowedOrigin:project.allowed_origin}}
widgetSettings.get('/projects/:projectId/widget-settings',async c=>{const a=await scope(c),value=await settingsFor(c.env,a.projectId,appOrigin(c));const secret=await c.env.DB.prepare('SELECT verification_secret,widget_key FROM projects WHERE id=?').bind(a.projectId).first<{verification_secret:string;widget_key:string}>();return c.json({...value,appOrigin:String(c.env.APP_ORIGIN||new URL(c.req.url).origin),previewAgent:value.currentAgent,previewBrand:value.brand,widgetKey:secret?.widget_key,verificationSecret:['owner','admin'].includes(a.role)?secret?.verification_secret:undefined})})
widgetSettings.put('/projects/:projectId/widget-settings',async c=>{
 const a=await scope(c,true),input=await c.req.json()
 if(!input||Array.isArray(input)||typeof input!=='object'||JSON.stringify(input).length>30000)throw new HTTPException(400)
 const {allowed_origin,...settings}=input
 const origin=allowed_origin===undefined?undefined:websiteAddress(allowed_origin,'Your website address',true)
 await saveSettings(c.env,a.projectId,{widget_settings:settings},(_old,_value,guard)=>origin?primaryWidgetAddressChange(c,a,origin,guard):[])
 return c.json({settings,...(origin?{allowedOrigin:origin}:{})})
})
widgetSettings.get('/projects/:projectId/widget-owner-name',async c=>{
 const a=await scope(c),user=await c.env.DB.prepare('SELECT name FROM users WHERE id=?').bind(a.id).first<{name:string}>(),row=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(a.projectId).first<{settings_json:string}>(),settings=JSON.parse(row?.settings_json||'{}')
 return c.json({name:user?.name||'',confirmed:Array.isArray(settings.widget_named_members)&&settings.widget_named_members.includes(a.id)})
})
widgetSettings.post('/projects/:projectId/widget-owner-name',async c=>{
 const a=await scope(c),body=await c.req.json(),name=requiredString(body.name,'Your name',200).trim()
 if(!name||name.toLowerCase()==='owner')throw new HTTPException(400,{message:'Add the name customers should use for you.'})
 await saveSettings(c.env,a.projectId,old=>({widget_named_members:[...new Set([...(Array.isArray(old.widget_named_members)?old.widget_named_members:[]),a.id])]}),(_old,_value,guard)=>[c.env.DB.prepare(`UPDATE users SET name=? WHERE id=? AND ${guard.sql}`).bind(name,a.id,...guard.params)])
 return c.json({name,confirmed:true})
})
widgetSettings.get('/projects/:projectId/widget-addresses',async c=>{
 const a=await scope(c),row=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(a.projectId).first<{settings_json:string}>(),settings=JSON.parse(row?.settings_json||'{}')
 const rejected=settings.widget_rejected_address
 return c.json({address:typeof rejected==='string'&&!await widgetAddressAllowed(c.env,a.projectId,rejected)?rejected:null,mailMode:emailMode(c.env),allowedAddresses:Array.isArray(settings.widget_allowed_addresses)?settings.widget_allowed_addresses:[],canManage:['owner','admin'].includes(a.role)})
})
widgetSettings.post('/projects/:projectId/widget-addresses',async c=>{
 const a=await scope(c,true),body=await c.req.json(),address=websiteAddress(body.address,'Your website address',true)
 await saveSettings(c.env,a.projectId,old=>{
  const addresses=Array.isArray(old.widget_allowed_addresses)?old.widget_allowed_addresses:[]
  if(addresses.length>=20&&!addresses.includes(address))throw new HTTPException(400,{message:'Your allowed list is full. Ask your developer to review it.'})
  return {widget_allowed_addresses:[...new Set([...addresses,address])]}
 },(old,_value,guard)=>Array.isArray(old.widget_allowed_addresses)&&old.widget_allowed_addresses.includes(address)?[]:[widgetAddressAudit(c,a,'widget.address_allowed',address,guard)])
 return c.json({address})
})
widgetSettings.delete('/projects/:projectId/widget-addresses',async c=>{
 // An old inert wildcard entry can still be removed.
 const a=await scope(c,true),body=await c.req.json(),address=websiteAddress(body.address,'Your website address',true,{allowStoredWildcard:true})
 await saveSettings(c.env,a.projectId,old=>({widget_allowed_addresses:(Array.isArray(old.widget_allowed_addresses)?old.widget_allowed_addresses:[]).filter((value:string)=>value!==address)}),
  (old,_value,guard)=>Array.isArray(old.widget_allowed_addresses)&&old.widget_allowed_addresses.includes(address)?[widgetAddressAudit(c,a,'widget.address_removed',address,guard)]:[])
 return c.json({removed:true})
})
// This response is deliberately public and contains only a configured customer contact link.
publicWidget.get('/contact-route',async c=>{
 const project=await c.env.DB.prepare(`SELECT p.id,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.widget_key=? AND json_extract(COALESCE(s.settings_json,'{}'),'$.deleted_at') IS NULL`).bind(c.req.query('widgetKey')||'').first<{id:string;settings_json:string}>()
 let contactUrl:string|null=null
 if(project){
  const settings=JSON.parse(project.settings_json||'{}')
  try{const url=new URL(settings.help_center_domain);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)contactUrl=url.href}catch{}
  const alias=await c.env.DB.prepare('SELECT slug FROM public_project_aliases WHERE project_id=? ORDER BY slug LIMIT 1').bind(project.id).first<{slug:string}>(),key=encodeURIComponent(alias?.slug||project.id)
  if(!contactUrl&&await c.env.DB.prepare("SELECT 1 FROM knowledge_articles WHERE project_id=? AND status='published' LIMIT 1").bind(project.id).first())contactUrl=appOrigin(c)+'/help/'+key
  if(!contactUrl&&emailMode(c.env)==='remote'){if((await listForms(c.env,project.id)).length)contactUrl=appOrigin(c)+'/help/'+key+'/requests'}
 }
 c.header('Cache-Control','no-store')
 return c.json({contactUrl})
})
publicWidget.get('/settings',async c=>{const project=await c.env.DB.prepare('SELECT id,allowed_origin FROM projects WHERE widget_key=?').bind(c.req.query('widgetKey')||'').first<{id:string;allowed_origin:string}>();if(!project)throw new HTTPException(403);const origin=c.req.header('Origin')||new URL(c.req.url).origin;if(origin!==new URL(c.req.url).origin&&origin!==project.allowed_origin&&!await widgetAddressAllowed(c.env,project.id,origin)){if(origin!==c.env.PREVIEW_ORIGIN||!await c.env.DB.prepare('SELECT token_hash FROM preview_grants WHERE project_id=? AND token_hash=? AND expires_at>? AND remaining_requests>0').bind(project.id,await hashToken(c.req.query('previewToken')||''),Date.now()).first()){await recordRejectedAddress(c.env,c.req.query('widgetKey')||'',origin);throw new HTTPException(403)}}return c.json(await settingsFor(c.env,project.id,appOrigin(c)))})
