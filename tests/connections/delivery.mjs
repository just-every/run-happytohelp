import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {harness,body} from './harness.mjs';
const root='/api/management/projects/p/connections';
const events=['conversation.created','message.created','conversation.resolved','conversation.rated'];
function verify(receipt,key,destination){
 const h=receipt.headers,payload=JSON.parse(receipt.body),timestamp=h['webhook-timestamp'];
 assert.equal(h['webhook-tenant'],'p');assert.equal(h['webhook-destination'],destination);assert.equal(h['webhook-id'],payload.id);assert.equal(h['webhook-event'],payload.event);
 assert.ok(Math.abs(Date.now()-Number(timestamp)*1000)<300000);
 const signature=createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(['integrations.webhook.v1','p',destination,payload.event,payload.id,timestamp,receipt.body.toString('utf8')])).digest('hex');
 assert.equal(h['webhook-signature'],'v1='+signature);
}
export async function deliveryJourney(){const h=await harness();try{
 for(const url of ['http://receiver.example.com','https://127.0.0.1','https://169.254.169.254/latest','https://user:secret@example.com'])assert.equal((await h.raw(root+'/webhooks',body({name:'Unsafe',url,events}))).status,400);
 const hook=await h.call(root+'/webhooks',body({name:'Receiver',url:'https://receiver.example.com/events',events}));
 await h.contact();const c=await h.conversation(),{token}=await h.issue();
 await h.call('/api/v1/conversations/'+c.id+'/messages',{token,...body({content:'Answer',localId:'reply',expectedRevision:0})});
 await h.call('/api/v1/conversations/'+c.id+'/resolve',{token,...body({})});
 const resolution=await h.db.prepare('SELECT id FROM conversation_resolutions WHERE conversation_id=?').bind(c.id).first();
 await h.call('/api/conversations/'+c.id+'/widget-events',{actor:'visitor',...body({action:'rateResolution',data:{resolutionId:resolution.id,value:1,comment:'Private feedback'}})});
 await h.dispatch();assert.deepEqual(h.received.map(r=>JSON.parse(r.body).event).sort(),events.slice().sort());
 for(const receipt of h.received){verify(receipt,hook.secret,hook.id);assert.ok(!receipt.body.toString().includes('Private feedback'));}
 await h.restart();await h.dispatch();assert.equal(h.received.length,4);
 assert.equal((await h.raw('/api/management/projects/q/connections/deliveries',{actor:'owner'})).status,403);
 const test=async response=>{h.responses.push(response);return h.call(root+'/webhooks/'+hook.id+'/test',body({}));};
 const log=async id=>(await h.call(root+'/deliveries')).data.find(row=>row.id===id);
 const unknown=await test({status:500,body:'PRIVATE_PROVIDER_BODY'});assert.equal((await log(unknown.id)).state,'uncertain');
 const count=h.received.length;await h.restart();await h.dispatch();assert.equal(h.received.length,count);
 const resend=root+'/deliveries/'+unknown.id+'/resend';
 assert.equal((await h.raw(resend,{actor:'foreign',...body({attempt:1})})).status,403);
 const approvals=await Promise.all([h.raw(resend,body({attempt:1})),h.raw(resend,body({attempt:1}))]);assert.deepEqual(approvals.map(r=>r.status).sort(),[202,409]);
 await h.dispatch();assert.equal(h.received.length,count+1);assert.equal((await log(unknown.id)).state,'accepted');assert.ok(h.received[count].body.equals(h.received[count-1].body));
 assert.equal((await h.raw(resend,body({attempt:1}))).status,409);
 const limited=await test({status:429});
 for(let i=0;i<20;i++){
  const row=await h.db.prepare('SELECT state,attempts,max_attempts FROM integration_deliveries WHERE id=?').bind(limited.id).first();
  if(row.state==='rejected'){assert.equal(row.attempts,row.max_attempts);break;}
  assert.equal(row.state,'queued');h.responses.push({status:429});await h.db.prepare('UPDATE integration_deliveries SET next_at=0 WHERE id=?').bind(limited.id).run();await h.dispatch();
 }
 assert.equal((await log(limited.id)).state,'rejected');
 const oversized=await test({status:429}),beforeOversized=h.received.length;
 await h.db.prepare("UPDATE integration_deliveries SET envelope=json_set(envelope,'$.body',?),next_at=0 WHERE id=?").bind('x'.repeat(1048577),oversized.id).run();await h.dispatch();assert.equal(h.received.length,beforeOversized);assert.equal((await log(oversized.id)).state,'rejected');
 // The recorded ordinary HTTPS override must bound responses and never follow a redirect.
 for(const response of [{status:302,headers:{Location:'https://receiver.example.com/redirect'}},{status:204,delay:11000},{status:200,chunks:['x'.repeat(32768),'x'.repeat(32769)]}]){
  const before=h.received.length,job=await test(response);assert.equal(h.received.length,before+1);
  assert.equal((await log(job.id)).state,'uncertain');assert.equal((await log(job.id)).error_class,'response_unknown');await h.dispatch();assert.equal(h.received.length,before+1);
 }
 const deliveries=JSON.stringify(await h.call(root+'/deliveries'));assert.ok(!deliveries.includes(hook.secret));assert.ok(!deliveries.includes('PRIVATE_PROVIDER_BODY'));
 await h.call(root+'/webhooks/'+hook.id,{method:'DELETE'});
 // The same customer's next conversation is notified through Slack instead.
 const slack=await h.call(root+'/slack',body({name:'Team',mode:'incoming-webhook',url:'https://hooks.slack.com/services/T123/B123/synthetic-hh-1'}));
 const next=await h.conversation();await h.call('/api/management/projects/p/availability',{...body({is_presence_away_enabled:false}),method:'PUT'});
 const beforeSlack=h.received.length;await h.dispatch();assert.equal(h.received.length,beforeSlack);
 await h.call('/api/conversations/'+next.id+'/messages',{actor:'visitor',...body({content:'<!channel> & <https://example.test|link>',localId:'question',expectedRevision:0})});
 h.responses.push({status:200,body:'ok'});await h.dispatch();assert.equal(h.received.length,beforeSlack+1);
 const message=JSON.parse(h.received.at(-1).body);assert.equal(message.blocks[0].text.text,'&lt;!channel&gt; &amp; &lt;https://example.test|link&gt;');assert.equal(message.blocks[0].text.type,'plain_text');assert.equal(message.unfurl_links,false);
 await h.restart();await h.dispatch();assert.equal(h.received.length,beforeSlack+1);
 // Erase with a prepared retry outstanding; neither payload nor source identity may return.
 const pending=await h.conversation();await h.call('/api/conversations/'+pending.id+'/messages',{actor:'visitor',...body({content:'Private pending text',localId:'pending',expectedRevision:0})});
 h.responses.push({status:429});await h.dispatch();const sent=h.received.length;
 await h.call('/api/management/projects/p/contacts/visitor/erase',body({}));await h.dispatch();assert.equal(h.received.length,sent);
 assert.equal((await h.db.prepare("SELECT count(*) n FROM native_integration_events WHERE contact_id='visitor' AND body<>'{}'").first()).n,0);
 assert.equal((await h.db.prepare("SELECT count(*) n FROM integration_deliveries WHERE state='queued'").first()).n,0);
 await h.call(root+'/slack/'+slack.id,{method:'DELETE'});assert.equal(h.external,0);
 }finally{await h.close()}}
