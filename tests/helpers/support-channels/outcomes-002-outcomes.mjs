import assert from 'node:assert/strict';
import {channelHarness} from './journeys.mjs';
import {messagingRefusals} from './outcomes-002-refusals.mjs';
export const surveyPath=text=>decodeURIComponent(text).match(/\/api\/outcomes\/surveys\/[a-zA-Z0-9.-]+/)[0];
export async function messagingOutcomes(){
 const h=await channelHarness({bindings:{INBOUND_EMAIL_TOKEN:'synthetic-survey-signing-key'}}),{app,ws,token}=h,owner={token},root=`/api/outcomes/projects/${ws.projectId}`;
 const settings={enabled:true,scale:'five',locale:'es',delayMinutes:0,expiresDays:2};
 const resolve=t=>app.ok(`/api/dashboard/projects/${ws.projectId}/conversations/${t.conversation_id}`,{...owner,method:'PUT',body:{resolved:true}});
 try{
  await app.ok(root+'/settings',{...owner,method:'PUT',body:settings});
  for(const p of ['sms','whatsapp','instagram','messenger']){
   const c=await h.connect(p),raw=h.event(p);assert.equal((await h.deliver(c,p,raw)).status,200);const t=await h.ticket(c),before=h.sends.length;
   await resolve(t);await app.scheduled();await app.scheduled();await h.deliver(c,p,raw);await app.scheduled();
   assert.equal(h.sends.length,before+1,p+' sends one original-channel invitation despite duplicate scheduler/webhook');
   const sent=h.sends.at(-1);assert.equal(new URL(sent.url).hostname,p==='sms'?'api.twilio.com':'graph.facebook.com');
   if(p==='sms')assert.equal(new URLSearchParams(sent.body).get('To'),t.recipient);
   else {const body=JSON.parse(sent.body);assert.equal(p==='whatsapp'?body.to:body.recipient.id,t.recipient);if(p==='whatsapp')assert.equal(body.type,'text');}
   const path=surveyPath(sent.body),row=await app.first('SELECT * FROM csat_surveys WHERE conversation_id=?',t.conversation_id);
   assert.equal(row.channel,p);assert.equal(row.recipient,'');assert.equal(row.locale,'es');assert.equal(row.expires_at-row.due_at,2*86400000);assert.ok(!JSON.stringify(row).includes(t.recipient));
   await app.ok(root+'/settings',{...owner,method:'PUT',body:{...settings,locale:'fr',scale:'thumbs',expiresDays:3}});
   assert.equal((await app.first('SELECT scale FROM csat_surveys WHERE id=?',row.id)).scale,'five','cycle snapshot survives settings edits');
   assert.equal((await app.call(path.replace('.'+p+'.','.email.'))).status,404);
   assert.equal((await app.call(path.slice(0,-1)+(path.endsWith('0')?'1':'0'))).status,404);
   assert.equal((await app.call(path)).status,200,'no session and GET never consumes');
   const response=await app.call(path,{body:{score:1,comment:'private messaging feedback '+p,recovery:'not_recovered'}});assert.equal(response.status,200);
   assert.equal((await app.call(path,{body:{score:5}})).status,410);
   const change=surveyPath(response.data);assert.notEqual(change,path);
   const rerated=await app.call(change,{body:{score:2,comment:'private messaging feedback '+p,recovery:'recovered'}});assert.equal(rerated.status,200);const latestLink=surveyPath(rerated.data);
   const report=await app.ok(root+'/results?lowScore=true',owner),result=report.results.find(r=>r.conversationId===t.conversation_id);
   assert.equal(result.response.channel,p);assert.equal(result.response.invitationChannel,p);assert.equal(result.response.revision,2);assert.equal(result.response.recovery,'recovered');
   assert.equal((await app.ok('/api/conversations/'+t.conversation_id,owner)).status_category,'solved','low response never closes a complaint');
   assert.equal((await app.first('SELECT count(*) n FROM csat_response_history WHERE resolution_id=?',row.resolution_id)).n,2);
   await app.ok(`/api/dashboard/projects/${ws.projectId}/conversations/${t.conversation_id}`,{...owner,method:'PUT',body:{resolved:false}});
   assert.equal((await app.call(latestLink)).status,410);
   // The original links also remain dead after reopen; history still belongs to cycle one.
   assert.equal((await app.call(path)).status,410);
   await h.deliver(c,p,h.event(p,{text:'A follow-up question'}));await resolve(t);await app.scheduled();
   const cycles=(await app.ok(root+'/results',owner)).results.filter(r=>r.conversationId===t.conversation_id);assert.equal(cycles.length,2);assert.equal(cycles.find(r=>r.ordinal===1).response.revision,2);
   const current=surveyPath(h.sends.at(-1).body);assert.equal((await app.call(current)).status,200);
   await app.ok(root+'/surveys/'+cycles.find(r=>r.ordinal===2).surveyId+'/revoke',{...owner,body:{}});assert.equal((await app.call(current)).status,410);
   const csvBefore=(await app.call(root+'/results?format=csv',owner)).data;assert.ok(csvBefore.includes('private messaging feedback '+p));
   await app.ok(`/api/management/projects/${ws.projectId}/contacts/${t.contact_id}/erase`,{...owner,body:{}});
   const erased=(await app.ok(root+'/results',owner)).results.filter(r=>r.conversationId===t.conversation_id);assert.equal(erased.find(r=>r.response).response.comment,'');
   assert.ok(!(await app.call(root+'/results?format=csv',owner)).data.includes('private messaging feedback '+p));
   for(const table of ['csat_responses','csat_response_history'])assert.ok((await app.sql(`SELECT comment FROM ${table} WHERE contact_id=?`,t.contact_id)).every(r=>r.comment===''));
   assert.ok((await app.sql('SELECT recipient,revoked_at FROM csat_surveys WHERE contact_id=?',t.contact_id)).every(r=>r.recipient===''&&r.revoked_at));assert.equal((await app.call(current)).status,410);
   await app.ok(root+'/settings',{...owner,method:'PUT',body:settings});
  }
  await messagingRefusals(h,{owner,root,settings,resolve});
 }finally{await h.close();}
}
