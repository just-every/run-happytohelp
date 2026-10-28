import {ticketScopeSql} from '../../access/ticket-scope'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {auditStatement,requestSource} from '../../audit/record'
import {scope} from '../../management/common'
import {ticketAuthority} from '../../tickets/model'
import {memberAccess} from '../../access/gate'
import {defaultTriggers,renderNotificationTemplate} from './templates'
import {teammateKinds,notificationLabels} from '../notification-kinds'
import {contactAvailableSql} from '../../conversations/contact-privacy'
export const notificationRoutes=new Hono<AppEnv>()
const path='/projects/:projectId'
notificationRoutes.get(`${path}/notification-triggers`,async c=>{
 const actor=await scope(c),rows=await c.env.DB.prepare('SELECT * FROM notification_triggers WHERE project_id=? ORDER BY event,channel,brand_id').bind(actor.projectId).all<any>()
 const defaults=defaultTriggers.filter(d=>!rows.results.some(r=>r.event===d.event&&r.channel==='*'&&r.brand_id==='*'))
 const access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 const claims=await c.env.DB.prepare(`SELECT t.conversation_id,t.event,t.state,t.outcome_json,t.created_at FROM notification_trigger_claims t JOIN conversations c ON c.project_id=t.project_id AND c.id=t.conversation_id WHERE t.project_id=? AND t.event NOT LIKE 'team:%' AND ${ticketScopeSql('?')} ORDER BY t.created_at DESC LIMIT 50`).bind(actor.projectId,actor.id).all<any>()
 return c.json({data:[...defaults,...rows.results],can_manage:['owner','admin'].includes(actor.role)&&access?.permissions.has('settings.manage'),outcomes:claims.results.map(row=>({...row,outcome:JSON.parse(row.outcome_json),outcome_json:undefined}))})
})
notificationRoutes.put(`${path}/notification-triggers`,async c=>{
 const actor=await scope(c,true),access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(!access?.permissions.has('settings.manage'))throw new HTTPException(403)
 const guard=await ticketAuthority(c.env,actor as any,{sessionHash:c.get('sessionHash'),source:'dashboard'},'settings.manage')
 const body=await c.req.json(),entries=body.triggers
 if(!Array.isArray(entries)||!entries.length||entries.length>30)throw new HTTPException(400,{message:'Provide up to 30 trigger templates'})
 const seen=new Set<string>()
 const statements=[]
 for(const entry of entries){
  if(!defaultTriggers.some(d=>d.event===entry.event)||!['*','widget','email','form','api'].includes(entry.channel)||!['*',actor.projectId].includes(entry.brand_id)||![true,false,0,1].includes(entry.enabled))throw new HTTPException(400,{message:'Invalid trigger scope'})
  const key=JSON.stringify([entry.event,entry.channel,entry.brand_id]);if(seen.has(key))throw new HTTPException(400,{message:'Duplicate trigger scope'});seen.add(key)
  for(const [field,max] of [['subject',200],['body',10000],['expected_reply_time',200]] as const)if(typeof entry[field]!=='string'||!entry[field].trim()||entry[field].length>max||field==='subject'&&/[\r\n]/.test(entry[field]))throw new HTTPException(400,{message:`Invalid ${field}`})
  // Validate syntax through the shared macro renderer. Missing values remain
  // visible at actual dispatch, because custom fields depend on the ticket.
  renderNotificationTemplate(entry.subject,placeholderExamples(entry.subject))
  renderNotificationTemplate(entry.body,placeholderExamples(entry.body))
  statements.push(c.env.DB.prepare(`INSERT INTO notification_triggers(project_id,event,channel,brand_id,enabled,subject,body,expected_reply_time,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql})
   ON CONFLICT(project_id,event,channel,brand_id) DO UPDATE SET enabled=excluded.enabled,subject=excluded.subject,body=excluded.body,expected_reply_time=excluded.expected_reply_time,updated_at=excluded.updated_at WHERE EXISTS(${guard.sql})`)
   .bind(actor.projectId,entry.event,entry.channel,entry.brand_id,entry.enabled?1:0,entry.subject,entry.body,entry.expected_reply_time,Date.now(),...guard.params,...guard.params))
 }
 statements.push(auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'notifications.triggers_updated',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'project',id:actor.projectId},detail:{scopes:[...seen]}}))
 await c.env.DB.batch(statements);return c.json({updated:true})
})
function placeholderExamples(text:string){return Object.fromEntries([...text.matchAll(/\{\{\s*([^{}|]+)(?:\|[^{}]*)?\}\}/g)].map(m=>[m[1].trim(),'Example']))}
notificationRoutes.get(`${path}/notification-preferences`,async c=>{
 const actor=await scope(c),rows=await c.env.DB.prepare('SELECT kind,inbox,email FROM notification_preferences WHERE project_id=? AND user_id=?').bind(actor.projectId,actor.id).all<any>()
 const legacy=await c.env.DB.prepare('SELECT is_notifiable_on_conversation_assignment FROM user_settings WHERE user_id=?').bind(actor.id).first<any>()
 return c.json({data:teammateKinds.map(kind=>({kind,inbox:true,email:kind==='assignment'?legacy?.is_notifiable_on_conversation_assignment!==0:true,...rows.results.find(row=>row.kind===kind)}))})
})
notificationRoutes.put(`${path}/notification-preferences`,async c=>{
 const actor=await scope(c),body=await c.req.json(),entries=body.preferences
 if(!Array.isArray(entries)||entries.length>teammateKinds.length||new Set(entries.map(e=>e.kind)).size!==entries.length)throw new HTTPException(400)
 for(const entry of entries)if(!teammateKinds.includes(entry.kind)||![true,false,0,1].includes(entry.inbox)||![true,false,0,1].includes(entry.email))throw new HTTPException(400)
 const statements=entries.map(entry=>c.env.DB.prepare('INSERT INTO notification_preferences(project_id,user_id,kind,inbox,email) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?) ON CONFLICT(project_id,user_id,kind) DO UPDATE SET inbox=excluded.inbox,email=excluded.email WHERE EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?)').bind(actor.projectId,actor.id,entry.kind,entry.inbox?1:0,entry.email?1:0,actor.projectId,actor.id,actor.projectId,actor.id))
 statements.push(auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'notifications.preferences_updated',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'user',id:actor.id},detail:{kinds:entries.map(entry=>entry.kind)}}))
 if(statements.length)await c.env.DB.batch(statements)
 return c.json({updated:true})
})
notificationRoutes.get(`${path}/notification-inbox`,async c=>{
 const actor=await scope(c),rows=await c.env.DB.prepare(`SELECT n.id,n.conversation_id,n.kind,n.read_at,n.created_at,n.state FROM notification_inbox n
 JOIN conversations c ON c.id=n.conversation_id AND c.project_id=n.project_id JOIN memberships m ON m.project_id=n.project_id AND m.user_id=n.user_id
 WHERE n.project_id=? AND n.user_id=? AND n.inbox=1 AND ${ticketScopeSql('m.user_id')} AND ${contactAvailableSql()} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`).bind(actor.projectId,actor.id).all<any>()
 return c.json({data:rows.results.map(row=>({...row,label:notificationLabels[row.kind]}))})
})
notificationRoutes.put(`${path}/notification-inbox/:id/read`,async c=>{
 const actor=await scope(c)
 const result=await c.env.DB.prepare('UPDATE notification_inbox SET read_at=coalesce(read_at,?) WHERE id=? AND project_id=? AND user_id=?').bind(Date.now(),c.req.param('id'),actor.projectId,actor.id).run()
 if(!result.meta.changes)throw new HTTPException(404);return c.json({updated:true})
})
