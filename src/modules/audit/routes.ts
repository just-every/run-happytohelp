import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope,text} from '../management/common'
import {csv} from '../reports/csv'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from './record'
import {auditPage,parseCursor,type AuditFilter} from './read'
import {RETENTION_LIMITS} from './retention'
import {afterReads} from '../../platform/read-effects'

/** Settings → Security log: read, export, retention and legal holds. Owners and admins read it. */
export const auditRoutes=new Hono<AppEnv>()
const P='/projects/:projectId/audit'
const time=(value:string|undefined)=>{if(!value)return undefined;const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new HTTPException(400,{message:'Use ISO dates such as 2026-10-17.'});return parsed}
function filter(c:any,limit:number):AuditFilter{
 const category=c.req.query('category')||undefined
 if(category&&!/^[a-z_]{1,20}$/.test(category))throw new HTTPException(400,{message:'Unknown category'})
 return {category,actorId:c.req.query('actor')||undefined,since:time(c.req.query('since')),until:time(c.req.query('until')),before:parseCursor(c.req.query('cursor')),limit}
}
const holdList=(db:D1Database,projectId:string)=>db.prepare('SELECT h.*,u.name created_by_name FROM audit_holds h LEFT JOIN users u ON u.id=h.created_by WHERE h.project_id=? ORDER BY h.created_at DESC').bind(projectId).all()

auditRoutes.get(P,async c=>{
 const actor=await scope(c,true),limit=Math.min(200,Math.max(1,Number(c.req.query('limit'))||50))
 const page=await auditPage(c.env,actor.projectId,filter(c,limit))
 const settings=await c.env.DB.prepare("SELECT json_extract(settings_json,'$.audit_retention_days') days FROM project_settings WHERE project_id=?").bind(actor.projectId).first<{days:number|null}>()
 c.header('Cache-Control','no-store')
 return c.json({data:page.rows,next:page.next,holds:(await holdList(c.env.DB,actor.projectId)).results,retentionDays:settings?.days??null})
})

/** A complete export of the filtered log, as CSV or JSON. Needs a recent step-up and is itself recorded. */
auditRoutes.get(`${P}/export`,async c=>{
 const actor=await scope(c,true),format=c.req.query('format')==='json'?'json':'csv'
 await requireStepUp(c,actor,'audit.export')
 const rows=[],query=filter(c,500)
 for(;;){const page=await auditPage(c.env,actor.projectId,query);rows.push(...page.rows);if(!page.next||rows.length>=50000)break;query.before=parseCursor(page.next)}
 await afterReads(c,auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'audit.exported',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{format,rows:rows.length}}))
 const stamp=new Date().toISOString().slice(0,10)
 c.header('Cache-Control','no-store')
 c.header('Content-Disposition',`attachment; filename="security-log-${stamp}.${format}"`)
 if(format==='json')return c.body(JSON.stringify({exportedAt:new Date().toISOString(),projectId:actor.projectId,events:rows.map(({detail_json,...row})=>row)},null,1),200,{'Content-Type':'application/json; charset=utf-8'})
 return c.body(csv([['Time (UTC)','Category','Action','Outcome','Actor','Actor ID','Source','Target type','Target ID','Purpose','Detail','Held'],...rows.map(row=>[new Date(row.at).toISOString(),row.category,row.action,row.outcome,row.actor,row.actor_id,row.source,row.target_type,row.target_id,row.purpose,row.detail_json,row.held?'yes':''])]),200,{'Content-Type':'text/csv; charset=utf-8'})
})

auditRoutes.put(`${P}/retention`,async c=>{
 const actor=await scope(c,true)
 if(actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can change how long the security log is kept.'})
 const body=await c.req.json().catch(()=>({})),days=body.days===null?null:Number(body.days)
 if(days!==null&&(!Number.isInteger(days)||days<RETENTION_LIMITS.min||days>RETENTION_LIMITS.max))throw new HTTPException(400,{message:`Keep the log for ${RETENTION_LIMITS.min} to ${RETENTION_LIMITS.max} days, or forever.`})
 await requireStepUp(c,actor,'audit.retention')
 const now=Date.now()
 await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,json_object('audit_retention_days',?),?) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.audit_retention_days',?),updated_at=excluded.updated_at").bind(actor.projectId,days,now,days),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'audit',action:'audit.retention_changed',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{days}},now),
 ])
 return c.json({data:{retentionDays:days}})
})

auditRoutes.post(`${P}/holds`,async c=>{
 const actor=await scope(c,true)
 if(actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can place a legal hold.'})
 const body=await c.req.json().catch(()=>({})),name=text(body.name,120),reason=text(body.reason,2000)
 if(!name||!reason)throw new HTTPException(400,{message:'Name the hold and say why it is needed.'})
 const starts=time(body.starts_at)??0,ends=time(body.ends_at)??null
 if(ends!==null&&ends<starts)throw new HTTPException(400,{message:'The hold must end after it starts.'})
 await requireStepUp(c,actor,'audit.hold')
 const id=crypto.randomUUID(),now=Date.now()
 await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO audit_holds(id,project_id,name,reason,starts_at,ends_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,actor.projectId,name,reason,starts,ends,actor.id,now),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'audit',action:'audit.hold_placed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'hold',id},purpose:reason,detail:{name,starts_at:starts,ends_at:ends}},now),
 ])
 return c.json({data:{id}},201)
})

auditRoutes.post(`${P}/holds/:holdId/release`,async c=>{
 const actor=await scope(c,true)
 if(actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can release a legal hold.'})
 await requireStepUp(c,actor,'audit.hold_release')
 const now=Date.now(),result=await c.env.DB.prepare('UPDATE audit_holds SET released_at=?,released_by=? WHERE project_id=? AND id=? AND released_at IS NULL').bind(now,actor.id,actor.projectId,c.req.param('holdId')).run()
 if(!result.meta.changes)throw new HTTPException(404)
 await auditStatement(c.env.DB,{projectId:actor.projectId,category:'audit',action:'audit.hold_released',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'hold',id:c.req.param('holdId')}},now).run()
 return c.json({data:{released:true}})
})
