import assert from 'node:assert/strict';
import {expiredSurveyPath} from '../outcomes-002-email-outcomes.mjs';
import {surveyPath} from './outcomes-002-outcomes.mjs';
export async function messagingRefusals(h,{owner,root,settings,resolve}){
 const {app,ws}=h;let sequence=1000;
 const create=async(p,c,text='Please help')=>{const sender='+1202555'+String(sequence++);await h.deliver(c,p,h.event(p,{sender,text}));return h.ticket(c)};
 const survey=t=>app.first('SELECT * FROM csat_surveys WHERE conversation_id=? ORDER BY created_at DESC',t.conversation_id);
 for(const p of ['sms','whatsapp','instagram','messenger']){
  const c=await h.connect(p);
  for(const failure of [{status:400},{status:503},{disconnect:true}]){
   const t=await create(p,c),before=h.sends.length;h.responses.push(failure);await resolve(t);await app.scheduled();await app.scheduled();
   assert.equal(h.sends.length,before+1,p+' terminal failures never replay');assert.equal((await survey(t)).state,failure.status===400?'failed':'uncertain');
  }
  // Time and provider registration are fixture state; dispatch and response are public doors.
  for(const kind of ['opted_out',...(p==='sms'?['registration']:['window']),'revoked']){
   const t=await create(p,c);
   if(kind==='opted_out')await app.db.prepare('UPDATE support_channel_threads SET opted_out=1 WHERE id=?').bind(t.id).run();
   if(kind==='registration')await app.db.prepare('UPDATE support_channel_connections SET registered=0 WHERE id=?').bind(c.id).run();
   if(kind==='window')await app.db.prepare('UPDATE support_channel_threads SET last_inbound_at=1 WHERE id=?').bind(t.id).run();
   if(kind==='revoked')await h.call('/connections/'+c.id,undefined,{method:'DELETE'});
   const before=h.sends.length;await resolve(t);await app.scheduled();assert.equal(h.sends.length,before,p+' '+kind+' makes no provider request');
   assert.equal((await survey(t)).state,'suppressed');
   const row=await survey(t),receipt=(await h.call('/conversations/'+t.conversation_id)).data.sends.find(s=>s.message_id==='csat:'+row.id);
   assert.equal(receipt.error_code,{opted_out:'customer_opted_out',registration:'a2p_registration_required',window:'reply_window_expired',revoked:'connection_revoked'}[kind]);
   if(kind==='registration')await app.db.prepare('UPDATE support_channel_connections SET registered=1 WHERE id=?').bind(c.id).run();
   if(kind==='revoked')await h.connect(p);
  }
  // Expiration uses the configured one-day snapshot, then moves its clock past that boundary.
  const exp=await create(p,c);await resolve(exp);await app.scheduled();const expRow=await survey(exp),expLink=surveyPath(h.sends.at(-1).body);
  await app.db.prepare('UPDATE csat_surveys SET expires_at=? WHERE id=?').bind(Date.now()-1,expRow.id).run();
  assert.equal((await app.call(expLink,{body:{score:1}})).status,404,'signed expiry cannot be forged');
  const expired={...expRow,expires_at:Date.now()-1000};await app.db.prepare('UPDATE csat_surveys SET expires_at=? WHERE id=?').bind(expired.expires_at,expired.id).run();
  assert.equal((await app.call(expiredSurveyPath(expired,'synthetic-survey-signing-key'),{body:{score:1}})).status,410,'correctly signed expired links are refused');
  await app.db.prepare('UPDATE csat_surveys SET expires_at=? WHERE id=?').bind(expRow.expires_at,expRow.id).run();
  await app.ok(expLink+'/optout',{body:{}});assert.equal((await app.call(expLink)).status,410);
  await app.ok(`/api/dashboard/projects/${ws.projectId}/conversations/${exp.conversation_id}`,{...owner,method:'PUT',body:{resolved:false}});await resolve(exp);const before=h.sends.length;await app.scheduled();assert.equal(h.sends.length,before,'survey opt-out suppresses future cycles');
 }
 // STOP/START/HELP consent belongs to SMS and WhatsApp. Instagram/Messenger have no keyword consent door.
 for(const p of ['sms','whatsapp']){
  const c=await h.connect(p),t=await create(p,c),other=await create(p,c),foreign=await h.connect(p==='sms'?'whatsapp':'sms');
  await h.deliver(c,p,h.event(p,{sender:t.recipient,text:'STOP'}));await h.deliver(c,p,h.event(p,{sender:other.recipient,text:'STOP'}));
  await h.deliver(foreign,p==='sms'?'whatsapp':'sms',h.event(p==='sms'?'whatsapp':'sms',{sender:t.recipient,text:'STOP'}));
  await h.deliver(c,p,h.event(p,{sender:t.recipient,text:'HELP'}));const before=h.sends.length;
  await resolve(t);await app.scheduled();assert.equal(h.sends.length,before,'HELP grants no survey authority');assert.equal((await survey(t)).state,'suppressed');
  await h.deliver(c,p,h.event(p,{sender:t.recipient,text:'START'}));
  assert.equal((await app.first('SELECT opted_out FROM support_channel_threads WHERE id=?',other.id)).opted_out,1);
  assert.equal((await app.first('SELECT opted_out FROM support_channel_threads WHERE connection_id=? AND recipient=?',foreign.id,t.recipient)).opted_out,1,'START never grants another channel authority');
  await app.ok(`/api/dashboard/projects/${ws.projectId}/conversations/${t.conversation_id}`,{...owner,method:'PUT',body:{resolved:false}});await resolve(t);await app.scheduled();assert.equal(h.sends.length,before+1,'START restores only this number and channel for a new cycle');
  const active=surveyPath(h.sends.at(-1).body);await h.deliver(c,p,h.event(p,{sender:t.recipient,text:'STOP'}));assert.equal((await app.call(active)).status,410,'STOP also fences an already issued signed survey');
 }
}
