import {HTTPException} from 'hono/http-exception'
import {auditStatement} from '../audit/record'
import type {Env} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'
import {decryptToken} from '../integrations/secrets'
import {httpsTransport} from '../api-integrations/transport'
import {thread,connection} from '../support-channels/model'
import {blocker} from '../support-channels/outbound'
import {channelRequest} from '../support-channels/request'
import {liveCycleSql,surveyJoins,activeSurveySql,type Survey} from './survey-store'
import {surveySigningConfigured,surveyURL,type SurveySurface} from './survey-links'
import {surveyCopy} from './survey-html'
type Filter={projectId?:string;conversationId?:string}
const native=`EXISTS(SELECT 1 FROM support_channel_threads st JOIN support_channel_connections sc ON sc.id=st.connection_id AND sc.project_id=st.project_id WHERE st.conversation_id=c.id AND st.project_id=c.project_id AND st.contact_id=ct.id AND sc.provider=c.channel)
 AND c.channel IN ('sms','whatsapp','instagram','messenger')
 AND NOT EXISTS(SELECT 1 FROM move_in_conversations m WHERE m.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations l WHERE l.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM legacy_import_rows l WHERE l.target_table='conversations' AND l.target_key=c.id)
 AND NOT EXISTS(SELECT 1 FROM ik_provenance ip WHERE ip.target_kind='conversation' AND ip.target_id=c.id AND ip.reversed=0)`
/** Snapshot the original channel, never its phone number or page-scoped identity.
 * Refused invitations retain a terminal, inspectable reason in the send ledger. */
