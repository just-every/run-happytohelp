import {HTTPException} from 'hono/http-exception'
import {hashToken} from '../../platform/auth'
import type {WidgetCommand} from '../management/widget-events/types'
import {publishResolution,resolutionState} from './state'
export async function rateResolution(command:WidgetCommand){
 const {c,actor,conversation,data}=command,body={...(data as any),comment:(data as any).comment??''}
 if(typeof body.resolutionId!=='string'||![1,-1].includes(body.value)||typeof body.comment!=='string'||body.comment.length>1000)throw new HTTPException(400,{message:'Choose a rating and use at most 1,000 characters for the comment'})
 const token=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1];if(!token)throw new HTTPException(401)
 const session=await hashToken(token),now=Date.now(),id=crypto.randomUUID(),guard=`r.id=? AND r.project_id=? AND r.conversation_id=? AND r.reopened_at IS NULL AND c.resolved_at IS NOT NULL AND c.contact_id=r.contact_id AND r.contact_id=? AND r.ordinal=(SELECT MAX(ordinal) FROM conversation_resolutions WHERE conversation_id=c.id) AND EXISTS(SELECT 1 FROM sessions s JOIN contacts ct ON ct.id=s.contact_id AND ct.project_id=s.project_id WHERE s.token_hash=? AND s.role='contact' AND s.contact_id=c.contact_id AND s.project_id=c.project_id AND s.revoked_at IS NULL AND s.expires_at>? AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1) AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=c.project_id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL)`
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO conversation_rating_history(id,resolution_id,value,comment,created_at,revision) SELECT ?,r.id,?,?,?,COALESCE((SELECT revision FROM conversation_ratings WHERE resolution_id=r.id),0)+1 FROM conversation_resolutions r JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id WHERE ${guard}`).bind(id,body.value,body.comment,now,body.resolutionId,actor.projectId,conversation.id,actor.contactId!,session,now),
  c.env.DB.prepare('INSERT INTO conversation_ratings(resolution_id,value,comment,updated_at,revision) SELECT resolution_id,value,comment,created_at,revision FROM conversation_rating_history WHERE id=? ON CONFLICT(resolution_id) DO UPDATE SET value=excluded.value,comment=excluded.comment,updated_at=excluded.updated_at,revision=excluded.revision').bind(id),
  c.env.DB.prepare(`INSERT INTO csat_response_history(id,resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,created_at,response_surface) SELECT h.id,h.resolution_id,r.project_id,r.contact_id,'widget','thumbs',h.value,'',h.comment,h.revision,h.created_at,'widget' FROM conversation_rating_history h JOIN conversation_resolutions r ON r.id=h.resolution_id WHERE h.id=?`).bind(id),
  c.env.DB.prepare(`INSERT INTO csat_responses(resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,updated_at,response_surface) SELECT resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,created_at,response_surface FROM csat_response_history WHERE id=? ON CONFLICT(resolution_id) DO UPDATE SET channel=excluded.channel,scale=excluded.scale,score=excluded.score,reason=excluded.reason,comment=excluded.comment,updated_at=excluded.updated_at,revision=excluded.revision,response_surface='widget'`).bind(id)
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'This resolution is no longer available to rate. Refresh the conversation.'})
 const resolution=await resolutionState(c.env,actor.projectId,conversation.id)
 c.executionCtx.waitUntil(publishResolution(c.env,actor.projectId,conversation.id))
 return c.json({resolution})
}
