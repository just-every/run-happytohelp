import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {voiceArchiveRow,voiceArchiveSafety} from '../../../scripts/installer/voice-archive.mjs'
export const secret='synthetic-happytohelp-1'
export const account='synthetic-happytohelp-2'
export const providerNumber='synthetic-happytohelp-3'
export const numberPhone='+12025550101'
export const callerPhone='+12025550102'
export const settings={timezone:'America/Los_Angeles',hours:Array.from({length:7},(_,day)=>({day,start:'00:00',end:'23:59'})),human_phone:'+12025550103',aircall_user_id:'7',group_id:null,ivr:[{digit:'1',label:'Support',phone:'+12025550104'}],jurisdiction:'US-CA',recording_enabled:true}
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
export async function credentialsProof(){const h=await voiceHarness();try{
 const {app,base,ws,foreign,token}=h,list=await app.ok(base+'/numbers',{token})
 assert.equal(list.data[0].connected,1);assert.equal(JSON.stringify(list).includes(secret),false);assert.equal(JSON.stringify(list).includes('token_cipher'),false)
 const row=await app.first('SELECT token_cipher,webhook_hash FROM voice_numbers');assert.notEqual(row.token_cipher,secret);assert.equal(row.webhook_hash.length,64)
 const body={provider:'twilio',provider_id:providerNumber,account_id:account,token:secret,settings}
 assert.equal((await app.call(base+'/numbers',{token:ws.tokens.operator,body})).status,403)
 assert.equal((await app.call(base+'/numbers',{token:foreign.tokens.owner,body})).status,403)
 assert.equal((await app.call(base+'/numbers',{token,body:{...body,provider_id:'../escape'}})).status,400)
 assert.equal((await app.call(base+'/numbers',{token,body:{...body,settings:{...settings,human_phone:'911'}}})).status,400)
 assert.equal((await app.call(base+'/numbers',{token,body:{...body,version:0}})).status,409)
 const air=(await app.ok(base+'/numbers',{token,body:{...body,provider:'aircall',provider_id:'8'}})).data
 assert.ok(air.webhook_token);assert.equal(JSON.stringify(await app.ok(base+'/numbers',{token})).includes(air.webhook_token),false)
 const stored=await app.first('SELECT * FROM voice_numbers WHERE id=?',air.id);assert.notEqual(stored.webhook_hash,air.webhook_token)
 const call=await h.open();await app.ok(base+'/numbers/'+h.number.id,{token,method:'DELETE'})
 assert.equal((await h.hook()).status,404)
 assert.equal((await app.call(base+`/conversations/${call.conversation_id}/commands`,{token,body:{kind:'callback',number_id:h.number.id,call_id:call.id,request_id:'disconnected'}})).status,404)
 assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE action IN ('voice.number_connected','voice.number_disconnected')")).n>=3)
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
 const {app,token,base}=h,call=await h.open(),entry=await h.hook();assert.match(entry.data,/not emergency dispatch/);assert.match(entry.data,/Press 1 to consent/);assert.doesNotMatch(entry.data,/<Record /)
 const denied=await h.hook({step:'consent',extra:{Digits:'2'}});assert.equal(denied.status,200);assert.match(denied.data,/Press 1 for Support/)
 const ivr=await h.hook({step:'ivr',extra:{Digits:'1'}});assert.equal(ivr.status,200);assert.match(ivr.data,/<Number>\+12025550104<\/Number>/)
 const failed=await h.hook({step:'dial',extra:{DialCallStatus:'busy'}});assert.equal(failed.status,200);assert.match(failed.data,/human transfer failed/);assert.doesNotMatch(failed.data,/<Record /);assert.match(failed.data,/<Enqueue /);const wait=await h.hook({step:'queue-wait',extra:{QueueTime:'121'}});assert.match(wait.data,/<Leave\/>/);const queueEnd=await h.hook({step:'queue-finish',extra:{QueueResult:'leave'}});assert.match(queueEnd.data,/could not answer in time/)
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
 assert.equal((await h.calls(call.conversation_id)).some(c=>c.transcript?.includes('<script>')),false)
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
 const command=await app.first('SELECT * FROM voice_commands WHERE id=?',accepted.data.id);assert.equal(voiceArchiveRow('voice_commands',{...command,state:'sending'}).state,'uncertain')
 const n=await app.first('SELECT * FROM voice_numbers');assert.equal(voiceArchiveRow('voice_numbers',n).token_cipher,null);assert.equal(voiceArchiveRow('voice_numbers',n).enabled,0)
 await voiceArchiveSafety({db:app.db,tables:Object.fromEntries(['voice_calls','voice_numbers','conversations','voice_identities','contacts','voice_commands'].map(n=>[n,n]))});assert.equal((await app.first('SELECT token_cipher FROM voice_numbers')).token_cipher,null);assert.equal((await app.first('SELECT phone_cipher FROM voice_identities')).phone_cipher,null)
 assert.equal((await h.hook()).status,404,'restored voice connections need explicit credentials')
 await h.configure({});const restored=await h.open({remote:'synthetic-happytohelp-19'});h.setReply(201);assert.equal((await app.ok(base+`/conversations/${restored.conversation_id}/commands`,{token,body:{...body,call_id:restored.id,request_id:'restored-current-call'}})).data.state,'accepted','a newly signed caller supplies fresh callback identity after reconnect')
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
export const voiceProofs={credentials:credentialsProof,delivery:signedDeliveryProof,uncertainty:uncertaintyProof,erasure:erasureProof}
