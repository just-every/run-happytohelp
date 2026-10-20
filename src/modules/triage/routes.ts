import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {dashboardAccess} from '../management/dashboard'
import {ticketAuthority,object,invalid} from '../tickets/model'
import {settingsData,saveSettings} from './settings'
import {triageData} from './read'
import {dimensions} from './model'
import {processWorkflowEvents} from '../workflows/events'
export const triageRoutes=new Hono<AppEnv>()
triageRoutes.get('/projects/:projectId/triage-settings',async c=>{const actor=await scope(c);return c.json({data:await settingsData(c,actor)})})
triageRoutes.put('/projects/:projectId/triage-settings',async c=>{const actor=await scope(c,true);return c.json({data:await saveSettings(c,actor)})})
const path='/projects/:projectId/conversations/:conversationId/triage'
triageRoutes.get(path,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await triageData(c.env,actor,conversation.id)})})
triageRoutes.patch(path,async c=>{
 const {actor,conversation}=await dashboardAccess(c),guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')}),b=object(await c.req.json()),data=await triageData(c.env,actor,conversation.id)
 if(!dimensions.includes(b.field)||typeof b.value!=='string'||!b.value||b.value.length>80)invalid('Choose a triage field and value')
 if(!data.permissions.correct)throw new HTTPException(409,{message:'Wait for a completed prediction before labeling it'})
 if(b.field==='intent'&&!data.taxonomy.some((t:any)=>t.active&&t.id===b.value)||b.field==='sentiment'&&!['positive','neutral','negative'].includes(b.value)||b.field==='language'&&!/^([a-z]{2,3})(-[A-Za-z0-9]{2,8})*$/.test(b.value))invalid('Choose an active intent, sentiment or language tag')
 const row=await c.env.DB.prepare("SELECT id,source_revision FROM triage_jobs WHERE project_id=? AND conversation_id=? AND state='complete' ORDER BY source_revision DESC LIMIT 1").bind(actor.projectId,conversation.id).first<any>()
 if(!row)throw new HTTPException(409)
 const id=crypto.randomUUID(),now=Date.now(),ok='EXISTS(SELECT 1 FROM triage_labels WHERE id=?)'
 const result=await c.env.DB.batch([
 c.env.DB.prepare(`INSERT INTO triage_labels(id,project_id,conversation_id,job_id,field,value,prediction_json,actor_id,at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql}) AND NOT EXISTS(SELECT 1 FROM contact_erasures WHERE project_id=? AND contact_id=?) AND NOT EXISTS(SELECT 1 FROM triage_jobs newer WHERE newer.conversation_id=? AND newer.source_revision>?)`).bind(id,actor.projectId,conversation.id,row.id,b.field,b.value,JSON.stringify(data.predictions[b.field]),actor.id,now,...guard.params,actor.projectId,conversation.contact_id,conversation.id,row.source_revision),
 c.env.DB.prepare(`INSERT INTO ticket_field_values(project_id,conversation_id,field_id,value_json) SELECT ?,?,?,? WHERE ${ok} ON CONFLICT(project_id,conversation_id,field_id) DO UPDATE SET value_json=excluded.value_json`).bind(actor.projectId,conversation.id,`triage_${b.field}`,JSON.stringify(b.value),id),
 c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','triage.corrected','succeeded','user',?,'dashboard','conversation',?,? WHERE ${ok}`).bind(`triage-label:${id}`,actor.projectId,now,actor.id,conversation.id,JSON.stringify({label_id:id,field:b.field}),id),
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Ticket or authority changed; reload'})
 await processWorkflowEvents(c.env,conversation.id,20)
 return c.json({data:await triageData(c.env,actor,conversation.id)})
})
