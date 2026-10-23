import {HTTPException} from 'hono/http-exception'
import {hashToken} from '../../platform/auth'
import type {WidgetCommand} from '../management/widget-events/types'
import {publishResolution,resolutionState} from './state'

const cycleGuard=`r.id=? AND r.project_id=? AND r.conversation_id=? AND r.reopened_at IS NULL AND c.resolved_at IS NOT NULL AND c.contact_id=r.contact_id AND r.contact_id=? AND r.ordinal=(SELECT MAX(ordinal) FROM conversation_resolutions WHERE conversation_id=c.id) AND EXISTS(SELECT 1 FROM sessions s JOIN contacts ct ON ct.id=s.contact_id AND ct.project_id=s.project_id WHERE s.token_hash=? AND s.role='contact' AND s.contact_id=c.contact_id AND s.project_id=c.project_id AND s.revoked_at IS NULL AND s.expires_at>? AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1) AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=c.project_id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL)`
const availableGuard=`COALESCE(json_extract(r.evidence_json,'$.widgetSurvey.enabled'),1)=1 AND COALESCE(json_extract(r.evidence_json,'$.widgetSurvey.availableAt'),0)<=? AND (json_extract(r.evidence_json,'$.widgetSurvey.expiresAt') IS NULL OR json_extract(r.evidence_json,'$.widgetSurvey.expiresAt')>?) AND NOT EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=r.contact_id AND ct.project_id=r.project_id AND json_extract(ct.metadata_json,'$.csat_widget_optout')=1)`
async function sessionHash(command:WidgetCommand){
 const token=command.c.req.header('Authorization')?.replace(/^Bearer /,'')||command.c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
 if(!token)throw new HTTPException(401)
 return hashToken(token)
}
export async function rateResolution(command:WidgetCommand){
 const {c,actor,conversation,data}=command,body={...(data as any),comment:(data as any).comment??''},score=body.score??body.value
 if(typeof body.resolutionId!=='string'||![-1,1,2,3,4,5].includes(score)||typeof body.comment!=='string'||body.comment.length>1000)throw new HTTPException(400,{message:'Choose a rating and use at most 1,000 characters for the comment'})
 const row=await c.env.DB.prepare("SELECT COALESCE(json_extract(evidence_json,'$.widgetSurvey.scale'),'thumbs') scale FROM conversation_resolutions WHERE id=? AND project_id=? AND conversation_id=?").bind(body.resolutionId,actor.projectId,conversation.id).first<{scale:string}>()
 if(!row)throw new HTTPException(409,{message:'This resolution is no longer available to rate. Refresh the conversation.'})
 if(!(row.scale==='five'?[1,2,3,4,5]:[-1,1]).includes(score))throw new HTTPException(400,{message:'Choose a score from this resolution’s rating scale'})
 const session=await sessionHash(command),now=Date.now(),id=crypto.randomUUID(),value=row.scale==='five'?(score>=4?1:-1):score
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO conversation_rating_history(id,resolution_id,value,comment,created_at,revision) SELECT ?,r.id,?,?,?,COALESCE((SELECT revision FROM conversation_ratings WHERE resolution_id=r.id),0)+1 FROM conversation_resolutions r JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id WHERE ${cycleGuard} AND ${availableGuard} AND COALESCE(json_extract(r.evidence_json,'$.widgetSurvey.scale'),'thumbs')=?`).bind(id,value,body.comment,now,body.resolutionId,actor.projectId,conversation.id,actor.contactId!,session,now,now,now,row.scale),
  c.env.DB.prepare('INSERT INTO conversation_ratings(resolution_id,value,comment,updated_at,revision) SELECT resolution_id,value,comment,created_at,revision FROM conversation_rating_history WHERE id=? ON CONFLICT(resolution_id) DO UPDATE SET value=excluded.value,comment=excluded.comment,updated_at=excluded.updated_at,revision=excluded.revision').bind(id),
  c.env.DB.prepare(`INSERT INTO csat_response_history(id,resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,created_at,response_surface) SELECT h.id,h.resolution_id,r.project_id,r.contact_id,'widget',?,?,'',h.comment,h.revision,h.created_at,'widget' FROM conversation_rating_history h JOIN conversation_resolutions r ON r.id=h.resolution_id WHERE h.id=?`).bind(row.scale,score,id),
  c.env.DB.prepare(`INSERT INTO csat_responses(resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,updated_at,response_surface) SELECT resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,created_at,response_surface FROM csat_response_history WHERE id=? ON CONFLICT(resolution_id) DO UPDATE SET channel=excluded.channel,scale=excluded.scale,score=excluded.score,reason=excluded.reason,comment=excluded.comment,updated_at=excluded.updated_at,revision=excluded.revision,response_surface='widget'`).bind(id)
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'This resolution is no longer available to rate. Refresh the conversation.'})
 const resolution=await resolutionState(c.env,actor.projectId,conversation.id)
 c.executionCtx.waitUntil(publishResolution(c.env,actor.projectId,conversation.id))
 return c.json({resolution})
}
export async function optOutWidgetSurveys(command:WidgetCommand){
 const {c,actor,conversation,data}=command,body=data as any,session=await sessionHash(command),now=Date.now()
 if(typeof body.resolutionId!=='string')throw new HTTPException(400)
 const result=await c.env.DB.prepare(`UPDATE contacts SET metadata_json=json_set(metadata_json,'$.csat_widget_optout',json('true')) WHERE project_id=? AND id=? AND EXISTS(SELECT 1 FROM conversation_resolutions r JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id WHERE ${cycleGuard})`).bind(actor.projectId,actor.contactId!,body.resolutionId,actor.projectId,conversation.id,actor.contactId!,session,now).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'This resolution is no longer available. Refresh the conversation.'})
 c.executionCtx.waitUntil(publishResolution(c.env,actor.projectId,conversation.id))
 return c.json({resolution:await resolutionState(c.env,actor.projectId,conversation.id)})
}
