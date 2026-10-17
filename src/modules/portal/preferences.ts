import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {auditStatement} from '../audit/record'
import {portalSessionGuard,type PortalIdentity} from './identity'

export async function readPortalPreferences(env:Env,identity:PortalIdentity){
 const guard=portalSessionGuard(identity)
 const row=await env.DB.prepare(`SELECT ct.email,COALESCE(p.locale,'en') locale,COALESCE(p.update_emails,1) updateEmails,NOT EXISTS(SELECT 1 FROM csat_optouts o WHERE o.project_id=ct.project_id AND o.contact_id=ct.id) surveyEmails FROM contacts ct LEFT JOIN portal_preferences p ON p.project_id=ct.project_id AND p.contact_id=ct.id WHERE ct.id=? AND ct.project_id=? AND ${guard.sql}`).bind(identity.actor.id,identity.actor.projectId,...guard.args).first<any>()
 if(!row)throw new HTTPException(401)
 return {...row,surveyEmails:Boolean(row.surveyEmails),updateEmails:Boolean(row.updateEmails)}
}
export async function savePortalPreferences(env:Env,identity:PortalIdentity,body:any){
 const locale=body.locale??'en',surveyEmails=body.surveyEmails,updateEmails=body.updateEmails
 if(!['en','es','fr'].includes(locale)||typeof surveyEmails!=='boolean'||typeof updateEmails!=='boolean')throw new HTTPException(400,{message:'Choose a language and email preferences'})
 const guard=portalSessionGuard(identity),now=Date.now(),{actor}=identity
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO portal_preferences(project_id,contact_id,locale,update_emails,updated_at) SELECT ?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(project_id,contact_id) DO UPDATE SET locale=excluded.locale,update_emails=excluded.update_emails,updated_at=excluded.updated_at`).bind(actor.projectId,actor.id,locale,updateEmails?1:0,now,...guard.args),
  env.DB.prepare(`UPDATE contacts SET metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.portal_notification_emails',?) WHERE project_id=? AND id=? AND ${guard.sql}`).bind(updateEmails?1:0,actor.projectId,actor.id,...guard.args),
  surveyEmails?env.DB.prepare(`DELETE FROM csat_optouts WHERE project_id=? AND contact_id=? AND ${guard.sql}`).bind(actor.projectId,actor.id,...guard.args):env.DB.prepare(`INSERT OR IGNORE INTO csat_optouts(project_id,contact_id,created_at) SELECT ?,?,? WHERE ${guard.sql}`).bind(actor.projectId,actor.id,now,...guard.args),
  ...(!surveyEmails?[env.DB.prepare(`UPDATE csat_surveys SET revoked_at=?,updated_at=?,state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END WHERE project_id=? AND contact_id=? AND ${guard.sql}`).bind(now,now,actor.projectId,actor.id,...guard.args)]:[])
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Access changed. Sign in again.'})
 await auditStatement(env.DB,{projectId:actor.projectId,category:'data',action:'portal.preferences.updated',actor:{type:'system'},source:'api',detail:{locale,surveyEmails,updateEmails}}).run()
 return readPortalPreferences(env,identity)
}
