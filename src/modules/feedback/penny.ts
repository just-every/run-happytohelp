import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {validateDestination} from '../../vendor/base/modules/integrations/index.ts'
import {httpsTransport} from '../api-integrations/transport'
import {hashToken} from '../../platform/auth'
import {encryptToken,decryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {root,ticket,access,text} from './access'

const sourcePath=ticket+'/sources/:sourceId'
export const pennyRoutes=new Hono<AppEnv>()
pennyRoutes.get(root+'/penny-connection',async c=>{const {actor}=await access(c,'integrations.install'),row=await c.env.DB.prepare('SELECT origin,token_cipher IS NOT NULL connected FROM feedback_penny_connections WHERE project_id=?').bind(actor.projectId).first<any>();return c.json({data:{origin:row?.origin||'',connected:!!row?.connected}})})
pennyRoutes.put(root+'/penny-connection',async c=>{
 const {actor}=await access(c,'integrations.install');await requireStepUp(c,actor,'feedback.penny.install');const body=await c.req.json(),now=Date.now()
 if(body.revoke===true){await c.env.DB.batch([c.env.DB.prepare('UPDATE feedback_penny_connections SET token_cipher=NULL,updated_at=? WHERE project_id=?').bind(now,actor.projectId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'feedback.penny_revoked',actor:{type:'user',id:actor.id},source:requestSource(c)})]);return c.json({saved:true})}
 let origin:string;try{const url=validateDestination(text(body.origin,'Penny origin'));if(url.pathname!=='/'||url.search)throw Error();origin=url.origin}catch{throw new HTTPException(400,{message:'Use the public HTTPS origin of your Penny installation'})}
 const previous=await c.env.DB.prepare('SELECT origin FROM feedback_penny_connections WHERE project_id=? AND EXISTS(SELECT 1 FROM feedback_penny_requesters WHERE project_id=?)').bind(actor.projectId,actor.projectId).first<{origin:string}>()
 if(previous&&previous.origin!==origin)throw new HTTPException(409,{message:'This workspace already has Penny requester history. Keep its Penny installation when rotating credentials.'})
 const cipher=await encryptToken(c.env,actor.projectId,text(body.token,'Penny API key',10000))
 await c.env.DB.batch([c.env.DB.prepare('INSERT INTO feedback_penny_connections VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET origin=excluded.origin,token_cipher=excluded.token_cipher,updated_at=excluded.updated_at').bind(actor.projectId,origin,cipher,now),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'feedback.penny_connected',actor:{type:'user',id:actor.id},source:requestSource(c)})])
 return c.json({saved:true})
})
async function sourceContext(c:any){
 const {actor,conversation}=await access(c,'conversations.manage'),sourceId=c.req.param('sourceId')
 const row=await c.env.DB.prepare(`SELECT s.*,co.name account_name,ct.name contact_name FROM feedback_sources s JOIN contacts ct ON ct.id=s.contact_id AND ct.project_id=s.project_id LEFT JOIN companies co ON co.id=s.account_id AND co.project_id=s.project_id WHERE s.id=? AND s.project_id=? AND s.conversation_id=?`).bind(sourceId,actor.projectId,conversation.id).first<any>()
 if(!row)throw new HTTPException(404)
 const connection=await c.env.DB.prepare('SELECT * FROM feedback_penny_connections WHERE project_id=?').bind(actor.projectId).first<any>()
 if(!connection?.token_cipher)throw new HTTPException(409,{message:'Connect Penny in this workspace before handing off feedback'})
 const url=new URL(row.penny_url),slug=url.pathname.match(/^\/portal\/feedback\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/)?.[1]
 if(url.origin!==connection.origin||!slug)throw new HTTPException(409,{message:'Link a request in the connected Penny installation using its /portal/feedback/request-slug URL'})
 const requester=await c.env.DB.prepare('SELECT requester_id FROM feedback_penny_requesters WHERE project_id=? AND contact_id=?').bind(actor.projectId,row.contact_id).first<any>()
 const payload={source:[`HappyToHelp support feedback${row.account_name?' · Account: '+row.account_name:''}`,row.quote].join('\n\n').slice(0,2000),sourceUrl:new URL(`/projects/${actor.projectId}/conversations/${conversation.id}`,c.req.url).href,...(requester?.requester_id?{requesterId:requester.requester_id}:{contact:{displayName:(row.contact_name||'Support requester').slice(0,160)}})}
 return {actor,conversation,row,connection,slug,payload}
}
pennyRoutes.get(sourcePath+'/handoff-preview',async c=>{const {payload}=await sourceContext(c);return c.json({data:payload,notice:'Only this selected quote, account label, requester name or previously linked Penny id and source URL are shared. No email, private notes or attachments are sent.'})})
pennyRoutes.post(sourcePath+'/handoff',async c=>{
 const {actor,conversation,row,connection,slug,payload}=await sourceContext(c),body=await c.req.json(),db=c.env.DB,now=Date.now()
 if(body.approve!==true)throw new HTTPException(400,{message:'Preview and explicitly approve the Penny handoff'})
 const consent=text(body.sharing_message_id,'requester sharing consent message',200)
 const proof=await db.prepare("SELECT 1 FROM messages WHERE id=? AND project_id=? AND conversation_id=? AND actor_id=? AND actor_role='contact' AND erased_at IS NULL").bind(consent,actor.projectId,conversation.id,row.contact_id).first()
 if(!proof)throw new HTTPException(400,{message:'Select the requester’s sharing permission from this conversation'})
 const existing=await db.prepare('SELECT state FROM feedback_handoffs WHERE source_id=? AND project_id=?').bind(row.id,actor.projectId).first<any>()
 if(existing){if(existing.state==='accepted')return c.json({accepted:true,duplicate:true});throw new HTTPException(409,{message:'The Penny outcome is unknown or still in progress. Check Penny before taking another action; this handoff is never replayed.'})}
 const intent=await hashToken(JSON.stringify({origin:connection.origin,slug,payload,consent})),guard=`EXISTS(SELECT 1 FROM feedback_sources s JOIN conversations c ON c.id=s.conversation_id WHERE s.id=? AND s.project_id=? AND ${contactAvailableSql()})`,args=[row.id,actor.projectId]
 const claim=await db.batch([
 db.prepare(`INSERT OR IGNORE INTO feedback_penny_requesters(project_id,contact_id,claim_source_id) SELECT ?,?,? WHERE ${guard}`).bind(actor.projectId,row.contact_id,row.id,...args),
 db.prepare(`INSERT OR IGNORE INTO feedback_handoffs(source_id,project_id,intent_hash,state,approved_by,consent_message_id,created_at) SELECT ?,?,?,'sending',?,?,? WHERE ${guard} AND EXISTS(SELECT 1 FROM feedback_penny_requesters WHERE project_id=? AND contact_id=? AND (requester_id IS NOT NULL OR claim_source_id=?))`).bind(row.id,actor.projectId,intent,actor.id,consent,now,...args,actor.projectId,row.contact_id,row.id),
 auditStatement(db,{projectId:actor.projectId,category:'approval',action:'feedback.penny_handoff_approved',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'feedback_source',id:row.id}},now,{sql:"EXISTS(SELECT 1 FROM feedback_handoffs WHERE source_id=? AND created_at=? AND approved_by=?)",params:[row.id,now,actor.id]}),
 ])
 if(!claim[1].meta.changes)throw new HTTPException(409,{message:'A source or requester handoff is already in progress. Refresh before continuing.'})
 try{
  const token=await decryptToken(c.env,actor.projectId,connection.token_cipher)
  await access(c,'conversations.manage')
  const current=await db.prepare(`SELECT 1 FROM feedback_handoffs WHERE source_id=? AND state='sending' AND ${guard} AND EXISTS(SELECT 1 FROM feedback_penny_connections WHERE project_id=? AND token_cipher=?)`).bind(row.id,...args,actor.projectId,connection.token_cipher).first()
  if(!current)throw Error('handoff_authority_changed')
  const response=await httpsTransport.send({url:connection.origin+'/api/v1/requests/'+encodeURIComponent(slug)+'/proxy-votes',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)})
  if(response.status<200||response.status>=300)throw Error('provider_refused')
  const receipt=JSON.parse(response.body)
  if(typeof receipt.requesterId!=='string'||!/^[0-9A-HJKMNPQRSTVWXYZ]{26}$/.test(receipt.requesterId)||typeof receipt.created!=='boolean')throw Error('invalid_provider_receipt')
  const settled=await db.batch([
   db.prepare(`UPDATE feedback_handoffs SET state='accepted',settled_at=? WHERE source_id=? AND state='sending' AND ${guard}`).bind(Date.now(),row.id,...args),
   db.prepare(`UPDATE feedback_penny_requesters SET requester_id=? WHERE project_id=? AND contact_id=? AND EXISTS(SELECT 1 FROM feedback_handoffs WHERE source_id=? AND state='accepted')`).bind(receipt.requesterId,actor.projectId,row.contact_id,row.id),
   auditStatement(db,{projectId:actor.projectId,category:'integration',action:'feedback.penny_handoff_accepted',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'feedback_source',id:row.id}},Date.now(),{sql:"EXISTS(SELECT 1 FROM feedback_handoffs WHERE source_id=? AND state='accepted')",params:[row.id]}),
  ])
  if(!settled[0].meta.changes)throw Error('source_erased_during_handoff')
  return c.json({accepted:true,duplicate:false})
 }catch{
  await db.prepare("UPDATE feedback_handoffs SET state='uncertain',settled_at=? WHERE source_id=? AND state='sending'").bind(Date.now(),row.id).run()
  throw new HTTPException(409,{message:'Penny did not provide a confirmed receipt. The outcome is unknown and is not replayed. Check the request in Penny.'})
 }
})
