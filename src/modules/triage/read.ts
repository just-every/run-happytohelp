import type {Env,Actor} from '../../platform/env'
import {ticketReadAccess} from '../tickets/model'
import {settings,dimensions} from './model'
export async function triageData(env:Env,actor:Actor,conversationId:string){
 const access=await ticketReadAccess(env,actor),s=await settings(env,actor.projectId)
 const row=await env.DB.prepare('SELECT * FROM triage_jobs WHERE project_id=? AND conversation_id=? ORDER BY source_revision DESC LIMIT 1').bind(actor.projectId,conversationId).first<any>()
 const labels=(await env.DB.prepare('SELECT l.*,u.name actor_name FROM triage_labels l LEFT JOIN users u ON u.id=l.actor_id WHERE l.project_id=? AND l.conversation_id=? ORDER BY l.at DESC,l.rowid DESC LIMIT 100').bind(actor.projectId,conversationId).all<any>()).results
 const predictions=row?.predictions_json?JSON.parse(row.predictions_json):{},values:any={}
 for(const field of dimensions){const corrected=labels.find(l=>l.job_id===row?.id&&l.field===field);if(corrected)values[field]=corrected.value;else if(predictions[field])values[field]=predictions[field].value}
 return {state:row?(row.state==='running'?'pending':row.state):s.enabled?'unavailable':'disabled',reason:row?.reason??(s.enabled&&!row?'No customer message has been classified yet':null),predictions,values,taxonomy:s.taxonomy,labels,permissions:{correct:access.permissions.has('conversations.manage')&&!!row&&row.state==='complete'}}
}