export async function scheduleMessagingSurveys(env:Env,now:number,filter:Filter={}){
 await env.DB.prepare(`INSERT OR IGNORE INTO csat_surveys(id,project_id,resolution_id,conversation_id,contact_id,recipient,channel,scale,locale,due_at,expires_at,state,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),r.project_id,r.id,c.id,r.contact_id,'',c.channel,cfg.scale,cfg.locale,r.resolved_at+cfg.delay_minutes*60000,r.resolved_at+cfg.delay_minutes*60000+cfg.expires_days*86400000,'pending',?,?
 FROM conversation_resolutions r JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id JOIN contacts ct ON ct.id=r.contact_id AND ct.project_id=r.project_id JOIN csat_settings cfg ON cfg.project_id=r.project_id
 WHERE ${liveCycleSql} AND ${native} AND cfg.enabled=1 AND r.resolved_at>=cfg.enabled_at
 AND NOT EXISTS(SELECT 1 FROM csat_responses v WHERE v.resolution_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM csat_surveys s WHERE s.resolution_id=r.id)
 ${filter.projectId?'AND r.project_id=?':''} ${filter.conversationId?'AND c.id=?':''}
 ORDER BY r.resolved_at LIMIT 50`).bind(now,now,...(filter.projectId?[filter.projectId]:[]),...(filter.conversationId?[filter.conversationId]:[])).run()
}
async function refusal(env:Env,row:Survey,now:number){
 const live=await env.DB.prepare(`SELECT s.id ${surveyJoins} WHERE s.id=? AND ${activeSurveySql} AND ${native} AND EXISTS(SELECT 1 FROM csat_settings cfg WHERE cfg.project_id=s.project_id AND cfg.enabled=1)`).bind(row.id,now).first()
 const t=await thread(env,row.project_id,row.conversation_id)
 return {t,reason:t?blocker(t,now)??(!live?'survey_no_longer_available':null):'contact_unavailable'}
}
export async function dispatchMessagingSurveys(env:Env,now:number,filter:Filter={}){
 if(!cronRoom(env,6))return 0
 await scheduleMessagingSurveys(env,now,filter)
 // Recover a process lost after its durable claim without issuing another request.
 await env.DB.prepare("UPDATE csat_surveys SET state='uncertain',updated_at=? WHERE channel IN ('sms','whatsapp','instagram','messenger') AND state IN ('pending','sending') AND EXISTS(SELECT 1 FROM support_channel_sends d WHERE d.message_id='csat:'||csat_surveys.id)").bind(now).run()
 await env.DB.prepare("UPDATE support_channel_sends SET state='uncertain',error_code='provider_outcome_unknown',updated_at=? WHERE message_id LIKE 'csat:%' AND state='sending'").bind(now).run()
 if(!surveySigningConfigured(env))return 0
 const rows=await env.DB.prepare(`SELECT * FROM csat_surveys WHERE channel IN ('sms','whatsapp','instagram','messenger') AND state='pending' AND due_at<=? ${filter.projectId?'AND project_id=?':''} ${filter.conversationId?'AND conversation_id=?':''} ORDER BY due_at,id LIMIT 25`).bind(now,...(filter.projectId?[filter.projectId]:[]),...(filter.conversationId?[filter.conversationId]:[])).all<Survey>()
 let processed=0
 for(const row of rows.results){
  if(!cronRoom(env,15))break
  const url=await surveyURL(env,row,row.channel as SurveySurface),copy=surveyCopy[row.locale],id='csat:'+row.id
  const {t,reason}=await refusal(env,row,now)
  const claim=await env.DB.prepare("INSERT OR IGNORE INTO support_channel_sends VALUES(?,?,?,?,?,?,NULL,?,?)").bind(id,row.project_id,row.conversation_id,t?.connection_id??'',reason?'blocked':'sending',reason?.split(':')[0]??null,now,now).run()
  if(!claim.meta.changes)continue
  processed++
  let state=reason?'suppressed':'uncertain',sendState=reason?'blocked':'uncertain',error=reason?.split(':')[0]??'provider_outcome_unknown',providerId:string|null=null,requested=false
  await env.DB.prepare("UPDATE csat_surveys SET state=?,updated_at=? WHERE id=? AND state='pending'").bind(reason?'suppressed':'sending',now,row.id).run()
  if(!reason)try{
   const current=await connection(env,t.connection_id),token=await decryptToken(env,row.project_id,current.token_cipher!)
   const request=await channelRequest(env,t,current,token,`${copy.question}\n\n${copy.invite}\n${url}\n\n${copy.optout}: ${url}/optout`)
   const fresh=await refusal(env,row,Date.now()),freshConnection=await connection(env,t.connection_id)
   if(fresh.reason||freshConnection.token_cipher!==current.token_cipher){state='suppressed';sendState='blocked';error=fresh.reason?.split(':')[0]??'channel_authority_changed'}
   else{
    requested=true
    const response=await httpsTransport.send(request),data=(()=>{try{return JSON.parse(response.body)}catch{return null}})()
    providerId=data?.sid??data?.id??data?.messages?.[0]?.id??data?.message_id??null
    if(response.status>=200&&response.status<300&&providerId){state='sent';sendState='accepted';error=''}
    else if(response.status>=400&&response.status<500){state='failed';sendState='failed';error='provider_rejected'}
   }
  }catch(cause){
   if(!requested&&cause instanceof HTTPException&&cause.status===410){state='suppressed';sendState='blocked';error='connection_revoked'}
   // A lost response is terminal uncertainty; never replay this durable claim.
  }
  await env.DB.batch([
   env.DB.prepare("UPDATE support_channel_sends SET state=?,error_code=?,provider_id=?,updated_at=? WHERE message_id=? AND error_code IS NOT 'contact_erased'").bind(sendState,error||null,providerId,Date.now(),id),
   env.DB.prepare("UPDATE csat_surveys SET state=?,updated_at=? WHERE id=? AND revoked_at IS NULL").bind(state,Date.now(),row.id),
   auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'csat.invitation',actor:{type:'system'},source:'system',target:{type:'survey',id:row.id},detail:{state,channel:row.channel,reason:error||null,resolutionId:row.resolution_id}})
  ])
 }
 return processed
}
