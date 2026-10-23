import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {startApp} from '../../journeys/kit/app.mjs';
import {supportChannelArchiveRow} from '../../../scripts/installer/support-channel-archive.mjs';
const secret='synthetic-happytohelp-1',credential='synthetic-happytohelp-2';
export async function channelHarness(){
 const sends=[],responses=[];
 const app=await startApp({cf:{},bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async(req,entry)=>{assert.ok(['api.twilio.com','graph.facebook.com','slack.com'].includes(new URL(req.url).hostname));sends.push(entry);const reply=responses.shift();if(reply?.disconnect)throw Error('Network edge lost response');return new Response(JSON.stringify(reply?.body??{sid:'synthetic-happytohelp-3',message_id:'synthetic-happytohelp-4',messages:[{id:'synthetic-happytohelp-5'}],ok:true,ts:'1710000000.3'}),{status:reply?.status??200});}});
 const ws=await app.seedWorkspace('support-channels'),other=await app.seedWorkspace('support-channels-foreign'),root=`/api/support-channels/projects/${ws.projectId}`,token=ws.tokens.owner;
 const call=(p,body,options={})=>app.ok(root+p,{token,body,...options});
 const input=p=>({provider:p,account:'synthetic-happytohelp-account-'+p,sender:p==='sms'?'+12025550123':p==='slack'?'U12345':'synthetic-happytohelp-page',token:credential,signing_secret:secret,channels:['C12345678'],registered:true});
 const connect=async(p,extra={})=>(await call('/connections',{...input(p),...extra})).data;
 const event=(p,options={})=>{const n=options.id??randomUUID(),sender=options.sender??(p==='sms'?'+12025550124':'synthetic-happytohelp-customer'),text=options.text??'Please help with my order';
  if(p==='sms')return new URLSearchParams({AccountSid:input(p).account,To:input(p).sender,From:sender,MessageSid:n,Body:text,NumMedia:options.media?'1':'0'}).toString();
  if(p==='slack')return JSON.stringify({team_id:input(p).account,event_id:n,event:{type:'message',channel:options.channel??'C12345678',user:sender,ts:options.thread??'1710000000.1',text,...(options.media?{files:[{id:'synthetic-happytohelp-file'}]}:{}),...(options.subtype?{subtype:options.subtype}:{})}});
  if(p==='whatsapp')return JSON.stringify({entry:[{id:input(p).account,changes:[{value:{metadata:{phone_number_id:input(p).sender},messages:[{id:n,from:sender,type:options.media?'image':'text',text:{body:text}}]}}]}]});
  return JSON.stringify({entry:[{id:input(p).account,messaging:[{sender:{id:sender},recipient:{id:input(p).sender},message:{mid:n,text,...(options.media?{attachments:[{type:'image'}]}:{})}}]}]});
 };
 const signed=(c,p,raw,now=String(Math.floor(Date.now()/1000)))=>{
  const url=app.origin+'/api/support-channels/webhooks/'+c.id;
  if(p==='sms'){const f=new URLSearchParams(raw);return {'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':createHmac('sha1',secret).update(url+[...f.keys()].sort().map(k=>k+f.get(k)).join('')).digest('base64')};}
  if(p==='slack')return {'Content-Type':'application/json','X-Slack-Request-Timestamp':now,'X-Slack-Signature':'v0='+createHmac('sha256',secret).update(`v0:${now}:${raw}`).digest('hex')};
  return {'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')};
 };
 const deliver=(c,p,raw,headers=signed(c,p,raw))=>app.call('/api/support-channels/webhooks/'+c.id,{body:raw,raw:true,headers});
 const ticket=async c=>app.first('SELECT * FROM support_channel_threads WHERE connection_id=? ORDER BY last_inbound_at DESC',c.id);
 const reply=async(t,{localId=randomUUID(),content='We can help.',...extra}={})=>{const current=await app.ok('/api/conversations/'+t.conversation_id,{token});return app.ok('/api/conversations/'+t.conversation_id+'/messages',{token,body:{localId,content,expectedRevision:current.revision,authoring:{kind:'human'},...extra}});};
 return {app,ws,other,root,token,call,input,connect,event,signed,deliver,ticket,reply,sends,responses,close:()=>app.close()};
}
export async function credentials(){const h=await channelHarness();try{
 const c=await h.connect('sms');const list=await h.call('/connections');assert.ok(!JSON.stringify(list).includes(secret));assert.ok(!JSON.stringify(list).includes(credential));const stored=await h.app.first('SELECT * FROM support_channel_connections WHERE id=?',c.id);assert.notEqual(stored.token_cipher,credential);assert.notEqual(stored.signing_cipher,secret);assert.equal(supportChannelArchiveRow('support_channel_connections',stored).token_cipher,null);assert.equal(supportChannelArchiveRow('support_channel_connections',stored).signing_cipher,null);
 for(const token of [h.ws.tokens.operator,h.other.tokens.owner])for(const method of ['GET','POST','DELETE']){const path=h.root+'/connections'+(method==='DELETE'?'/'+c.id:'');assert.equal((await h.app.call(path,{token,method,...(method==='POST'?{body:h.input('slack')}: {})})).status,403);}
 assert.equal((await h.app.call(h.root+'/connections',{token:h.token,body:{...h.input('sms'),registered:false}})).status,400);
 assert.equal((await h.app.call(h.root+'/connections',{token:h.token,body:{provider:'teams'}})).status,409);
 await h.call('/connections/'+c.id,undefined,{method:'DELETE'});const raw=h.event('sms');assert.equal((await h.deliver(c,'sms',raw)).status,410);assert.equal(h.sends.length,0);
 const next=await h.connect('sms');assert.equal(next.id,c.id);assert.equal((await h.deliver(next,'sms',raw)).status,200);
 assert.ok((await h.app.sql("SELECT action FROM audit_events WHERE action LIKE 'support_channel.%'")).length>=3);
 }finally{await h.close();}}
