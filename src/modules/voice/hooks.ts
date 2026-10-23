import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {encryptToken} from '../integrations/secrets'
import {number,callId,providerId,phone,isOpen,usableContact,xml,response,say,limitations,type VoiceSettings,type VoiceNumber} from './model'
import {verifyWebhook} from './provider'
import {admitCall,privateReceipt} from './store'
export const hooks=new Hono<AppEnv>()
const hookUrl=(c:any,n:VoiceNumber,step:string)=>new URL(`/api/voice/hooks/${n.id}?step=${step}`,c.req.url).href
const gather=(url:string,text:string)=>`<Gather input="dtmf" numDigits="1" method="POST" action="${xml(url)}" timeout="8">${say(text)}</Gather>${say('No selection received. Please call again.')}<Hangup/>`
function route(c:any,n:VoiceNumber,call:any,s:VoiceSettings){
 if(!isOpen(s))return voicemail(c,n,call,s)
 if(s.ivr.length)return gather(hookUrl(c,n,'ivr'),s.ivr.map(v=>`Press ${v.digit} for ${v.label}.`).join(' '))
 return dial(c,n,s.human_phone,call.consent==='granted'&&s.recording_enabled)
}
const dial=(c:any,n:VoiceNumber,destination:string,record=false)=>`<Dial ${record?'record="record-from-answer-dual" recordingStatusCallbackMethod="POST" recordingStatusCallback="'+xml(hookUrl(c,n,'recording'))+'" ':''}timeout="25" method="POST" action="${xml(hookUrl(c,n,'dial'))}"><Number>${xml(destination)}</Number></Dial>`
function voicemail(c:any,n:VoiceNumber,call:any,s:VoiceSettings){
 if(call.consent!=='granted'||!s.recording_enabled)return say('Our team is unavailable. Recording is off. Please contact us by chat or email, or call again during business hours.')+'<Hangup/>'
 return say('Our team is unavailable. After the tone, leave a voicemail. Your consented recording and transcript will be available to the support team.')+`<Record maxLength="120" playBeep="true" transcribe="true" recordingStatusCallbackMethod="POST" recordingStatusCallback="${xml(hookUrl(c,n,'recording'))}" transcribeCallback="${xml(hookUrl(c,n,'transcript'))}" action="${xml(hookUrl(c,n,'finish'))}" method="POST"/>`
}
hooks.post('/hooks/:numberId',async c=>{
 const n=await number(c.env,c.req.param('numberId')),b=await verifyWebhook(c,n)
 if(n.provider==='aircall')return aircall(c,n,b)
 const step=c.req.query('step')??'entry',remote=providerId(b.CallSid)
 if((step==='entry'||b.To!==undefined)&&b.To!==n.phone)throw new HTTPException(400,{message:'Webhook number does not match this connection'})
 const id=await callId(n,remote),s:VoiceSettings=JSON.parse(n.settings_json)
 let call=step==='entry'?await admitCall(c.env,n,remote,phone(b.From)):await c.env.DB.prepare(`SELECT v.* FROM voice_calls v JOIN conversations c ON c.id=v.conversation_id AND c.project_id=v.project_id WHERE v.id=? AND v.number_id=? AND v.erased=0 AND ${usableContact}`).bind(id,n.id).first<any>()
 if(!call)throw new HTTPException(404)
 const alive=`EXISTS(SELECT 1 FROM voice_calls v JOIN conversations c ON c.id=v.conversation_id AND c.project_id=v.project_id JOIN voice_numbers vn ON vn.id=v.number_id AND vn.project_id=v.project_id WHERE v.id=? AND v.erased=0 AND vn.enabled=1 AND vn.version=? AND ${usableContact})`,args=[id,n.version]
 if(step==='recording'||step==='transcript'){
  if(call.consent!=='granted'||!s.recording_enabled)throw new HTTPException(409,{message:'Recording consent is unavailable'})
  if(step==='recording'&&b.RecordingStatus==='completed'){
   const recording=await encryptToken(c.env,n.project_id,providerId(b.RecordingSid))
   await c.env.DB.prepare(`UPDATE voice_calls SET recording_cipher=coalesce(recording_cipher,?),state=CASE WHEN state='after_hours' THEN 'voicemail' ELSE state END,updated_at=? WHERE id=? AND ${alive}`).bind(recording,Date.now(),id,...args).run()
  }
  if(step==='transcript'&&b.TranscriptionStatus==='completed'){
   if(typeof b.TranscriptionText!=='string'||b.TranscriptionText.length>16000)throw new HTTPException(400)
   await c.env.DB.prepare(`UPDATE voice_calls SET transcript=coalesce(transcript,?),updated_at=? WHERE id=? AND ${alive}`).bind(b.TranscriptionText,Date.now(),id,...args).run()
  }
  await privateReceipt(c.env,id,'Telephone '+(call.follow_up?'voicemail; follow-up needed':'call')+'. Recording consent granted. Open the authenticated voice call history for its recording and transcript.')
  return c.body(response(''),200,{'Content-Type':'application/xml'})
 }
 if(step==='queue-wait'){
  const waited=Number(b.QueueTime??0)
  return c.body(response(Number.isFinite(waited)&&waited>=120?'<Leave/>':say('You are waiting for a human support teammate.')+'<Pause length="20"/><Redirect method="POST">'+xml(hookUrl(c,n,'queue-wait'))+'</Redirect>'),200,{'Content-Type':'application/xml'})
 }
 if(!['entry','consent','ivr','dial','finish','queue-finish'].includes(step))throw new HTTPException(400)
 const input=await hashToken(JSON.stringify([step,b.Digits??'',b.DialCallStatus??'',b.QueueResult??''])),prior=await c.env.DB.prepare('SELECT * FROM voice_steps WHERE call_id=? AND step=?').bind(id,step).first<any>()
 if(prior){if(prior.input_hash!==input)throw new HTTPException(409,{message:'This voice step already has a different result'});return c.body(prior.response_xml,200,{'Content-Type':'application/xml'})}
 let body='',state=call.state,consent=call.consent,follow=call.follow_up
 if(step==='entry')body=say(limitations)+(s.recording_enabled?gather(hookUrl(c,n,'consent'),'Recording and transcription are optional. Press 1 to consent, or press 2 to continue without recording.'):say('This call is not recorded.')+route(c,n,call,s))
 if(step==='consent'){
  if(!['1','2'].includes(b.Digits))body=say('No valid consent choice. This call will end without recording.')+'<Hangup/>'
  else{consent=b.Digits==='1'?'granted':'declined';call={...call,consent};body=route(c,n,call,s)}
 }
 if(step==='ivr'){const choice=s.ivr.find(v=>v.digit===b.Digits);body=choice?dial(c,n,choice.phone,call.consent==='granted'&&s.recording_enabled):say('That selection is unavailable. Connecting you to the support team.')+dial(c,n,s.human_phone,call.consent==='granted'&&s.recording_enabled);state='queued'}
 if(step==='dial'){
  if(b.DialCallStatus==='completed'){state='completed';body=say('Thank you for calling.')+'<Hangup/>'}
  else{state='transfer_failed';follow=1;body=say('The human transfer failed. The support queue will show a follow-up task.')+(isOpen(s)?`<Enqueue method="POST" action="${xml(hookUrl(c,n,'queue-finish'))}" waitUrlMethod="POST" waitUrl="${xml(hookUrl(c,n,'queue-wait'))}">${xml('h2h-'+n.id.slice(-30))}</Enqueue>`:voicemail(c,n,call,s))}
 }
 if(step==='queue-finish'){if(b.QueueResult==='bridged'){state='completed';body=say('Thank you for calling.')+'<Hangup/>'}else{state='transfer_failed';follow=1;body=say('A human teammate could not answer in time.')+voicemail(c,n,call,s)}}
 if(step==='finish'){state='voicemail';follow=1;body=say('Thank you. Your message is with the support team.')+'<Hangup/>'}
 if((step==='entry'||step==='consent')&&!isOpen(s)){state='after_hours';follow=1}
 const output=response(body),now=Date.now(),summary=state==='transfer_failed'?'Human transfer failed; follow-up needed':state==='after_hours'?'After-hours call; follow-up needed':state==='voicemail'?'Voicemail; follow-up needed':'Telephone call: '+state
 const results=await c.env.DB.batch([
 c.env.DB.prepare(`INSERT OR IGNORE INTO voice_steps(call_id,step,input_hash,response_xml) SELECT ?,?,?,? WHERE ${alive}`).bind(id,step,input,output,...args),
 c.env.DB.prepare(`UPDATE voice_calls SET consent=?,state=?,follow_up=?,summary=?,updated_at=? WHERE id=? AND ${alive} AND EXISTS(SELECT 1 FROM voice_steps WHERE call_id=? AND step=? AND input_hash=?)`).bind(consent,state,follow,summary,now,id,...args,id,step,input),
 c.env.DB.prepare(`INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,source,target_type,target_id,detail_json) SELECT ?,project_id,?,'integration',?,'succeeded','system','integration','conversation',conversation_id,? FROM voice_calls WHERE id=? AND ${alive}`).bind('voice-step:'+id+':'+step,now,step==='consent'?'voice.consent_recorded':'voice.routing_step',JSON.stringify({step,consent,state}),id,...args),
 ])
 if(!results[1].meta.changes)throw new HTTPException(409,{message:'Call, connection or consent changed'})
 const committed=await c.env.DB.prepare('SELECT input_hash,response_xml FROM voice_steps WHERE call_id=? AND step=?').bind(id,step).first<any>()
 if(committed?.input_hash!==input)throw new HTTPException(409)
 await privateReceipt(c.env,id,summary+'. Recording consent: '+consent+'. Voice history: /api/voice/projects/'+n.project_id+'/conversations/'+call.conversation_id+'/calls')
 return c.body(committed.response_xml,200,{'Content-Type':'application/xml'})
})
async function aircall(c:any,n:VoiceNumber,b:any){
 if(!['call.created','call.answered','call.ended'].includes(b.event)||String(b.data?.number?.id)!==n.provider_id||b.data?.direction!=='inbound')throw new HTTPException(400)
 const call=await admitCall(c.env,n,providerId(String(b.data.id)),phone(b.data.raw_digits)),ended=b.event==='call.ended',missed=ended&&!b.data.answered_at,state=ended?(missed?'missed':'completed'):b.event==='call.answered'?'answered':'ringing'
 await c.env.DB.prepare(`UPDATE voice_calls SET state=?,follow_up=?,summary=?,updated_at=? WHERE id=? AND erased=0 AND state NOT IN ('completed','missed') AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=voice_calls.conversation_id AND c.project_id=voice_calls.project_id AND ${usableContact}) AND EXISTS(SELECT 1 FROM voice_numbers WHERE id=? AND enabled=1 AND version=?)`).bind(state,missed?1:0,'Aircall '+state+(missed?'; follow-up needed':''),Date.now(),call.id,n.id,n.version).run()
 const final=await c.env.DB.prepare('SELECT state FROM voice_calls WHERE id=?').bind(call.id).first()
 await privateReceipt(c.env,call.id,'Aircall '+(final?.state??state)+'. Routing and recording consent are managed in Aircall; recordings are not imported. Open authenticated voice history for linked calls.')
 return c.json({data:{id:call.id,conversation_id:call.conversation_id}})
}
