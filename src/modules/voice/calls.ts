import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {decryptToken} from '../integrations/secrets'
import {object,named,invalid} from '../tickets/model'
import {callAccess,voiceAccess,number,usableContact,phone,xml,response,say,credentials,type VoiceSettings} from './model'
import {providerRequest} from './provider'
import {privateReceipt} from './store'
const base='/projects/:projectId/conversations/:conversationId'
export const callRoutes=new Hono<AppEnv>()
callRoutes.get(base+'/calls',async c=>{
 const {actor,conversation}=await callAccess(c)
 const rows=(await c.env.DB.prepare(`SELECT v.id,v.number_id,n.provider,n.phone support_number,v.direction,v.state,v.consent,v.transcript,v.summary,v.follow_up,v.created_at,v.updated_at,v.recording_cipher IS NOT NULL has_recording FROM voice_calls v JOIN voice_numbers n ON n.id=v.number_id AND n.project_id=v.project_id JOIN conversations c ON c.id=v.conversation_id AND c.project_id=v.project_id WHERE v.project_id=? AND v.conversation_id=? AND v.erased=0 AND ${usableContact} ORDER BY v.created_at DESC,v.id LIMIT 100`).bind(actor.projectId,conversation.id).all()).results
 const commands=(await c.env.DB.prepare('SELECT id,kind,state,created_at FROM voice_commands WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 100').bind(actor.projectId,conversation.id).all()).results
 return c.json({data:rows,commands:commands.map((v:any)=>({...v,state:v.state==='sending'?'uncertain':v.state})),agent:{available:false,hook:'Voice uses the native conversation ID. Governed AI procedures and immediate agent handoff belong to AGENT-001.'}})
})
callRoutes.post(base+'/commands',async c=>{
 const {actor,conversation,guard}=await callAccess(c,true),b=object(await c.req.json()),kind=b.kind
 if(!['callback','transfer'].includes(kind))invalid('Choose callback or human transfer')
 const requestId=named(b.request_id,100),n=await number(c.env,named(b.number_id),actor.projectId),s:VoiceSettings=JSON.parse(n.settings_json),call=await c.env.DB.prepare('SELECT * FROM voice_calls WHERE id=? AND project_id=? AND conversation_id=? AND number_id=? AND erased=0').bind(named(b.call_id),actor.projectId,conversation.id,n.id).first<any>()
 if(!call)throw new HTTPException(404)
 if(kind==='transfer'&&(n.provider!=='twilio'||!['ringing','queued','answered','transfer_failed'].includes(call.state)))throw new HTTPException(409,{message:'Only an active Twilio call can transfer here. Aircall transfers remain in Aircall.'})
 if(n.provider==='aircall'&&!s.aircall_user_id)throw new HTTPException(409,{message:'Configure the Aircall teammate ID before calling back'})
 const intent=await hashToken(JSON.stringify([kind,n.id,call.id])),id='voice-command-'+await hashToken(JSON.stringify([actor.projectId,actor.id,requestId])),now=Date.now()
 const result=await c.env.DB.prepare(`INSERT OR IGNORE INTO voice_commands(id,project_id,conversation_id,number_id,call_id,kind,intent_hash,state,created_at,updated_at) SELECT ?,c.project_id,c.id,?,?,?,?,'sending',?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND ${usableContact} AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM voice_numbers vn WHERE vn.id=? AND vn.project_id=c.project_id AND vn.enabled=1 AND vn.version=?)`).bind(id,n.id,call.id,kind,intent,now,now,conversation.id,actor.projectId,...guard.params,n.id,n.version).run()
 const command=await c.env.DB.prepare('SELECT state,intent_hash FROM voice_commands WHERE id=? AND project_id=?').bind(id,actor.projectId).first<any>()
 if(!command)throw new HTTPException(409,{message:'Call or authority changed'})
 if(command.intent_hash!==intent)throw new HTTPException(409,{message:'Request ID was already used for a different voice command'})
 // A lost response, process restart or provider 5xx never triggers an automatic replay.
 if(!result.meta.changes)return c.json({data:{id,state:command.state==='sending'?'uncertain':command.state,duplicate:true}})
 const identity=await c.env.DB.prepare(`SELECT vi.phone_cipher FROM voice_identities vi JOIN conversations c ON c.contact_id=vi.contact_id AND c.project_id=vi.project_id WHERE c.id=? AND c.project_id=? AND vi.erased=0 AND ${usableContact} AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM voice_numbers WHERE id=? AND enabled=1 AND version=?)`).bind(conversation.id,actor.projectId,...guard.params,n.id,n.version).first<{phone_cipher:string}>()
 if(!identity?.phone_cipher)throw new HTTPException(409,{message:'Caller or authority is unavailable'})
 const customer=phone(await decryptToken(c.env,actor.projectId,identity.phone_cipher)),remote=call.remote_cipher?await decryptToken(c.env,actor.projectId,call.remote_cipher):null
 let state='uncertain'
 try{
  const transfer=`<Dial timeout="25" action="${xml(new URL('/api/voice/hooks/'+n.id+'?step=dial',c.req.url).href)}" method="POST"><Number>${xml(s.human_phone)}</Number></Dial>`
  const body:Record<string,string>=n.provider==='aircall'?{number_id:n.provider_id,to:customer}:kind==='transfer'?{Twiml:response(say('Connecting you to a human support teammate.')+transfer)}:{From:n.phone,To:s.human_phone,Twiml:response(say('Support callback. Recording is off.')+`<Dial callerId="${xml(n.phone)}"><Number>${xml(customer)}</Number></Dial>`),Record:'false'}
  const path=n.provider==='aircall'?`/users/${encodeURIComponent(s.aircall_user_id)}/calls`:kind==='transfer'?`/Calls/${encodeURIComponent(remote!)}.json`:'/Calls.json'
  const answered=await providerRequest(c.env,n,path,body,async()=>{
   if(!await c.env.DB.prepare(`SELECT c.id FROM conversations c WHERE c.id=? AND c.project_id=? AND ${usableContact} AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM voice_numbers WHERE id=? AND enabled=1 AND version=?) AND EXISTS(SELECT 1 FROM voice_commands WHERE id=? AND state='sending') AND EXISTS(SELECT 1 FROM voice_calls WHERE id=? AND erased=0)`).bind(conversation.id,actor.projectId,...guard.params,n.id,n.version,id,call.id).first())throw new HTTPException(409)
  })
  state=answered.ok?'accepted':answered.status>=400&&answered.status<500?'rejected':'uncertain'
 }catch{state='uncertain'}
 await c.env.DB.batch([
 c.env.DB.prepare(`UPDATE voice_commands SET state=?,updated_at=? WHERE id=? AND state='sending' AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=voice_commands.conversation_id AND c.project_id=voice_commands.project_id AND ${usableContact})`).bind(state,Date.now(),id),
 c.env.DB.prepare(`UPDATE voice_calls SET state='transfer_failed',follow_up=1,summary='Human transfer failed or outcome unknown; follow-up needed',updated_at=? WHERE id=? AND erased=0 AND ?='transfer' AND ?<>'accepted'`).bind(Date.now(),call.id,kind,state),
 c.env.DB.prepare(`INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,project_id,?,'integration','voice.command_settled',?,'user',?,'dashboard','conversation',conversation_id,? FROM voice_commands WHERE id=? AND state<>'erased'`).bind(id,Date.now(),state==='accepted'?'succeeded':'failed',actor.id,JSON.stringify({kind,state}),id),
 ])
 if(kind==='transfer'&&state!=='accepted')await privateReceipt(c.env,call.id,'Automatic voice receipt: human transfer failed or its outcome is unknown. Follow-up is needed. Check the provider before trying another call.')
 const final=await c.env.DB.prepare('SELECT state FROM voice_commands WHERE id=?').bind(id).first<{state:string}>()
 return c.json({data:{id,state:final?.state==='sending'?'uncertain':final?.state??'erased'}},202)
})
callRoutes.get(base+'/calls/:callId/recording',async c=>{
 const {actor,conversation}=await callAccess(c),id=c.req.param('callId')
 const call=await c.env.DB.prepare('SELECT * FROM voice_calls WHERE id=? AND project_id=? AND conversation_id=? AND erased=0 AND consent=\'granted\'').bind(id,actor.projectId,conversation.id).first<any>()
 if(!call?.recording_cipher)throw new HTTPException(404)
 const n=await number(c.env,call.number_id,actor.projectId);if(n.provider!=='twilio')throw new HTTPException(404)
 const recording=await decryptToken(c.env,actor.projectId,call.recording_cipher),token=await credentials(c.env,n)
 const result=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(n.account_id)}/Recordings/${encodeURIComponent(recording)}.mp3`,{headers:{Authorization:'Basic '+btoa(n.account_id+':'+token)},redirect:'manual',signal:AbortSignal.timeout(10000)})
 if(!result.ok){await result.body?.cancel();throw new HTTPException(502,{message:'Recording unavailable from the provider'})}
 // Do not start disclosing media if erasure or role revocation completed during the provider read.
 await callAccess(c)
 if(!await c.env.DB.prepare('SELECT id FROM voice_calls WHERE id=? AND erased=0 AND recording_cipher=?').bind(id,call.recording_cipher).first()){await result.body?.cancel();throw new HTTPException(404)}
 return new Response(result.body,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store','Content-Disposition':'attachment; filename="support-call.mp3"','X-Content-Type-Options':'nosniff'}})
})
callRoutes.get('/projects/:projectId/report',async c=>{
 const {actor}=await voiceAccess(c,'reports.view')
 const rows=(await c.env.DB.prepare(`SELECT n.provider,v.state,count(*) calls,sum(v.follow_up) follow_up FROM voice_calls v JOIN voice_numbers n ON n.id=v.number_id AND n.project_id=v.project_id JOIN conversations c ON c.id=v.conversation_id AND c.project_id=v.project_id WHERE v.project_id=? AND v.erased=0 AND ${usableContact} GROUP BY n.provider,v.state`).bind(actor.projectId).all()).results
 return c.json({data:rows,definition:'All retained voice call records in this workspace; follow-up counts missed, after-hours and failed-transfer calls. Provider acceptance is not customer receipt. Erased customers are excluded.'})
})
