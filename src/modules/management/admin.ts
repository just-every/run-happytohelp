import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {sendLead,enqueueLead} from '../integrations/leads'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {text,url} from './common'
import {id,requiredString} from '../../platform/db'
export const admin=new Hono<AppEnv>()
export async function isPlatformAdmin(db:D1Database,userId:string){return !!await db.prepare('SELECT user_id FROM platform_admins WHERE user_id=?').bind(userId).first()}
admin.use('/admin/*',async(c,next)=>{const a=await requireActor(c);if(a.role==='contact'||!await isPlatformAdmin(c.env.DB,a.id))throw new HTTPException(403,{message:'Platform administrator required'});await next()})
const tables={users:'users',projects:'projects',datasets:'knowledge_datasets',connections:'local_devices',ai_logs:'ai_generations',ai_defaults:'ai_defaults',leads:'leads'} as const
for(const [resource,table] of Object.entries(tables)){admin.get(`/admin/${resource}`,async c=>{const query=(c.req.query('q')||c.req.query('search')||'').slice(0,300),column=resource==='ai_logs'?'model':resource==='ai_defaults'?'role':resource==='leads'?'website':'name';const rows=(await c.env.DB.prepare(`SELECT * FROM ${table} WHERE coalesce(${column},'') LIKE ? ORDER BY rowid DESC LIMIT 200`).bind(`%${query}%`).all()).results.map((row:any)=>{const result={...row,status:row.status||row.state};for(const key of ['widget_key','verification_secret','token_hash','actor_json','error','capabilities'])delete result[key];return result});return c.json({data:rows})});admin.get(`/admin/${resource}/:id`,async c=>{const row=await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(c.req.param('id')).first<any>();if(!row)throw new HTTPException(404);for(const key of ['widget_key','verification_secret','token_hash','actor_json'])delete row[key];return c.json({data:row})})}
admin.put('/admin/leads/send-multiple',async c=>{const b=await c.req.json();if(!Array.isArray(b.ids)||b.ids.length>50)throw new HTTPException(400);const receipts=[];for(const id of b.ids)receipts.push({leadId:id,...await sendLead(c.env,id)});return c.json({data:receipts})})
for(const resource of ['ai_defaults','leads']){admin.post(`/admin/${resource}`,async c=>{const b=await c.req.json(),key=id(),now=Date.now();if(resource==='ai_defaults')await c.env.DB.prepare('INSERT INTO ai_defaults VALUES(?,?,?,?,?,?)').bind(key,requiredString(b.role,'role',200),text(b.name||b.role,200),requiredString(b.prompt,'prompt',50000),text(b.model||'',200),now).run();else await c.env.DB.prepare('INSERT INTO leads(id,name,email,website,created_at) VALUES(?,?,?,?,?)').bind(key,text(b.name||'',200),text(b.email||'',320),url(b.website),now).run();return c.json({data:{id:key}},201)});admin.put(`/admin/${resource}/:id`,async c=>{const b=await c.req.json(),fields=resource==='ai_defaults'?['role','name','prompt','model']:['name','email','website','source','status','subject','content'];if(resource==='leads'&&b.status&&!['new','processed','reviewed','failed'].includes(b.status))throw new HTTPException(400,{message:'Invalid editable lead status'});const selected=fields.filter(k=>k in b);if(!selected.length)throw new HTTPException(400);const result=await c.env.DB.prepare(`UPDATE ${resource} SET ${selected.map(k=>`${k}=?`).join(',')} WHERE id=?`).bind(...selected.map(k=>requiredString(b[k],k,k==='prompt'?50000:2000)),c.req.param('id')).run();if(!result.meta.changes)throw new HTTPException(404);return c.json({updated:true})})}

admin.put('/admin/leads/:id/send',async c=>c.json(await sendLead(c.env,c.req.param('id'))))
admin.put('/admin/leads/:id/process',async c=>c.json(await enqueueLead(c.env,c.req.param('id')),202))

admin.delete('/admin/leads/:id',async c=>{const id=c.req.param('id');if(await c.env.DB.prepare("SELECT id FROM lead_jobs WHERE lead_id=? AND state IN ('queued','running','uncertain')").bind(id).first())throw new HTTPException(409);await c.env.DB.batch([c.env.DB.prepare('DELETE FROM lead_jobs WHERE lead_id=?').bind(id),c.env.DB.prepare('DELETE FROM leads WHERE id=?').bind(id)]);return c.json({deleted:true})})

/** Installation administration can suspend a workspace without deleting its data. */
admin.put('/admin/projects/:id/suspension',async c=>{
 const actor=await requireActor(c),projectId=c.req.param('id'),body=await c.req.json()
 if(typeof body.suspended!=='boolean')throw new HTTPException(400)
 await requireStepUp(c,actor,'project.suspend')
 const now=Date.now()
 const result=await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) SELECT id,json_object('suspended_at',?),? FROM projects WHERE id=? ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.suspended_at',?),updated_at=excluded.updated_at").bind(body.suspended?now:null,now,projectId,body.suspended?now:null),
  auditStatement(c.env.DB,{projectId,category:'access',action:body.suspended?'project.suspended':'project.resumed',actor:{type:'user',id:actor.id},source:requestSource(c)},now)
 ])
 if(!result[0].meta.changes)throw new HTTPException(404)
 return c.json({suspended:body.suspended})
})
