import {Hono} from 'hono'
import {DoorError,verifyRerGrant} from '@runeditrun/rer/modules/import-kit/door'
import type {AppEnv} from '../../platform/env'
import {installationTrust} from '../../edition/agent-door/index'

/** A signed aggregate read of the installation's native Business workspace. */
export const cutoverStatus=new Hono<AppEnv>()
cutoverStatus.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
cutoverStatus.post('/',async c=>{
 let trust
 try{trust=installationTrust(c.env,typeof c.env.APP_ORIGIN==='string'?new URL(c.env.APP_ORIGIN).origin:new URL(c.req.url).origin)}
 catch{return c.json({error:'invalid_configuration'},503)}
 if(!trust)return c.json({error:'invalid_configuration'},503)
 // Neither the request nor the grant selects a destination or supplies owner trust.
 const owner=await c.env.DB.prepare(`SELECT b.project_id,u.email FROM h2h_business_project b
  JOIN owner_setup o ON o.singleton=1 AND o.claim_id=b.owner_user_id
  JOIN users u ON u.id=b.owner_user_id
  JOIN memberships m ON m.project_id=b.project_id AND m.user_id=u.id AND m.role='owner'
  JOIN projects p ON p.id=b.project_id LEFT JOIN project_settings ps ON ps.project_id=p.id
  WHERE b.singleton=1 AND json_extract(COALESCE(ps.settings_json,'{}'),'$.deleted_at') IS NULL
   AND json_extract(COALESCE(ps.settings_json,'{}'),'$.suspended_at') IS NULL`).first<{project_id:string;email:string}>()
 if(!owner)return c.json({error:'native_project_required'},409)
 try{await verifyRerGrant(c.req.raw,{...trust,expectedEmail:owner.email},'cutover-status')}
 catch(error){if(error instanceof DoorError)return c.json({error:error.code},error.status as 401|403|503);throw error}
 const body:unknown=await c.req.json().catch(()=>null)
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('since' in body)
  ||typeof body.since!=='string'||body.since.length>64)return c.json({error:'invalid_request'},400)
 const since=Date.parse(body.since)
 if(!Number.isFinite(since)||new Date(since).toISOString()!==body.since)return c.json({error:'invalid_request'},400)
 // One SQLite snapshot. Outbox rows are committed message events, not page views,
 // delivery receipts or a second count of their messages. Erased records stay out.
 const row=await c.env.DB.prepare(`SELECT
  (SELECT count(*) FROM conversations WHERE project_id=?1 AND created_at>?2) AS conversations,
  (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id
   WHERE m.project_id=?1 AND m.created_at>?2) AS messages,
  count(CASE WHEN o.created_at>?2 THEN 1 END) AS events,
  max(o.created_at) AS last_event_at
  FROM conversation_outbox o JOIN messages m ON m.id=o.message_id AND m.project_id=o.project_id AND m.conversation_id=o.conversation_id
  JOIN conversations c ON c.id=o.conversation_id AND c.project_id=o.project_id WHERE o.project_id=?1`).bind(owner.project_id,since)
  .first<{conversations:number;messages:number;events:number;last_event_at:number|null}>()
 if(!row)return c.json({error:'status_unavailable'},503)
 return c.json({created_since:{conversations:row.conversations,messages:row.messages},events_since:row.events,
  last_event_at:row.last_event_at===null?null:new Date(row.last_event_at).toISOString()})
})
cutoverStatus.all('/',c=>c.json({error:'method_not_allowed'},405))
