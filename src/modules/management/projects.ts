import {brandReports} from './brand-reports'
import {brands} from './brands'
import {recentMailboxProof} from '../identity/two-factor/state'
import {inboxCounts} from './inbox-counts'
import {validTimezone} from '../reports/calendar'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../../platform/env'
import { requireActor } from '../../platform/auth'
import { id,requiredString,serverSecret } from '../../platform/db'
import { clientAddress,enforceRateLimits } from '../../platform/rate-limits'
import {person} from './dashboard-data'
import {artworkUrl} from './workspace-artwork'
import {scope,text,url,decode} from './common'
import {isPlatformAdmin} from './admin'
import {appearanceSettings} from './appearance-settings'
import {workspaceDefaults} from './provisioning/index'
import {notificationPreference} from './member-updates'
import {websiteAddress} from './website-address'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {accountAudit} from '../identity/two-factor/factors'
import {projectAccess} from '../access/catalogue'
export const projects=new Hono<AppEnv>()
projects.route('/',brandReports).route('/',brands)
projects.get('/bootstrap',async c=>{
 const actor=await requireActor(c)
 if(actor.role==='contact')throw new HTTPException(403)
 if(!actor.projectId){
  const [currentAgent,platformAdmin]=await Promise.all([
   c.env.DB.prepare('SELECT id,name,email FROM users WHERE id=?').bind(actor.id).first(),
   isPlatformAdmin(c.env.DB,actor.id)
  ])
  return c.json({currentAgent:person(currentAgent),projects:{},project:null,agents:[],ais:[],plugins:[],accountOnly:true,sessionProjectId:null,isPlatformAdmin:platformAdmin})
 }
 // The actor is already authenticated. Select every workspace's related rows in
 // one round trip instead of authenticating again and reading three times per workspace.
 const [data,platformAdmin]=await Promise.all([c.env.DB.batch<any>([
  c.env.DB.prepare('SELECT p.id,p.name,p.widget_key,p.allowed_origin,p.created_at,ps.settings_json,m.role,coalesce(pref.is_primary,0) is_primary,mr.role_key access_key,pr.name access_name,pr.base access_base,pr.permissions_json access_permissions FROM projects p LEFT JOIN project_settings ps ON ps.project_id=p.id JOIN memberships m ON m.project_id=p.id LEFT JOIN user_project_preferences pref ON pref.project_id=p.id AND pref.user_id=m.user_id LEFT JOIN member_roles mr ON mr.project_id=p.id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.id=mr.role_key AND pr.project_id=p.id WHERE m.user_id=?').bind(actor.id),
  c.env.DB.prepare('SELECT m.project_id hydration_project_id,u.id,u.name,u.email,m.role,s.avatar_url,mr.role_key access_role FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id WHERE EXISTS(SELECT 1 FROM memberships mine WHERE mine.project_id=m.project_id AND mine.user_id=?)').bind(actor.id),
  c.env.DB.prepare('SELECT a.* FROM ai_profiles a WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=a.project_id AND m.user_id=?)').bind(actor.id),
  c.env.DB.prepare('SELECT p.* FROM plugins p WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=p.project_id AND m.user_id=?) ORDER BY p.sort_order,p.id').bind(actor.id),
  c.env.DB.prepare('SELECT u.id,u.name,u.email,s.avatar_url FROM users u LEFT JOIN user_settings s ON s.user_id=u.id WHERE u.id=?').bind(actor.id)
 ]),isPlatformAdmin(c.env.DB,actor.id)])
 const map:Record<string,any>={}
 const projectId=c.req.param('projectId')||c.req.query('projectId')||actor.projectId
 for(const p of data[0].results){
  const {settings_json,access_key,access_name,access_base,access_permissions,...summary}=p,appearance=JSON.parse(String(settings_json||'{}'))
  // Preserve scope()'s current-workspace denial, including a deleted workspace.
  if(p.id===projectId&&appearance.deleted_at!=null)throw new HTTPException(403,{message:'Project not found, or you do not have access to it'})
  map[String(p.id)]={...summary,access:projectAccess(p.role,access_key,access_name,access_base,access_permissions),is_demo:appearance.is_demo===true,sidebar_artwork_url:artworkUrl(String(p.id),appearance.sidebar_artwork_id),sidebar_artwork_enabled:appearance.sidebar_artwork_enabled===true,primary_color:appearance.primary_color||null,display_mode:appearance.display_mode||null,brand_image_url:appearance.brand_image_url||null,avatar_url:appearance.avatar_url||null,agents:[],ais:[],plugins:[]}
 }
 const project=map[projectId]
 if(!project)throw new HTTPException(403,{message:'Project not found, or you do not have access to it'})
 for(const {hydration_project_id,...agent} of data[1].results)map[String(hydration_project_id)].agents.push(agent)
 for(const ai of data[2].results)map[String(ai.project_id)].ais.push(ai)
 for(const plugin of data[3].results)map[String(plugin.project_id)].plugins.push(plugin)
 const inbox=c.req.query('inbox')
 const inboxViewCounts=inbox==='global'||inbox==='project'?await inboxCounts(c.env,actor.id,inbox==='global'?undefined:projectId):undefined
 return c.json({inboxViewCounts,currentAgent:person(data[4].results[0]),projects:map,project,sessionProjectId:actor.projectId,isPlatformAdmin:platformAdmin,agents:project.agents.map(person),ais:project.ais,plugins:project.plugins})
})
projects.get('/projects',async c=>{const a=await scope(c);return c.json({data:(await c.env.DB.prepare('SELECT p.id,p.name,p.widget_key,p.allowed_origin,p.created_at,m.role,coalesce(pref.is_primary,0) is_primary FROM projects p JOIN memberships m ON m.project_id=p.id LEFT JOIN user_project_preferences pref ON pref.project_id=p.id AND pref.user_id=m.user_id WHERE m.user_id=?').bind(a.id).all()).results})})
projects.post('/projects',async c=>{
 const a=await requireActor(c);if(a.role==='contact')throw new HTTPException(403);await enforceRateLimits(c.env,[['projectsPerAccountDay',a.id],['projectsPerIpDay',clientAddress(c.req)]])
 const b=await c.req.json(),projectId=id(),name=requiredString(b.name,'name',200),origin=new URL(url(b.allowed_origin||b.allowedOrigin)).origin
 const owner=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(a.id).first<{email:string}>()
 const defaults=workspaceDefaults(c.env,{projectId,name,website:origin,ownerEmail:owner?.email||''})
 await c.env.DB.batch<any>([c.env.DB.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at,verification_secret) VALUES(?,?,?,?,?,?)').bind(projectId,name,id(),origin,Date.now(),serverSecret()),c.env.DB.prepare("INSERT INTO memberships VALUES(?,?,'owner')").bind(projectId,a.id),...defaults.statements])
 await defaults.after()
 return c.json({id:projectId,name,allowed_origin:origin},201)
})
projects.get('/projects/:projectId/settings',async c=>{const a=await scope(c);return c.json({data:decode(await c.env.DB.prepare('SELECT p.id,p.name,p.widget_key,p.allowed_origin,p.created_at,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.id=?').bind(a.projectId).first())})})
projects.put('/projects/:projectId/settings',async c=>{
 const a=await scope(c,true),b=await c.req.json(),appearance=appearanceSettings(b)
 if('timezone' in b&&!validTimezone(b.timezone))throw new HTTPException(400,{message:'Choose a valid IANA timezone'})
 const existing=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(a.projectId).first<{settings_json:string}>()
 const settings={...JSON.parse(existing?.settings_json||'{}'),...appearance}
 if('display_mode' in b){if(!['balanced','light','dark'].includes(b.display_mode))throw new HTTPException(400,{message:'Invalid display mode'});settings.display_mode=b.display_mode}
 for(const key of ['language','timezone','widget_position','default_responder','website','notification_email','unavailable_message'])if(key in b)settings[key]=text(b[key])
 if('help_center_domain' in b)settings.help_center_domain=b.help_center_domain===''?'':websiteAddress(b.help_center_domain,'Custom Help Center URL')
 for(const key of ['sidebar_artwork_enabled','is_enabled','collect_email','collector_enabled','disable_bots','is_contact_tracking_enabled','proactive_help_enabled','is_human_response_enabled','is_available'])if(key in b)settings[key]=Boolean(b[key])
 const statements=[c.env.DB.prepare('INSERT INTO project_settings VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').bind(a.projectId,JSON.stringify(settings),Date.now())]
 if(b.name)statements.push(c.env.DB.prepare('UPDATE projects SET name=? WHERE id=?').bind(requiredString(b.name,'name',200),a.projectId))
 if(b.allowed_origin)statements.push(c.env.DB.prepare('UPDATE projects SET allowed_origin=? WHERE id=?').bind(websiteAddress(b.allowed_origin,'Widget website origin',true),a.projectId))
 await c.env.DB.batch(statements)
 return c.json({data:settings})
})
projects.get('/profile',async c=>{const a=await scope(c);return c.json({data:{...await c.env.DB.prepare('SELECT u.id,u.name,u.email,u.created_at,EXISTS(SELECT 1 FROM credentials cr WHERE cr.user_id=u.id) has_password,s.timezone,s.avatar_url,s.is_notifiable_on_conversation_assignment,coalesce(pref.is_notified_on_unassigned_activity,0) is_notified_on_unassigned_activity FROM users u LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN user_project_preferences pref ON pref.user_id=u.id AND pref.project_id=? WHERE u.id=?').bind(a.projectId,a.id).first<Record<string,unknown>>(),mailbox_confirmed:recentMailboxProof(a.security!),has_second_factor:Boolean(a.security?.hasFactor)}})})
projects.put('/profile',async c=>{const a=await scope(c),b=await c.req.json(),old=await c.env.DB.prepare('SELECT * FROM user_settings WHERE user_id=?').bind(a.id).first<any>();const name=requiredString(b.name,'name',200),timezone=b.timezone?text(b.timezone,100):old?.timezone||'UTC';try{new Intl.DateTimeFormat('en',{timeZone:timezone})}catch{throw new HTTPException(400,{message:'Invalid timezone'})}const email=b.email?requiredString(b.email,'email',320).toLowerCase():null;if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HTTPException(400,{message:'Invalid email'});if(email&&await c.env.DB.prepare('SELECT id FROM users WHERE lower(email)=? AND id<>?').bind(email,a.id).first())throw new HTTPException(409,{message:'Email is already registered'});
 // The sign-in email is where password resets go, so changing it is a credential change: it needs a recent step-up.
 const emailChanged=email!==null&&email!==(await c.env.DB.prepare('SELECT lower(email) email FROM users WHERE id=?').bind(a.id).first<{email:string}>())?.email
 if(emailChanged)await requireStepUp(c,a,'account.email')
 const statements=[...(emailChanged?await accountAudit(c.env.DB,a.id,{category:'auth',action:'account.email_changed',actor:{type:'user',id:a.id},source:requestSource(c)}):[]),c.env.DB.prepare('UPDATE users SET name=?,email=coalesce(?,email) WHERE id=?').bind(name,email,a.id),c.env.DB.prepare('INSERT INTO user_settings(user_id,timezone,avatar_url,is_notifiable_on_conversation_assignment) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone,avatar_url=excluded.avatar_url,is_notifiable_on_conversation_assignment=excluded.is_notifiable_on_conversation_assignment').bind(a.id,timezone,b.avatar_url?url(b.avatar_url):old?.avatar_url||null,'is_notifiable_on_conversation_assignment' in b?(b.is_notifiable_on_conversation_assignment?1:0):old?.is_notifiable_on_conversation_assignment??1)];if('is_notified_on_unassigned_activity' in b)statements.push(notificationPreference(c.env.DB,a.projectId,a.id,b.is_notified_on_unassigned_activity));await c.env.DB.batch(statements);return c.json({data:{id:a.id,name,timezone}})})
projects.delete('/projects/:projectId',async c=>{
 const a=await scope(c,true)
 if(a.role!=='owner')throw new HTTPException(403)
 await requireStepUp(c,a,'project.delete')
 const now=Date.now()
 // Recorded before the workspace closes: its log outlives it.
 await auditStatement(c.env.DB,{projectId:a.projectId,category:'data',action:'project.deleted',actor:{type:'user',id:a.id},source:requestSource(c)},now).run()
 const archiveSettings=c.env.DB.prepare(`
   INSERT INTO project_settings(project_id,settings_json,updated_at)
   SELECT
     ?,
     json_set(
       coalesce((SELECT settings_json FROM project_settings WHERE project_id=?),'{}'),
       '$.retired_inbound_address',
       coalesce(
         (SELECT inbound_address FROM email_settings WHERE project_id=?),
         json_extract(coalesce((SELECT settings_json FROM project_settings WHERE project_id=?),'{}'),'$.retired_inbound_address')
       ),
       '$.mailbox_archived_at',?,
       '$.deleted_at',?
     ),
     ?
   ON CONFLICT(project_id) DO UPDATE SET
     settings_json=excluded.settings_json,
     updated_at=excluded.updated_at
 `).bind(a.projectId,a.projectId,a.projectId,a.projectId,now,now,now)
 await c.env.DB.batch<any>([
  archiveSettings,
  c.env.DB.prepare('UPDATE email_settings SET inbound_address=NULL,is_enabled=0,updated_at=? WHERE project_id=?').bind(now,a.projectId),
  c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE project_id=?').bind(now,a.projectId),
  c.env.DB.prepare("UPDATE identity_tokens SET consumed_at=COALESCE(consumed_at,?) WHERE project_id=? AND kind='invite'").bind(now,a.projectId),
  c.env.DB.prepare('DELETE FROM memberships WHERE project_id=?').bind(a.projectId),
  c.env.DB.prepare('DELETE FROM operator_presence WHERE project_id=?').bind(a.projectId),
  c.env.DB.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_blocked',1) WHERE project_id=?").bind(a.projectId),
  c.env.DB.prepare('UPDATE projects SET widget_key=?,allowed_origin=? WHERE id=?').bind(id(),'https://deleted.invalid',a.projectId),
  c.env.DB.prepare("UPDATE ai_profiles SET is_enabled=0 WHERE project_id=?").bind(a.projectId),
  c.env.DB.prepare("UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND state='queued'").bind(new Date().toISOString(),a.projectId)
 ])
 return c.json({deleted:true,retainedHistory:true})
})
