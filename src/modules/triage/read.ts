import type {Env,Actor} from '../../platform/env'
import {ticketReadAccess,fieldAllowed} from '../tickets/model'
import {settings,dimensions} from './model'
export async function triageData(env:Env,actor:Actor,conversationId:string){
 const access=await ticketReadAccess(env,actor),s=await settings(env,actor.projectId)
 const row=await env.DB.prepare('SELECT * FROM triage_jobs WHERE project_id=? AND conversation_id=? ORDER BY source_revision DESC LIMIT 1').bind(actor.projectId,conversationId).first<any>()
 const labels=(await env.DB.prepare('SELECT l.*,u.name actor_name FROM triage_labels l LEFT JOIN users u ON u.id=l.actor_id WHERE l.project_id=? AND l.conversation_id=? ORDER BY l.at DESC,l.rowid DESC LIMIT 100').bind(actor.projectId,conversationId).all<any>()).results
 const definitions=(await env.DB.prepare('SELECT id,read_roles_json FROM ticket_fields WHERE project_id=?').bind(actor.projectId).all<any>()).results
 const visible=new Set(dimensions.filter(field=>[`triage_${field}`,`triage_${field}_confidence`,`triage_${field}_quote`].every(id=>definitions.some(f=>f.id===id&&fieldAllowed(f,access)))))
 const allPredictions=row?.predictions_json?JSON.parse(row.predictions_json):{},predictions:any={},values:any={}
 for(const field of visible)if(allPredictions[field])predictions[field]=allPredictions[field]
 for(const field of visible){const corrected=labels.find(l=>l.job_id===row?.id&&l.field===field);if(corrected)values[field]=corrected.value;else if(predictions[field])values[field]=predictions[field].value}
 return {...(allPredictions.knowledge_provenance?{knowledge_provenance:allPredictions.knowledge_provenance}:{}),state:row?(row.state==='running'?'pending':row.state):s.enabled?'unavailable':'disabled',reason:row?.reason??(s.enabled&&!row?'No customer message has been classified yet':null),predictions,values,taxonomy:s.taxonomy,labels:labels.filter(l=>visible.has(l.field)),permissions:{correct:access.permissions.has('conversations.manage')&&!!row&&row.state==='complete'}}
}
