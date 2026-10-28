import {cronRoom} from '../../platform/cron-budget'
import {scheduledProjects,advanceDispatchCursor,readyIntentSql} from './scheduling'
import type {Env} from '../../platform/env'
import {DeliveryService,createSlackNotifier,createWebhookProtocol,createSlackBotProtocol,createSlackIncomingWebhookProtocol} from '../../vendor/base/modules/integrations/index.ts'
import {NativeDeliveryRepository} from './delivery-repository'
import {destination,DestinationUnavailable} from './destinations'
import {httpsTransport,connectedTransport} from './transport'
import {connectedPreviewText,protectConnectedFields} from '../knowledge/connected-door'
export const slackTemplates={
 'conversation.created':(data:{conversation_id?:string;title?:string})=>({summary:'New conversation',sections:[data.title||'A customer started a conversation. Open your support inbox to reply.']}),
 'integration.test':()=>({summary:'Slack connection test',sections:['This is an explicit test from your support workspace.']})
}
export function services(env:Env,projectId:string,transport= httpsTransport){
 const repo=new NativeDeliveryRepository(env,projectId),read=async(id:string)=>{
  const target=await destination(env,projectId,id)
  repo.observeDestination(id,target.secret_ciphertext)
  return target
 }
 const edge=connectedTransport(env,projectId,repo,read,transport)
 const webhook=new DeliveryService({repository:repo,transport:edge.transport,protocols:[edge.protocol(createWebhookProtocol({resolveDestination:async id=>(await read(id)).secret.url,signingKey:async envelope=>{
  const intent=await env.DB.prepare('SELECT e.erased_at FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id WHERE i.id=? AND i.project_id=? AND e.project_id=?').bind(envelope.id,projectId,projectId).first<any>()
  if(!intent||intent.erased_at!==null)throw Error('Event unavailable')
  const key=(await read(envelope.destinationId)).secret.key;return Uint8Array.from(key.match(/../g),(part:string)=>parseInt(part,16))
 }}))]})
 const incomingWebhook=async(id:string)=>(await read(id)).secret.url,bot=async(id:string)=>(await read(id)).secret
 const slack=createSlackNotifier({repository:repo,transport:edge.transport,templates:slackTemplates,incomingWebhook,bot})
 // Base still owns enqueue serialization, escaping, attempts and classification.
 // Its dispatch protocols associate the immutable wire with our disclosure door.
 slack.delivery=new DeliveryService({repository:repo,transport:edge.transport,protocols:[edge.protocol(createSlackIncomingWebhookProtocol({resolveDestination:incomingWebhook})),edge.protocol(createSlackBotProtocol({resolveDestination:bot}))]})
 return {repo,webhook,slack}
}
/** Native intents were committed alongside their domain event. Preparing the
 * same logical delivery after a crash is idempotent; Base owns send claims. */
export async function dispatchIntegrations(env:Env,projectId?:string){
 const transport=httpsTransport
 // Eight preparations and eight sends across the entire invocation, not per
 // workspace. A small fair page leaves D1/subrequest headroom for native jobs.
 let preparations=8,sends=8
 const projects=projectId?[{project_id:projectId}]:await scheduledProjects(env,4)
 for(const {project_id:project} of projects){
  if(!cronRoom(env,5))break
  let worked=false,deferred=false
  const s=services(env,project,transport),pending=await env.DB.prepare(`SELECT i.id,i.destination_id,d.kind,d.mode,e.event,e.body,e.created_at,e.conversation_id,e.rowid sequence FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id JOIN native_integration_destinations d ON d.id=i.destination_id AND d.project_id=i.project_id WHERE i.project_id=? AND i.prepared_at IS NULL AND ${readyIntentSql} ORDER BY e.rowid,i.id LIMIT ?`).bind(project,preparations).all<any>()
  for(const row of pending.results){if(!cronRoom(env,47)){deferred=true;break}preparations--;worked=true;try{
   await destination(env,project,row.destination_id)
   if(row.kind==='webhook')await s.webhook.enqueue({id:row.id,tenant:project,destinationId:row.destination_id,event:row.event,protocol:'webhook',body:JSON.stringify(await protectConnectedFields(env,project,{id:row.id,event:row.event,sequence:row.sequence,created_at:new Date(row.created_at).toISOString(),data:JSON.parse(row.body)}))})
   else {
    let title:string|undefined
    if(row.event==='conversation.created'){
     // A widget may create an empty conversation before its first message. Wait
     // for the actual visitor context; the logical created intent remains one.
     const first=await env.DB.prepare("SELECT m.content FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE m.project_id=? AND m.conversation_id=? AND m.actor_role='contact' AND m.erased_at IS NULL AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 ORDER BY m.revision,m.id LIMIT 1").bind(project,row.conversation_id).first<{content:string}>()
     if(!first)continue
     title=await connectedPreviewText(env,project,first.content,500)
    }
    await s.slack.enqueue({id:row.id,tenant:project,destinationId:row.destination_id,event:row.event,mode:row.mode,data:{conversation_id:row.conversation_id,title}})
   }
   await env.DB.prepare('UPDATE native_integration_intents SET prepared_at=?,error_code=NULL WHERE id=? AND project_id=?').bind(Date.now(),row.id,project).run()
  }catch(error){
   // Erasure may commit while protocol preparation awaits its destination.
   const current=await env.DB.prepare('SELECT e.erased_at FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id WHERE i.id=? AND i.project_id=?').bind(row.id,project).first<any>()
   if(!current||current.erased_at!==null)continue
   if(!(error instanceof DestinationUnavailable))throw error
   await env.DB.prepare("UPDATE native_integration_intents SET prepared_at=?,error_code='configuration_unavailable' WHERE id=? AND project_id=?").bind(Date.now(),row.id,project).run()
  }}
  if(!cronRoom(env,4))break
  await s.webhook.recoverExpired()
  // One repository has both protocols. Dispatch with its owning service only.
  const due=sends?await s.repo.due(Date.now(),sends):[]
  for(const id of due){if(!cronRoom(env,33)){deferred=true;break}sends--;worked=true;const delivery=await s.repo.get(id);if(!delivery)continue
   const event=await env.DB.prepare('SELECT e.erased_at FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id WHERE i.id=? AND i.project_id=?').bind(id,project).first<any>()
   if(!event||event.erased_at!==null)continue
   await (delivery.protocol==='webhook'?s.webhook:s.slack.delivery).dispatch(id)
  }
  // An unserved workspace must remain first next time. Advancing past it
  // would repeatedly skip every other workspace under a tight allocation.
  if(!worked&&deferred)break
  if(!projectId)await advanceDispatchCursor(env,project)
  if(deferred||!preparations||!sends)break
 }
}