export async function exchange(providers=['sms','whatsapp','instagram','messenger']){const h=await channelHarness();try{
 for(const p of providers){const c=await h.connect(p),raw=h.event(p);
  assert.equal((await h.deliver(c,p,raw,{})).status,401);assert.equal((await h.deliver(c,p,raw+' ',h.signed(c,p,raw))).status,401);
  assert.equal((await h.deliver(c,p,h.event(p,{media:true}))).status,422);
  assert.equal((await h.deliver(c,p,raw)).status,200);const t=await h.ticket(c);assert.ok(t);assert.equal((await h.app.first('SELECT channel FROM conversations WHERE id=?',t.conversation_id)).channel,p);
  assert.equal((await h.deliver(c,p,raw)).status,200);assert.equal((await h.app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',t.conversation_id)).n,1);
  await h.app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${t.conversation_id}/notes`,{token:h.token,body:{content:'Private note must stay private'}});assert.equal(h.sends.length,providers.indexOf(p));
  const message=await h.reply(t);assert.equal(message.accepted,true);assert.equal(h.sends.length,providers.indexOf(p)+1);const sent=h.sends.at(-1);assert.ok(!sent.body.includes('Private note'));assert.ok(sent.body.includes('We+can+help.')||sent.body.includes('We can help.'));
  const status=await h.call('/conversations/'+t.conversation_id);assert.equal(status.data.sends[0].state,'accepted');assert.equal((await h.app.call(h.root+'/conversations/'+t.conversation_id,{token:h.other.tokens.owner})).status,403);
  if(p==='sms'||p==='whatsapp'){await h.deliver(c,p,h.event(p,{text:'STOP'}));await h.reply(t);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].error_code,'customer_opted_out');assert.equal(h.sends.length,providers.indexOf(p)+1);}
  else{await h.app.db.prepare('UPDATE support_channel_threads SET last_inbound_at=0 WHERE id=?').bind(t.id).run();await h.reply(t);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].error_code,'reply_window_expired');}
 }
 assert.equal((await h.call('/report')).data.reduce((n,r)=>n+r.count,0),providers.length*2);
 }finally{await h.close();}}
export async function slack(){const h=await channelHarness();try{
 const c=await h.connect('slack'),raw=h.event('slack');assert.equal((await h.deliver(c,'slack',raw)).status,200);const t=await h.ticket(c);await h.reply(t);assert.equal(JSON.parse(h.sends[0].body).thread_ts,'1710000000.1');assert.equal(JSON.parse(h.sends[0].body).mrkdwn,false);
 assert.equal((await h.deliver(c,'slack',raw)).status,200);assert.equal((await h.deliver(c,'slack',h.event('slack',{channel:'C99999999'}))).status,403);
 assert.equal((await h.deliver(c,'slack',h.event('slack',{id:'stale'}),h.signed(c,'slack',h.event('slack',{id:'stale'}),'1'))).status,401);
 assert.equal((await h.deliver(c,'slack',h.event('slack',{subtype:'message_deleted'}))).data.data[0].held,true);
 const count=h.sends.length;await h.app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${t.conversation_id}/notes`,{token:h.token,body:{content:'Private handoff context'}});assert.equal(h.sends.length,count);
 await h.call('/connections/'+c.id,undefined,{method:'DELETE'});await h.reply(t);assert.equal(h.sends.length,count);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].error_code,'connection_revoked');const next=await h.connect('slack');assert.equal(next.id,c.id);await h.reply(t);assert.equal(h.sends.length,count+1);
 }finally{await h.close();}}
export async function erasure(){const h=await channelHarness();try{
 const c=await h.connect('sms');await h.deliver(c,'sms',h.event('sms'));const t=await h.ticket(c);await h.reply(t);
 await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${t.contact_id}/erase`,{token:h.token,body:{}});
 assert.equal(await h.ticket(c),null);assert.equal((await h.app.first('SELECT count(*) n FROM support_channel_fences')).n,1);const result=await h.deliver(c,'sms',h.event('sms'));assert.equal(result.status,200);assert.equal(await h.ticket(c),null);
 const erasure=await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${t.contact_id}/erasure`,{token:h.token});assert.ok(erasure.data.providers.requests.some(r=>r.store==='support-channel:sms'&&r.state==='unsupported'));
 const text=JSON.stringify(await h.app.sql('SELECT * FROM support_channel_events'));assert.ok(!text.includes(t.contact_id));assert.ok(!text.includes('+12025550124'));
 await h.call('/connections/'+c.id,undefined,{method:'DELETE'});await h.connect('sms');await h.deliver(c,'sms',h.event('sms'));assert.equal(await h.ticket(c),null);
 }finally{await h.close();}}
export async function uncertainty(){const h=await channelHarness();try{
 for(const response of [{status:500},{disconnect:true},{status:400}]){const p='sms',c=await h.connect(p);await h.deliver(c,p,h.event(p,{sender:'+1202555012'+(h.sends.length+5)}));const t=await h.ticket(c);h.responses.push(response);const message=await h.reply(t);const count=h.sends.length;const state=(await h.call('/conversations/'+t.conversation_id)).data.sends[0].state;assert.equal(state,response.status===400?'failed':'uncertain');await h.app.scheduled();assert.equal(h.sends.length,count,'recovery does not replay channel sends');assert.equal(supportChannelArchiveRow('support_channel_sends',{state:'sending'}).state,'uncertain');assert.ok(message.accepted);}
 }finally{await h.close();}}
