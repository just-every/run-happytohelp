import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {voiceArchiveSafety} from '../../../scripts/installer/voice-archive.mjs'
export const secret='synthetic-happytohelp-1'
export const account='synthetic-happytohelp-2'
export const providerNumber='synthetic-happytohelp-3'
export const numberPhone='+12025550101'
export const callerPhone='+12025550102'
export const settings={timezone:'America/Los_Angeles',hours:Array.from({length:7},(_,day)=>({day,start:'00:00',end:'23:59'})),human_phone:'+12025550103',aircall_user_id:'7',group_id:null,ivr:[{digit:'1',label:'Support',phone:'+12025550104'}],jurisdiction:'US-CA',recording_enabled:true,staff_consent:true,retention_days:1}
export function signature(url,form){let value=url;for(const key of Object.keys(form).sort())value+=key+form[key];return createHmac('sha1',secret).update(value).digest('base64')}
export async function voiceHarness(){
 let reply=200,onRequest
 const app=await startApp({bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async(request,entry)=>{
  const url=new URL(request.url);assert.ok(['api.twilio.com','api.aircall.io'].includes(url.hostname));assert.equal(entry.headers.authorization,'Basic '+Buffer.from(account+':'+secret).toString('base64'))
  if(onRequest){const next=onRequest;onRequest=null;await next()}
  if(url.pathname.includes('/IncomingPhoneNumbers/'))return Response.json({sid:providerNumber,account_sid:account,phone_number:numberPhone})
  if(url.pathname==='/v1/numbers/8')return Response.json({number:{id:8,digits:'+12025550105'}})
  if(url.pathname.endsWith('.mp3'))return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}})
  return Response.json({sid:'synthetic-happytohelp-4',call:{id:9}},{status:reply})
 }})
 try{
 const ws=await app.seedWorkspace('voice'),foreign=await app.seedWorkspace('voice-foreign'),token=ws.tokens.owner,base=`/api/voice/projects/${ws.projectId}`
 const connect=async(options={})=>(await app.ok(base+'/numbers',{token,body:{provider:'twilio',provider_id:providerNumber,account_id:account,token:secret,settings,...options}})).data
 let number=await connect()
 const hook=async({step,command,remote='synthetic-happytohelp-5',extra={},signed=true,options={}}={})=>{
  const path='/api/voice/hooks/'+number.id+(step?'?step='+step:'')+(command?'&command='+command:''),form={AccountSid:account,CallSid:remote,...(step==='recording'?{}:{From:callerPhone,To:numberPhone}),...extra},raw=new URLSearchParams(form).toString()
  return app.call(path,{body:raw,raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded',...(signed?{'X-Twilio-Signature':signature(app.origin+path,form)}:{})},...options})
 }
 const open=async(options)=>{const result=await hook(options);assert.equal(result.status,200,JSON.stringify(result.data));return app.first('SELECT * FROM voice_calls ORDER BY created_at DESC,id DESC LIMIT 1')}
 const calls=async conversationId=>(await app.ok(base+`/conversations/${conversationId}/calls`,{token})).data
 return {app,ws,foreign,token,base,hook,open,calls,get number(){return number},connect,async configure(change){number=await connect({version:number.version,settings:{...settings,...change}})},setReply(status){reply=status},duringRequest(fn){onRequest=fn},close:()=>app.close()}
 }catch(error){await app.close();throw error}
}
// Connect and disconnect through native settings; machine or foreign authority cannot configure a number.
export async function credentialsProof(){const h=await voiceHarness();try{
 const {app,base,ws,foreign,token}=h,list=await app.ok(base+'/numbers',{token})
 assert.ok(list.data[0].connected);assert.equal(JSON.stringify(list).includes(secret),false)
 const body={provider:'twilio',provider_id:providerNumber,account_id:account,token:secret,settings}
 assert.equal((await app.call(base+'/numbers',{token:ws.tokens.operator,body})).status,403)
 assert.equal((await app.call(base+'/numbers',{token:foreign.tokens.owner,body})).status,403)
 await app.ok(base+'/numbers/'+h.number.id,{token,method:'PATCH',body:{version:h.number.version,settings:{...settings,retention_days:2}}})
 const call=await h.open();await app.ok(base+'/numbers/'+h.number.id,{token,method:'DELETE'})
 assert.equal((await h.hook()).status,404)
 assert.equal((await app.call(base+`/conversations/${call.conversation_id}/commands`,{token,body:{kind:'callback',number_id:h.number.id,call_id:call.id,request_id:'disconnected'}})).status,404)
}finally{await h.close()}}
export async function signedDeliveryProof(){const h=await voiceHarness();try{
 assert.equal((await h.hook({signed:false})).status,401)
 assert.equal((await h.hook({extra:{AccountSid:'synthetic-happytohelp-9'}})).status,401)
 assert.equal((await h.hook({extra:{To:'+12025550999'}})).status,400)
 const call=await h.open(),first=await h.hook(),repeat=await h.hook();assert.equal(first.data,repeat.data)
 assert.equal((await h.app.first('SELECT count(*) n FROM voice_calls')).n,1);assert.equal((await h.app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',call.conversation_id)).n,1)
 assert.equal((await h.app.first('SELECT count(*) n FROM contacts WHERE project_id=?',h.ws.projectId)).n,1)
 assert.equal((await h.hook({extra:{From:'+12025550888'}})).status,409);assert.equal((await h.app.first('SELECT count(*) n FROM contacts WHERE project_id=?',h.ws.projectId)).n,1,'a conflicting replay creates no caller identity')
 const {data:air}=await h.app.ok(h.base+'/numbers',{token:h.token,body:{provider:'aircall',provider_id:'8',account_id:account,token:secret,settings}})
 const path='/api/voice/hooks/'+air.id,event={token:air.webhook_token,event:'call.ended',data:{id:8,number:{id:8},direction:'inbound',raw_digits:callerPhone,answered_at:null,recording:'https://example.test/never-import-without-consent'}}
 assert.equal((await h.app.call(path,{body:{...event,token:'synthetic-happytohelp-10'}})).status,401)
 assert.equal((await h.app.call(path,{body:event})).status,200);assert.equal((await h.app.call(path,{body:event})).status,200)
 assert.equal((await h.app.call(path,{body:{...event,event:'call.created'}})).status,200)
 const calls=await h.calls(call.conversation_id),aircall=calls.find(c=>c.provider==='aircall');assert.equal(aircall.state,'missed');assert.equal(aircall.follow_up,1);assert.equal(aircall.has_recording,0)
 assert.equal((await h.app.first('SELECT count(*) n FROM voice_calls')).n,2)
}finally{await h.close()}}
export async function routingProof(){const h=await voiceHarness();try{
 const {app,token,base}=h,call=await h.open(),entry=await h.hook();assert.doesNotMatch(entry.data,/<Record /)
 const denied=await h.hook({step:'consent',extra:{Digits:'2'}});assert.equal(denied.status,200);assert.match(denied.data,/Press 1 for Support/)
 const ivr=await h.hook({step:'ivr',extra:{Digits:'1'}});assert.equal(ivr.status,200);assert.match(ivr.data,/<Number>\+12025550104<\/Number>/)
 const failed=await h.hook({step:'dial',extra:{DialCallStatus:'busy'}});assert.equal(failed.status,200);assert.doesNotMatch(failed.data,/<Record /);assert.match(failed.data,/<Enqueue /);const wait=await h.hook({step:'queue-wait',extra:{QueueTime:'121'}});assert.match(wait.data,/<Leave\/>/);const queueEnd=await h.hook({step:'queue-finish',extra:{QueueResult:'leave'}});assert.equal(queueEnd.status,200)
 assert.equal((await h.calls(call.conversation_id))[0].follow_up,1)
 assert.equal((await h.hook({step:'recording',extra:{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-11'}})).status,409)
 assert.equal((await h.hook({step:'consent',extra:{Digits:'1'}})).status,409,'consent cannot be silently replaced on replay')
 await h.configure({hours:[]});const remote='synthetic-happytohelp-12';await h.open({remote})
 const vm=await h.hook({remote,step:'consent',extra:{Digits:'1'}});assert.equal(vm.status,200);assert.match(vm.data,/<Record /);assert.match(vm.data,/transcribe="true"/)
 const latest=await app.first('SELECT * FROM voice_calls WHERE id<>?',call.id)
 assert.equal(latest.conversation_id,call.conversation_id,'repeat caller retains linked history')
 assert.equal((await h.hook({remote,step:'recording',extra:{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-13'}})).status,200)
 assert.equal((await h.hook({remote,step:'transcript',extra:{TranscriptionStatus:'completed',TranscriptionText:'Please call me about the export.'}})).status,200)
 const history=await h.calls(call.conversation_id),record=history.find(c=>c.id===latest.id);assert.equal(history.length,2);assert.equal(record.has_recording,1);assert.equal(record.transcript,'Please call me about the export.');assert.equal(record.consent,'granted')
 const media=base+`/conversations/${call.conversation_id}/calls/${latest.id}/recording`
 assert.equal((await app.call(media)).status,401);assert.equal((await app.call(media,{token:h.foreign.tokens.owner})).status,404)
 const downloaded=await app.request(media,{token});assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('Cache-Control'),'no-store');assert.deepEqual([...new Uint8Array(await downloaded.arrayBuffer())],[1,2,3])
 const inbox=await app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations`,{token});assert.ok(inbox.data.some(c=>c.id===call.conversation_id),'private call admission is visible through the native inbox')
 const buckets=await app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${call.conversation_id}/buckets/${call.conversation_id}`,{token});assert.ok(JSON.stringify(buckets).includes('Telephone voicemail'))
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',call.conversation_id)).n,0,'voice metadata never masquerades as a public chat message')
 const report=await app.ok(base+'/report',{token});assert.equal(report.data.reduce((n,r)=>n+r.calls,0),2)
 await liveMediaProof(h,call)
 await contextLinkProof(h,call)
}finally{await h.close()}}
export async function uncertaintyProof(){const h=await voiceHarness();try{
 const {app,token,base}=h,call=await h.open(),path=base+`/conversations/${call.conversation_id}/commands`,body={kind:'callback',number_id:h.number.id,call_id:call.id,request_id:'callback-one'}
 h.setReply(500);let result=await app.ok(path,{token,body});assert.equal(result.data.state,'uncertain');const count=app.requests.length
 result=await app.ok(path,{token,body});assert.equal(result.data.state,'uncertain');assert.equal(app.requests.length,count,'unknown callback does not replay')
 assert.equal((await app.call(path,{token,body:{...body,kind:'transfer'}})).status,409)
 h.setReply(201);const accepted=await app.ok(path,{token,body:{...body,request_id:'callback-two'}});assert.equal(accepted.data.state,'accepted');const sent=new URLSearchParams(app.requests.at(-1).body);assert.equal(sent.get('To'),settings.human_phone);assert.equal(sent.get('Record'),'false');assert.match(sent.get('Twiml'),/\+12025550102/)
 await h.hook({step:'dial',extra:{DialCallStatus:'busy'}})
 h.setReply(503);const failed=await app.ok(path,{token,body:{...body,kind:'transfer',request_id:'transfer-one'}});assert.equal(failed.data.state,'uncertain');assert.equal((await h.calls(call.conversation_id))[0].state,'transfer_failed');assert.equal((await h.calls(call.conversation_id))[0].follow_up,1)
 const transferRequest=new URLSearchParams(app.requests.at(-1).body);assert.ok(transferRequest.get('Twiml').includes('command='+failed.data.id))
 assert.equal((await h.hook({step:'dial',command:failed.data.id,extra:{DialCallStatus:'completed'}})).status,200,'a later human transfer has its own idempotent provider callback')
 assert.equal((await h.calls(call.conversation_id))[0].state,'completed')
 assert.equal((await h.hook({step:'dial',command:'synthetic-happytohelp-21',extra:{DialCallStatus:'completed'}})).status,404)
 await app.configure({});await app.ok(path,{token,body});assert.equal(app.requests.length,count+2,'restart does not replay an unknown callback')
 await h.hook({step:'consent',extra:{Digits:'1'}});await h.hook({step:'ivr',extra:{Digits:'1'}})
 await voiceArchiveSafety({db:app.db,tables:Object.fromEntries(['voice_calls','voice_numbers','conversations','voice_identities','contacts','voice_commands'].map(n=>[n,n]))});assert.equal((await app.first('SELECT token_cipher FROM voice_numbers')).token_cipher,null);assert.equal((await app.first('SELECT phone_cipher FROM voice_identities')).phone_cipher,null)
 assert.equal((await h.hook()).status,404,'restored voice connections need explicit credentials')
 await h.configure({});
 for(const replay of [{},{step:'consent',extra:{Digits:'1'}},{step:'ivr',extra:{Digits:'1'}},{step:'dial',extra:{DialCallStatus:'busy'}}])assert.equal((await h.hook(replay)).status,409,'a reconnected number cannot resume an archived call or replay cached recording instructions')
 assert.equal((await app.first('SELECT phone_cipher FROM voice_identities')).phone_cipher,null,'a restored old call cannot refresh callback identity')
 const restored=await h.open({remote:'synthetic-happytohelp-19'});h.setReply(201);assert.equal((await app.ok(base+`/conversations/${restored.conversation_id}/commands`,{token,body:{...body,call_id:restored.id,request_id:'restored-current-call'}})).data.state,'accepted','a newly signed caller supplies fresh callback identity after reconnect')
}finally{await h.close()}}
export async function erasureProof(){const h=await voiceHarness();try{
 const {app,base,token,ws}=h,call=await h.open(),root=base+`/conversations/${call.conversation_id}`
 await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(ws.projectId,ws.users.operator,Date.now()).run()
 assert.equal((await app.call(root+'/calls',{token:ws.tokens.operator})).status,403)
 assert.equal((await app.call(root+'/commands',{token:ws.tokens.operator,body:{kind:'callback',number_id:h.number.id,call_id:call.id,request_id:'denied'}})).status,403)
 await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(ws.projectId,ws.users.operator).run()
 await h.hook({step:'consent',extra:{Digits:'1'}});await h.hook({step:'ivr',extra:{Digits:'1'}})
 await h.hook({step:'recording',extra:{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-18'}})
 h.duringRequest(async()=>{await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(ws.projectId,ws.users.operator,Date.now()).run()})
 assert.equal((await app.call(root+`/calls/${call.id}/recording`,{token:ws.tokens.operator})).status,403,'current role is rechecked after the recording provider returns')
 const other=await h.open({remote:'synthetic-happytohelp-15',extra:{From:'+12025550106'}})
 h.duringRequest(async()=>{await app.ok(`/api/management/projects/${ws.projectId}/contacts/${call.contact_id}/erase`,{token,body:{}})})
 const result=await app.ok(root+'/commands',{token,body:{kind:'callback',number_id:h.number.id,call_id:call.id,request_id:'erase-during-provider'}});assert.equal(result.data.state,'erased')
 assert.equal((await app.first('SELECT erased FROM voice_calls WHERE id=?',call.id)).erased,1)
 const erased=await app.first('SELECT * FROM voice_calls WHERE id=?',call.id);assert.equal(erased.remote_cipher,null);assert.equal(erased.recording_cipher,null);assert.equal(erased.transcript,null);assert.equal(erased.summary,'')
 assert.equal((await app.first('SELECT phone_cipher FROM voice_identities WHERE contact_id=?',call.contact_id)).phone_cipher,null)
 assert.equal((await h.hook()).status,409);assert.equal((await h.hook({step:'recording',extra:{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-16'}})).status,404)
 assert.equal((await app.call(root+'/calls',{token})).status,404)
 assert.equal((await h.calls(other.conversation_id)).length,1)
 const report=await app.ok(base+'/report',{token});assert.equal(report.data.reduce((n,r)=>n+r.calls,0),1)
 const erasure=await app.ok(`/api/management/projects/${ws.projectId}/contacts/${call.contact_id}/erasure`,{token});assert.ok(erasure.data.providers.requests.some(r=>r.store==='voice:twilio'&&r.state==='unsupported'))
 assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',call.conversation_id)).n,0)
 const before=(await app.first('SELECT count(*) n FROM contacts WHERE project_id=?',ws.projectId)).n;assert.equal((await h.hook({remote:'synthetic-happytohelp-17'})).status,409);assert.equal((await app.first('SELECT count(*) n FROM contacts WHERE project_id=?',ws.projectId)).n,before)
}finally{await h.close()}}

async function liveMediaProof(h,first){
 const {app,base,token}=h;await h.configure({});const remote='synthetic-happytohelp-30',call=await h.open({remote}),root=base+`/conversations/${call.conversation_id}`
 await h.hook({remote,step:'consent',extra:{Digits:'1'}})
 const dial=await h.hook({remote,step:'ivr',extra:{Digits:'1'}});assert.match(dial.data,/<Transcription /)
 const utterance=(sequence,text,track='inbound_track')=>({remote,step:'live-transcript',extra:{TranscriptionEvent:'transcription-content',Final:'true',SequenceId:String(sequence),Track:track,TranscriptionData:JSON.stringify({transcript:text})}})
 assert.equal((await h.hook(utterance(2,'I can help with that.','outbound_track'))).status,200)
 assert.equal((await h.hook(utterance(1,'Please help with the export.'))).status,200)
 assert.equal((await h.hook(utterance(1,'Please help with the export.'))).status,200)
 assert.equal((await h.hook(utterance(1,'A conflicting utterance.'))).status,409)
 let current=(await h.calls(call.conversation_id)).find(c=>c.id===call.id)
 assert.equal(current.transcript,'Caller: Please help with the export.\nTeammate: I can help with that.')
 assert.ok(current.summary.includes(current.transcript));assert.equal(current.consent,'granted')
 const media=root+`/calls/${call.id}/recording`
 await h.hook({remote,step:'recording',extra:{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-31'}})
 assert.equal((await app.call(root+`/calls/${call.id}/withdraw`,{token:h.foreign.tokens.owner,body:{}})).status,404)
 h.setReply(503)
 // Withdrawal racing an authenticated media read must win before bytes are disclosed.
 h.duringRequest(async()=>{const r=await app.ok(root+`/calls/${call.id}/withdraw`,{token,body:{}});assert.equal(r.data.provider_stop_state,'uncertain')})
 assert.equal((await app.request(media,{token})).status,404)
 const sent=app.requests.length
 assert.equal((await app.ok(root+`/calls/${call.id}/withdraw`,{token,body:{}})).data.provider_stop_state,'uncertain');assert.equal(app.requests.length,sent)
 assert.equal((await h.hook(utterance(3,'Late content.'))).status,409)
 assert.equal((await h.hook({remote,step:'recording',extra:{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-32'}})).status,409)
 assert.doesNotMatch((await h.hook({remote,step:'ivr',extra:{Digits:'1'}})).data,/<Transcription|<Dial /,'replayed routing cannot restart recording after withdrawal')
 current=(await h.calls(call.conversation_id)).find(c=>c.id===call.id);assert.equal(current.transcript,null);assert.equal(current.summary,'');assert.equal(current.has_recording,0);assert.ok(current.media_withdrawn_at)
 assert.equal((await app.first('SELECT count(*) n FROM voice_transcript_segments WHERE call_id=?',call.id)).n,0)
 const expiredRemote='synthetic-happytohelp-33',expired=await h.open({remote:expiredRemote})
 await h.hook({remote:expiredRemote,step:'consent',extra:{Digits:'1'}})
 await h.hook({remote:expiredRemote,step:'transcript',extra:{TranscriptionStatus:'completed',TranscriptionText:'Expiring speech.'}})
 await app.db.prepare('UPDATE voice_calls SET media_expires_at=? WHERE id=?').bind(Date.now()-1,expired.id).run()
 current=(await h.calls(expired.conversation_id)).find(c=>c.id===expired.id);assert.equal(current.transcript,null);assert.equal(current.summary,'')
 assert.equal((await h.hook({remote:expiredRemote,step:'transcript',extra:{TranscriptionStatus:'completed',TranscriptionText:'Late expired content.'}})).status,409)
 await app.scheduled()
 assert.equal((await app.first('SELECT transcript FROM voice_calls WHERE id=?',expired.id)).transcript,null)
 assert.equal((await app.first('SELECT count(*) n FROM voice_transcript_segments WHERE call_id=?',expired.id)).n,0)
 assert.equal((await h.calls(first.conversation_id)).find(c=>c.id===first.id).media_withdrawn_at,null,'other calls retain their consent state')
}
async function contextLinkProof(h,call){
 const {app,ws,token,base}=h,root=base+`/conversations/${call.conversation_id}`
 const contact=(await app.ok(`/api/management/projects/${ws.projectId}/contacts`,{token,body:{name:'Existing customer',email:'existing@example.test'}})).data
 const foreign=(await app.ok(`/api/management/projects/${h.foreign.projectId}/contacts`,{token:h.foreign.tokens.owner,body:{name:'Foreign customer',email:'foreign@example.test'}})).data
 assert.equal((await app.call(root+'/context-link',{token,method:'PUT',body:{contact_id:foreign.id}})).status,409)
 assert.equal((await app.ok(root+'/context-candidates?email=existing%40example.test',{token})).data[0].id,contact.id)
 await app.ok(root+'/context-link',{token,method:'PUT',body:{contact_id:contact.id}})
 const r=await app.ok(root+'/calls',{token});assert.equal(r.linked_context.id,contact.id);assert.match(r.linked_context.authority,/Operator context only/)
 assert.equal((await app.first('SELECT contact_id FROM conversations WHERE id=?',call.conversation_id)).contact_id,call.contact_id,'link does not merge identities or grant caller authority')
 await app.ok(root+'/context-link',{token,method:'PUT',body:{contact_id:null}});assert.equal((await app.ok(root+'/calls',{token})).linked_context,null)
 await app.ok(root+'/context-link',{token,method:'PUT',body:{contact_id:contact.id}})
 await app.ok(`/api/management/projects/${ws.projectId}/contacts/${contact.id}/erase`,{token,body:{}})
 assert.equal((await app.ok(root+'/calls',{token})).linked_context,null)
 assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE action='voice.context_linked'")).n>=1)
}
