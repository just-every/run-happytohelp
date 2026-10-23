import {HTTPException} from 'hono/http-exception'
import type {WidgetCommand} from '../../management/widget-events/types'
import {visitorMonitoring} from '../../customer-context/widget-policy'
import {campaignClock,campaignSchema,contextSchema,matchesCampaign,type Campaign} from './model'

/** Untrusted page facts only select an offer. They never authorize a message, identity or resolution. */
export async function campaignAction({c,actor,conversation,action}:Omit<WidgetCommand,'data'>,data:any){
 const db=c.env.DB,projectId=actor.projectId,contactId=actor.contactId!,now=Date.now()
 const monitoring=await visitorMonitoring(c.env,projectId,contactId)
 if(!monitoring.enabled)return c.json({offer:null,reason:'consent_or_collector_disabled'})
 if(action==='campaignEvaluate'){
  const parsed=contextSchema.safeParse(data)
  if(!parsed.success)throw new HTTPException(400,{message:'Invalid campaign context'})
  const context=parsed.data
  await db.prepare('INSERT OR IGNORE INTO widget_campaign_visits VALUES(?,?,?,?)').bind(projectId,contactId,context.visitId,now).run()
  const returning=!!await db.prepare('SELECT 1 FROM widget_campaign_visits WHERE project_id=? AND contact_id=? AND visit_id<>? LIMIT 1').bind(projectId,contactId,context.visitId).first()
  const contact=await db.prepare('SELECT metadata_json FROM contacts WHERE id=? AND project_id=?').bind(contactId,projectId).first<{metadata_json:string}>()
  const metadata=JSON.parse(contact?.metadata_json||'{}')
  const rows=(await db.prepare('SELECT id,revision,config_json FROM widget_campaigns WHERE project_id=? ORDER BY updated_at,id LIMIT 50').bind(projectId).all<{id:string;revision:number;config_json:string}>()).results
  for(const row of rows){
   const parsed=campaignSchema.safeParse(JSON.parse(row.config_json));if(!parsed.success)continue
   const config=parsed.data,{day,quiet}=campaignClock(config,now)
   if(!config.enabled||quiet||!matchesCampaign(config,context,returning,metadata))continue
   // The slot uniqueness fence is authoritative across tabs, retries and Worker restarts.
   // Only one offer per visitor/visit/page evaluation cycle is held by the client; reserve before display.
   const id=crypto.randomUUID()
   const reserved=await db.prepare(`INSERT OR IGNORE INTO widget_campaign_impressions(id,project_id,contact_id,campaign_id,campaign_revision,day,slot,created_at) SELECT ?,?,?,?,?,?,coalesce(max(slot),0)+1,? FROM widget_campaign_impressions WHERE project_id=? AND contact_id=? AND campaign_id=? AND day=? HAVING coalesce(max(slot),0)<?`).bind(id,projectId,contactId,row.id,row.revision,day,now,projectId,contactId,row.id,day,config.dailyCap).run()
   if(reserved.meta.changes)return c.json({offer:{id,campaignId:row.id,sender:config.sender,brand:config.brand,message:config.message}})
  }
  return c.json({offer:null})
 }
 if(action==='campaignEvent'){
  if(!data||typeof data.id!=='string'||data.id.length>80||!['show','open','dismiss'].includes(data.event)||Object.keys(data).some(k=>!['id','event'].includes(k)))throw new HTTPException(400)
  const found=await db.prepare('SELECT i.id,w.config_json FROM widget_campaign_impressions i JOIN widget_campaigns w ON w.project_id=i.project_id AND w.id=i.campaign_id WHERE i.id=? AND i.project_id=? AND i.contact_id=?').bind(data.id,projectId,contactId).first<{id:string;config_json:string}>()
  if(!found)throw new HTTPException(404)
  const config=JSON.parse(found.config_json) as Campaign
  if(!config.enabled)return c.json({accepted:false,reason:'campaign_disabled'})
  // Opening records an empty-composer choice only. Conversation counts require a later real visitor message.
  const column=data.event==='show'?'shown_at':data.event==='open'?'opened_at':'dismissed_at'
  await db.prepare(`UPDATE widget_campaign_impressions SET ${column}=coalesce(${column},?)${data.event==='open'?',conversation_id=coalesce(conversation_id,?)':''} WHERE id=? AND project_id=? AND contact_id=?`).bind(now,...(data.event==='open'?[conversation.id]:[]),data.id,projectId,contactId).run()
  return c.json({accepted:true})
 }
 throw new HTTPException(400)
}
