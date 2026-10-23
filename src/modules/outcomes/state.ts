import type {Env} from '../../platform/env'
import {notifyTicketEvent} from '../integrations/triggers'
export {trackingStatement} from './tracking'
export async function resolutionState(env:Env,projectId:string,conversationId:string){
 const row=await env.DB.prepare(`SELECT r.id,r.ordinal,r.resolved_at,r.outcome,r.reopened_at,r.evidence_json,v.value,v.comment,v.updated_at rating_updated_at,v.revision rating_revision,cs.scale rating_scale,cs.score rating_score,COALESCE(json_extract(ct.metadata_json,'$.csat_widget_optout'),0) widget_optout FROM conversations c JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id LEFT JOIN conversation_ratings v ON v.resolution_id=r.id LEFT JOIN csat_responses cs ON cs.resolution_id=r.id AND cs.project_id=r.project_id WHERE c.id=? AND c.project_id=? AND c.resolved_at IS NOT NULL AND r.reopened_at IS NULL ORDER BY r.ordinal DESC LIMIT 1`).bind(conversationId,projectId).first<any>()
 if(!row)return null
 const snapshot=JSON.parse(row.evidence_json).widgetSurvey??{enabled:1,scale:'thumbs',locale:'en',availableAt:0,expiresAt:null}
 const survey={...snapshot,enabled:snapshot.enabled===1||snapshot.enabled===true,optedOut:row.widget_optout===1}
 return {id:row.id,ordinal:row.ordinal,resolvedAt:new Date(row.resolved_at).toISOString(),outcome:row.outcome,survey,rating:row.value===null?null:{value:row.value,scale:row.rating_scale??'thumbs',score:row.rating_score??row.value,comment:row.comment,updatedAt:new Date(row.rating_updated_at).toISOString(),revision:row.rating_revision}}
}
export async function publishResolution(env:Env,projectId:string,conversationId:string){const resolution=await resolutionState(env,projectId,conversationId);if(resolution)await notifyTicketEvent(env,{projectId,conversationId,event:'ticket_solved',eventId:resolution.id});await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(conversationId)).fetch('https://conversation.internal/event',{method:'POST',body:JSON.stringify({type:'resolution',conversationId,resolution})});return resolution}
