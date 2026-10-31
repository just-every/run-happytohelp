import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {clockSql,mobileActor,stillAuthorized} from './authority'
import {objectBody} from './commands'
import {prepareMobileNotices,redactedPush} from './push'
export const mobilePushRoutes=new Hono<AppEnv>()
mobilePushRoutes.put('/push',async c=>{
 const a=await mobileActor(c,'push'),b=objectBody(await c.req.json())
 if(typeof b.enabled!=='boolean'||Object.keys(b).some(k=>k!=='enabled'))throw new HTTPException(400,{message:'Provide the enabled flag; provider registration is not available yet'})
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`DELETE FROM mobile_links WHERE device_id=? AND ${a.guard.sql}`).bind(a.device.id,...a.guard.params),
  c.env.DB.prepare(`UPDATE mobile_devices SET push_enabled=? WHERE id=? AND ${a.guard.sql}`).bind(b.enabled?1:0,a.device.id,...a.guard.params),
 ])
 if(!result[1].meta.changes)throw new HTTPException(409,{message:'Device authority changed'})
 return c.json({enabled:b.enabled,delivery:'not-configured'})
})
mobilePushRoutes.get('/push/prepared',async c=>{
 const a=await mobileActor(c,'push')
 await prepareMobileNotices(c.env,a)
 const rows=await c.env.DB.prepare(`SELECT l.id FROM mobile_links l JOIN conversations c ON c.id=l.conversation_id JOIN notification_inbox n ON n.id=l.notice_id WHERE n.inbox=1 AND l.device_id=? AND l.expires_at>${clockSql} AND c.project_id=? AND ${contactAvailableSql()} AND NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.project_id=n.project_id AND p.user_id=n.user_id AND p.kind=n.kind AND p.inbox=0) ORDER BY l.rowid DESC LIMIT 100`).bind(a.device.id,a.actor.projectId).all<{id:string}>()
 await stillAuthorized(c.env,a);return c.json({delivery:'not-configured',payloads:rows.results.map(row=>redactedPush(row.id))})
})
mobilePushRoutes.get('/links/:linkId',async c=>{
 const a=await mobileActor(c),row=await c.env.DB.prepare(`SELECT c.id,c.project_id FROM mobile_links l JOIN conversations c ON c.id=l.conversation_id WHERE l.id=? AND l.device_id=? AND l.expires_at>${clockSql} AND c.project_id=? AND ${contactAvailableSql()} AND ${a.guard.sql}`).bind(c.req.param('linkId'),a.device.id,a.actor.projectId,...a.guard.params).first<{id:string;project_id:string}>()
 if(!row)throw new HTTPException(404,{message:'Link unavailable'})
 return c.json({projectId:row.project_id,ticketId:row.id,path:`/projects/${encodeURIComponent(row.project_id)}/conversations/${encodeURIComponent(row.id)}`})
})
