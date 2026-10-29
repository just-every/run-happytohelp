import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {ticketAuthority,object,named} from '../tickets/model'
import {callAccess,number,usableContact} from './model'
import {providerRequest} from './provider'
import {auditStatement,requestSource} from '../audit/record'
const base='/projects/:projectId/conversations/:conversationId'
export const privacyRoutes=new Hono<AppEnv>()
privacyRoutes.post(base+'/calls/:callId/withdraw',async c=>{
 const {actor,conversation,guard}=await callAccess(c),id=c.req.param('callId'),now=Date.now()
 const call=await c.env.DB.prepare('SELECT * FROM voice_calls WHERE id=? AND conversation_id=? AND project_id=? AND erased=0').bind(id,conversation.id,actor.projectId).first<any>()
 if(!call)throw new HTTPException(404)
 const valid=`EXISTS(SELECT 1 FROM conversations c WHERE c.id=voice_calls.conversation_id AND c.project_id=voice_calls.project_id AND ${usableContact}) AND EXISTS(${guard.sql})`
 const result=await c.env.DB.batch([
 c.env.DB.prepare(`UPDATE voice_calls SET media_withdrawn_at=?,consent='declined',recording_cipher=NULL,transcript=NULL,summary='',provider_stop_state='sending',updated_at=? WHERE id=? AND media_withdrawn_at IS NULL AND ${valid}`).bind(now,now,id,...guard.params),
 c.env.DB.prepare('DELETE FROM voice_transcript_segments WHERE call_id=? AND EXISTS(SELECT 1 FROM voice_calls WHERE id=? AND media_withdrawn_at IS NOT NULL)').bind(id,id),
 c.env.DB.prepare("UPDATE voice_steps SET response_xml='' WHERE call_id=? AND EXISTS(SELECT 1 FROM voice_calls WHERE id=? AND media_withdrawn_at IS NOT NULL)").bind(id,id),
 auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'voice.consent_withdrawn',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'conversation',id:conversation.id}},now,{sql:'EXISTS(SELECT 1 FROM voice_calls WHERE id=? AND media_withdrawn_at=?)',params:[id,now]}),
 ])
 if(result[0].meta.changes){
  let state='unavailable'
  try{
   const n=await number(c.env,call.number_id,actor.projectId)
   if(n.provider==='twilio'&&call.remote_cipher){
    const remote=await decryptToken(c.env,actor.projectId,call.remote_cipher)
    const r=await providerRequest(c.env,n,`/Calls/${encodeURIComponent(remote)}.json`,{Status:'completed'})
    state=r.ok?'accepted':r.status>=400&&r.status<500?'rejected':'uncertain'
   }
  }catch{state='uncertain'}
  await c.env.DB.prepare("UPDATE voice_calls SET provider_stop_state=? WHERE id=? AND erased=0 AND provider_stop_state='sending'").bind(state,id).run()
 }
 const saved=await c.env.DB.prepare('SELECT media_withdrawn_at,provider_stop_state FROM voice_calls WHERE id=? AND erased=0').bind(id).first<any>()
 if(!saved?.media_withdrawn_at)throw new HTTPException(409)
 return c.json({data:{withdrawn:true,provider_stop_state:saved.provider_stop_state==='sending'?'uncertain':saved.provider_stop_state},notice:'Local media removed. The active call is asked to end once. Check the provider for the stop outcome and delete retained provider copies; an accepted request is not confirmed deletion.'})
})
const contactUsable=`coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_deleted'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)=0 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=ct.project_id AND e.contact_id=ct.id)`
export async function linkedContext(c:any,actor:any,conversation:any){
 const row=await c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email,l.linked_at FROM voice_context_links l JOIN contacts ct ON ct.id=l.linked_contact_id AND ct.project_id=l.project_id WHERE l.project_id=? AND l.contact_id=? AND ${contactUsable}`).bind(actor.projectId,conversation.contact_id).first()
 if(!row)return null
 const history=(await c.env.DB.prepare(`SELECT c.id,c.subject,c.channel FROM conversations c WHERE c.project_id=? AND c.contact_id=? AND ${usableContact} ORDER BY c.updated_at DESC LIMIT 20`).bind(actor.projectId,row.id).all()).results
 return {...row,conversations:history,authority:'Operator context only. Verify the caller independently before account actions.'}
}
privacyRoutes.get(base+'/context-candidates',async c=>{
 const {actor}=await callAccess(c);await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'contacts.manage')
 const email=named(c.req.query('email'),320).toLowerCase()
 const rows=(await c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email FROM contacts ct WHERE ct.project_id=? AND lower(ct.email)=? AND ${contactUsable} LIMIT 20`).bind(actor.projectId,email).all()).results
 return c.json({data:rows})
})
privacyRoutes.put(base+'/context-link',async c=>{
 const {actor,conversation}=await callAccess(c),guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'contacts.manage'),b=object(await c.req.json()),target=b.contact_id?named(b.contact_id):null,now=Date.now()
 if(target===conversation.contact_id)throw new HTTPException(400)
 const valid=`EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND ${usableContact})`,args=[...guard.params,conversation.id,actor.projectId]
 const result=await c.env.DB.batch([
 target?c.env.DB.prepare(`INSERT INTO voice_context_links(project_id,contact_id,linked_contact_id,linked_by,linked_at) SELECT ?,?,?,?,? WHERE ${valid} AND EXISTS(SELECT 1 FROM voice_identities WHERE project_id=? AND contact_id=? AND erased=0) AND EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=? AND ct.project_id=? AND ${contactUsable}) ON CONFLICT(project_id,contact_id) DO UPDATE SET linked_contact_id=excluded.linked_contact_id,linked_by=excluded.linked_by,linked_at=excluded.linked_at`).bind(actor.projectId,conversation.contact_id,target,actor.id,now,...args,actor.projectId,conversation.contact_id,target,actor.projectId):c.env.DB.prepare(`DELETE FROM voice_context_links WHERE project_id=? AND contact_id=? AND ${valid}`).bind(actor.projectId,conversation.contact_id,...args),
 auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:target?'voice.context_linked':'voice.context_unlinked',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'conversation',id:conversation.id},detail:{authority:'operator_context_only'}},now,{sql:`changes()>0`,params:[]}),
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Contact or authority changed; reload'})
 return c.json({data:await linkedContext(c,actor,conversation)})
})
