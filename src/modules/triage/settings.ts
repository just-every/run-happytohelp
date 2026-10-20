import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {Actor,AppEnv} from '../../platform/env'
import {ticketAuthority,ticketReadAccess,invalid,named,object} from '../tickets/model'
import {settings,accuracy,fieldRows} from './model'
export async function settingsData(c:Context<AppEnv>,actor:Actor){
 const s=await settings(c.env,actor.projectId),access=await ticketReadAccess(c.env,actor)
 const canEdit=['owner','admin'].includes(actor.role)&&access.permissions.has('settings.manage')
 const groups=(await c.env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=? ORDER BY name').bind(actor.projectId).all()).results
 return {...s,accuracy:await accuracy(c.env,actor.projectId,s.taxonomy),groups,permissions:{settings:canEdit,correct:access.permissions.has('conversations.manage')}}
}
export async function saveSettings(c:Context<AppEnv>,actor:Actor){
 if(!['owner','admin'].includes(actor.role))throw new HTTPException(403)
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'settings.manage'),b=object(await c.req.json()),old=await settings(c.env,actor.projectId)
 if(typeof b.enabled!=='boolean'||typeof b.routing_enabled!=='boolean'||typeof b.threshold!=='number'||!Number.isFinite(b.threshold)||b.threshold<0||b.threshold>1||b.version!==old.version)invalid('Reload settings and choose a confidence between 0 and 1')
 if(!Array.isArray(b.taxonomy)||!b.taxonomy.length||b.taxonomy.length>100)invalid('Use 1–100 intents')
 const taxonomy=b.taxonomy.map((raw:any)=>{const t=object(raw);if(typeof t.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(t.id)||typeof t.active!=='boolean')invalid('Intent needs a stable ID and active flag');return {id:t.id,name:named(t.name),active:t.active}})
 if(new Set(taxonomy.map((t:any)=>t.id)).size!==taxonomy.length||!taxonomy.some((t:any)=>t.active))invalid('Intent IDs must be unique; keep at least one active intent')
 for(const t of old.taxonomy)if(!taxonomy.some((n:any)=>n.id===t.id))invalid('Retire an intent instead of deleting its history')
 const changed=JSON.stringify(taxonomy)!==JSON.stringify(old.taxonomy)||b.threshold!==old.threshold
 const routing=!!b.routing_enabled
 if(routing&&(!old.routing_enabled||changed)){
  if(b.accuracy_reviewed!==true)invalid('Review measured accuracy by intent before enabling routing')
  const measured=await accuracy(c.env,actor.projectId,taxonomy)
  if(!measured.some((r:any)=>r.total>0))invalid('Record operator intent labels before enabling routing')
 }
 const group=b.default_group_id??null
 if(group!==null&&typeof group!=='string')invalid('Choose a default queue')
 if(group&&!await c.env.DB.prepare('SELECT id FROM ticket_groups WHERE project_id=? AND id=?').bind(actor.projectId,group).first())invalid('Choose a current workspace queue')
 const now=Date.now(),receipt=crypto.randomUUID(),ok='EXISTS(SELECT 1 FROM audit_events WHERE id=?)',okArgs=[receipt]
 const first=c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,?,'triage.settings_updated','succeeded','user',?,'dashboard','triage_settings',?,? WHERE EXISTS(${guard.sql}) AND coalesce((SELECT version FROM triage_settings WHERE project_id=?),0)=? ${group?'AND EXISTS(SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?)':''}`).bind(receipt,actor.projectId,now,routing&&!old.routing_enabled?'approval':'data',actor.id,actor.projectId,JSON.stringify({version:old.version+1,routing_enabled:routing,intents:taxonomy.length}),...guard.params,actor.projectId,old.version,...(group?[actor.projectId,group]:[]))
 const result=await c.env.DB.batch([first,
 c.env.DB.prepare(`INSERT INTO triage_settings(project_id,enabled,threshold,default_group_id,routing_enabled,taxonomy_json,version,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${ok} ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,threshold=excluded.threshold,default_group_id=excluded.default_group_id,routing_enabled=excluded.routing_enabled,taxonomy_json=excluded.taxonomy_json,version=excluded.version,updated_at=excluded.updated_at`).bind(actor.projectId,b.enabled?1:0,b.threshold,group,routing?1:0,JSON.stringify(taxonomy),old.version+1,now,...okArgs),
 ...fieldRows().map(f=>c.env.DB.prepare(`INSERT INTO ticket_fields(project_id,id,name,type,write_roles_json,updated_at) SELECT ?,?,?,?,'["triage-system"]',? WHERE ${ok} ON CONFLICT(project_id,id) DO NOTHING`).bind(actor.projectId,f.id,f.name,f.type,now,...okArgs))])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Settings or authority changed; reload'})
 return settingsData(c,actor)
}
