import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {startApp} from '../../journeys/kit/app.mjs';
const secret='synthetic-happytohelp-1',credential='synthetic-happytohelp-2';
export async function channelHarness({restored}={}){
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-happytohelp-key',use:'sig'};const install={slack:true,a2p:true};
 const sends=[],responses=[],mediaResponses=[],templates=[{id:'synthetic-happytohelp-template',name:'support_update',status:'APPROVED',language:'en_US',category:'UTILITY',components:[{type:'BODY',text:'Your order {{1}} is ready.'}]}];
 const app=await startApp({cf:{},bindings:{APP_ORIGIN:'https://app.example',INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async(req,entry)=>{const url=new URL(req.url);if(url.hostname==='login.botframework.com')return Response.json({keys:[jwk]});if(url.hostname==='login.microsoftonline.com')return Response.json({access_token:credential});if(url.pathname==='/api/auth.test')return Response.json({ok:install.slack,team_id:'synthetic-happytohelp-account-slack',user_id:'U12345'},{headers:{'x-oauth-scopes':'chat:write,channels:history,files:read,im:history'}});if(url.pathname==='/api/conversations.info')return Response.json({ok:true,channel:{id:url.searchParams.get('channel'),is_member:true,is_ext_shared:true}});if(url.hostname==='messaging.twilio.com')return Response.json(url.pathname.endsWith('/PhoneNumbers')?{phone_numbers:[{phone_number:'+12025550123',account_sid:'synthetic-happytohelp-account-sms'}]}:{usa2p:[{account_sid:'synthetic-happytohelp-account-sms',campaign_status:install.a2p?'VERIFIED':'PENDING'}]});if(req.method==='GET'){if(url.pathname.endsWith('/message_templates'))return Response.json({data:templates});if(url.hostname==='graph.facebook.com')return Response.json({id:'synthetic-happytohelp-media',url:'https://lookaside.fbsbx.com/synthetic-happytohelp-media'});assert.ok(['api.twilio.com','files.slack.com','lookaside.fbsbx.com','smba.trafficmanager.net'].includes(url.hostname));const response=mediaResponses.shift();return new Response(response?.body??'synthetic attachment',{status:response?.status??200,headers:{'Content-Type':'text/plain',...response?.headers}})}assert.ok(['api.twilio.com','graph.facebook.com','slack.com','smba.trafficmanager.net'].includes(url.hostname));sends.push(entry);const reply=responses.shift();if(reply?.disconnect)throw Error('Network edge lost response');return new Response(JSON.stringify(reply?.body??{id:'synthetic-happytohelp-teams-reply',sid:'synthetic-happytohelp-3',message_id:'synthetic-happytohelp-4',messages:[{id:'synthetic-happytohelp-5'}],ok:true,ts:'1710000000.3'}),{status:reply?.status??200});}});
 const ws=restored?.ws??await app.seedWorkspace('support-channels'),other=restored?.other??await app.seedWorkspace('support-channels-foreign'),root=`/api/support-channels/projects/${ws.projectId}`,token=ws.tokens.owner;
 const call=(p,body,options={})=>app.ok(root+p,{token,body,...options});
 const input=p=>({provider:p,account:'synthetic-happytohelp-account-'+p,sender:p==='sms'?'+12025550123':p==='slack'?'U12345':'synthetic-happytohelp-page',token:credential,signing_secret:secret,channels:p==='teams'?['19:synthetic-happytohelp-channel@thread.tacv2']:['C12345678'],registered:true,messaging_service:'synthetic-happytohelp-service'});
 const connect=async(p,extra={})=>(await call('/connections',{...input(p),...extra})).data;
 const event=(p,options={})=>{const n=options.id??randomUUID(),sender=options.sender??(p==='sms'?'+12025550124':'synthetic-happytohelp-customer'),text=options.text??'Please help with my order';
  if(p==='sms')return new URLSearchParams({AccountSid:input(p).account,To:input(p).sender,From:sender,MessageSid:n,Body:text,NumMedia:options.media?'1':'0',...(options.validMedia?{MediaUrl0:'https://api.twilio.com/2010-04-01/Accounts/'+input(p).account+'/Messages/'+n+'/Media/synthetic-happytohelp-media',MediaContentType0:'text/plain'}:{})}).toString();
  if(p==='teams')return JSON.stringify({id:n,type:options.type??'message',timestamp:new Date(options.at??Date.now()).toISOString(),channelId:'msteams',serviceUrl:'https://smba.trafficmanager.net/amer/',from:{id:sender,aadObjectId:sender},channelData:{tenant:{id:input(p).account},channel:{id:options.channel??input(p).channels[0]}},conversation:{id:'19:synthetic-happytohelp-conversation',conversationType:options.personal?'personal':'channel'},replyToId:options.thread??'synthetic-happytohelp-root',text,...(options.media?{attachments:[{contentType:'image/png',contentUrl:'https://smba.trafficmanager.net/amer/v3/attachments/synthetic-happytohelp-media/views/original',name:'support.png'}]}:{})});
  if(p==='slack')return JSON.stringify({team_id:input(p).account,event_id:n,event:{type:'message',channel:options.channel??'C12345678',user:sender,ts:options.thread??'1710000000.1',text,...(options.media?{files:[{id:'synthetic-happytohelp-file',...(options.validMedia?{url_private:'https://files.slack.com/files-pri/synthetic-happytohelp-media',mimetype:'text/plain',name:'support.txt'}:{})}]}:{}),...(options.subtype?{subtype:options.subtype}:{})}});
  if(p==='whatsapp')return JSON.stringify({entry:[{id:input(p).account,changes:[{value:{metadata:{phone_number_id:input(p).sender},messages:[{timestamp:String(Math.floor((options.at??Date.now())/1000)),id:n,from:sender,type:options.media?'document':'text',text:{body:text},...(options.validMedia?{document:{id:'synthetic-happytohelp-media',mime_type:'text/plain',filename:'support.txt',caption:text}}:{})}]}}]}]});
  return JSON.stringify({entry:[{id:input(p).account,messaging:[{timestamp:options.at??Date.now(),sender:{id:sender},recipient:{id:input(p).sender},message:{mid:n,text,...(options.media?{attachments:[{type:'file',...(options.validMedia?{payload:{url:'https://lookaside.fbsbx.com/synthetic-happytohelp-media'}}:{})}]}:{})}}]}]});
 };
 const signed=(c,p,raw,now=String(Math.floor(Date.now()/1000)),overrides={})=>{
  const url=app.origin+'/api/support-channels/webhooks/'+c.id;
  if(p==='teams'){const b=JSON.parse(raw),head=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url'),claims=Buffer.from(JSON.stringify({iss:'https://api.botframework.com',aud:input(p).sender,nbf:Number(now)-1,exp:Number(now)+300,serviceurl:b.serviceUrl,...overrides})).toString('base64url'),payload=head+'.'+claims;return {'Content-Type':'application/json',Authorization:'Bearer '+payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url')}}
  if(p==='sms'){const f=new URLSearchParams(raw);return {'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':createHmac('sha1',secret).update(url+[...f.keys()].sort().map(k=>k+f.get(k)).join('')).digest('base64')};}
  if(p==='slack')return {'Content-Type':'application/json','X-Slack-Request-Timestamp':now,'X-Slack-Signature':'v0='+createHmac('sha256',secret).update(`v0:${now}:${raw}`).digest('hex')};
  return {'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')};
 };
 const deliver=(c,p,raw,headers=signed(c,p,raw))=>app.call('/api/support-channels/webhooks/'+c.id,{body:raw,raw:true,headers});
 const ticket=async c=>app.first('SELECT * FROM support_channel_threads WHERE connection_id=? ORDER BY last_inbound_at DESC,rowid DESC',c.id);
 const reply=async(t,{localId=randomUUID(),content='We can help.',...extra}={})=>{const current=await app.ok('/api/conversations/'+t.conversation_id,{token});return app.ok('/api/conversations/'+t.conversation_id+'/messages',{token,body:{localId,content,expectedRevision:current.revision,authoring:{kind:'human'},...extra}});};
 return {app,ws,other,root,token,call,input,connect,event,signed,deliver,ticket,reply,sends,responses,mediaResponses,templates,install,close:()=>app.close()};
}
export async function credentials(){const h=await channelHarness();try{
 const c=await h.connect('sms');const list=await h.call('/connections');assert.ok(!JSON.stringify(list).includes(secret));assert.ok(!JSON.stringify(list).includes(credential));const stored=await h.app.first('SELECT * FROM support_channel_connections WHERE id=?',c.id);assert.notEqual(stored.token_cipher,credential);assert.notEqual(stored.signing_cipher,secret);
 for(const token of [h.ws.tokens.operator,h.other.tokens.owner])for(const method of ['GET','POST','DELETE']){const path=h.root+'/connections'+(method==='DELETE'?'/'+c.id:'');assert.equal((await h.app.call(path,{token,method,...(method==='POST'?{body:h.input('slack')}: {})})).status,403);}
 assert.equal((await h.app.call(h.root+'/connections',{token:h.token,body:{...h.input('sms'),registered:false}})).status,400);
 assert.equal((await h.app.call(h.root+'/connections',{token:h.token,body:{provider:'unsupported'}})).status,409);h.install.a2p=false;assert.equal((await h.app.call(h.root+'/connections',{token:h.token,body:h.input('sms')})).status,409);h.install.a2p=true;h.install.slack=false;assert.equal((await h.app.call(h.root+'/connections',{token:h.token,body:h.input('slack')})).status,409);h.install.slack=true;
 await h.call('/connections/'+c.id,undefined,{method:'DELETE'});const raw=h.event('sms');assert.equal((await h.deliver(c,'sms',raw)).status,410);assert.equal(h.sends.length,0);
 const next=await h.connect('sms');assert.equal(next.id,c.id);assert.equal((await h.deliver(next,'sms',raw)).status,200);
 assert.ok((await h.app.sql("SELECT action FROM audit_events WHERE action='support_channel.revoked'")).length,'revocation is audited');
 }finally{await h.close();}}
export async function exchange(providers=['sms','whatsapp','instagram','messenger']){// The archive policy imports Wrangler, whose proxy setup changes Node's global
 // HTTP dispatcher. Keep archive custody proof in its own process so subsequent
 // native connection journeys retain their loopback provider transport.
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./restore.mjs',import.meta.url))]);await consentExchange();await mediaExchange();await templateExchange();const h=await channelHarness();try{
 for(const p of providers){const c=await h.connect(p),raw=h.event(p);
  assert.equal((await h.deliver(c,p,raw,{})).status,401);if(p==='teams')for(const override of [{aud:'foreign-app'},{iss:'https://untrusted.example'},{serviceurl:'https://untrusted.example/'}])assert.equal((await h.deliver(c,p,raw,h.signed(c,p,raw,undefined,override))).status,401);assert.equal((await h.deliver(c,p,raw+' ',h.signed(c,p,raw))).status,401);
  assert.equal((await h.deliver(c,p,h.event(p,{media:true}))).status,422);
  assert.equal((await h.deliver(c,p,raw)).status,200);const t=await h.ticket(c);assert.ok(t);assert.equal((await h.app.first('SELECT channel FROM conversations WHERE id=?',t.conversation_id)).channel,p);
  assert.equal((await h.deliver(c,p,raw)).status,200);assert.equal((await h.app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',t.conversation_id)).n,1);
  await h.app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${t.conversation_id}/notes`,{token:h.token,body:{content:'Private note must stay private'}});assert.equal(h.sends.length,providers.indexOf(p));
  const message=await h.reply(t);assert.equal(message.accepted,true);assert.equal(h.sends.length,providers.indexOf(p)+1);const sent=h.sends.at(-1);assert.ok(!sent.body.includes('Private note'));assert.ok(sent.body.includes('We+can+help.')||sent.body.includes('We can help.'));
  const status=await h.call('/conversations/'+t.conversation_id);assert.equal(status.data.sends[0].state,'accepted');assert.equal((await h.app.call(h.root+'/conversations/'+t.conversation_id,{token:h.other.tokens.owner})).status,403);
  if(p==='sms'){const receipt=await h.app.first('SELECT provider_id FROM support_channel_sends WHERE message_id=?',message.message.id);const status=state=>new URLSearchParams({AccountSid:h.input(p).account,From:h.input(p).sender,To:'+12025550124',MessageSid:receipt.provider_id,MessageStatus:state}).toString();assert.equal((await h.deliver(c,p,status('delivered'))).status,200);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].state,'delivered');await h.deliver(c,p,status('failed'));assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].state,'delivered');}
  if(p==='whatsapp'){await h.app.db.prepare('UPDATE support_channel_threads SET last_inbound_at=0 WHERE id=?').bind(t.id).run();await h.reply(t);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].error_code,'reply_window_expired');}
  if(p==='instagram'||p==='messenger'){const receipt=await h.app.first('SELECT provider_id FROM support_channel_sends WHERE message_id=?',message.message.id);const update=JSON.stringify({entry:[{id:h.input(p).account,messaging:[{sender:{id:'synthetic-happytohelp-customer'},recipient:{id:h.input(p).sender},delivery:{mids:[receipt.provider_id]}}]}]});assert.equal((await h.deliver(c,p,update)).status,200);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].state,'delivered');}
  // STOP and restored reply consent are covered by the consent lifecycle above.
  if(p==='instagram'||p==='messenger'){await h.app.db.prepare('UPDATE support_channel_threads SET last_inbound_at=0 WHERE id=?').bind(t.id).run();await h.reply(t);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].error_code,'reply_window_expired');}
 }
 for(const p of providers.filter(p=>p!=='sms')){const c=await h.connect(p);await h.deliver(c,p,h.event(p,{sender:'synthetic-happytohelp-late',at:Date.now()-25*3600000}));const t=await h.app.first('SELECT * FROM support_channel_threads WHERE connection_id=? AND recipient=?',c.id,'synthetic-happytohelp-late');await h.reply(t);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].error_code,'reply_window_expired');}
 assert.equal((await h.call('/report')).data.reduce((n,r)=>n+r.count,0),providers.length+providers.filter(p=>p!=='sms').length*2);
 }finally{await h.close();}}
export async function slack(){await sharedExchange();}
export async function erasure(){const h=await channelHarness();try{
 const c=await h.connect('sms');await h.deliver(c,'sms',h.event('sms'));const t=await h.ticket(c);await h.reply(t);
 await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${t.contact_id}/erase`,{token:h.token,body:{}});
 assert.equal(await h.ticket(c),null);assert.equal((await h.app.first('SELECT count(*) n FROM support_channel_fences')).n,1);const result=await h.deliver(c,'sms',h.event('sms'));assert.equal(result.status,200);assert.equal(await h.ticket(c),null);
 const erasure=await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${t.contact_id}/erasure`,{token:h.token});assert.ok(erasure.data.providers.requests.some(r=>r.store==='support-channel:sms'&&r.state==='unsupported'));
 const text=JSON.stringify(await h.app.sql('SELECT * FROM support_channel_events'));assert.ok(!text.includes(t.contact_id));assert.ok(!text.includes('+12025550124'));
 await h.call('/connections/'+c.id,undefined,{method:'DELETE'});await h.connect('sms');await h.deliver(c,'sms',h.event('sms'));assert.equal(await h.ticket(c),null);
 }finally{await h.close();}}
export async function uncertainty(){const h=await channelHarness();try{
 for(const response of [{status:500},{disconnect:true},{status:400}]){const p='sms',c=await h.connect(p);await h.deliver(c,p,h.event(p,{sender:'+1202555012'+(h.sends.length+5)}));const t=await h.ticket(c);h.responses.push(response);const message=await h.reply(t);const count=h.sends.length;const state=(await h.call('/conversations/'+t.conversation_id)).data.sends[0].state;assert.equal(state,response.status===400?'failed':'uncertain');await h.app.scheduled();assert.equal(h.sends.length,count,'recovery does not replay channel sends');assert.ok(message.accepted);}
 }finally{await h.close();}}

async function mediaExchange(){const h=await channelHarness();try{
 for(const p of ['sms','whatsapp','instagram','messenger','slack','teams']){
  const c=await h.connect(p),raw=h.event(p,{media:true,validMedia:true,text:''});assert.equal((await h.deliver(c,p,raw)).status,200);const t=await h.ticket(c);
  let transcript=await h.app.ok('/api/conversations/'+t.conversation_id+'/messages',{token:h.token});assert.equal(transcript.messages.length,1);assert.equal(transcript.messages[0].media.length,1);
  const f=transcript.messages[0].media[0],download='/api/conversations/'+t.conversation_id+'/media/'+f.id;
  assert.equal((await h.app.call(download,{token:h.token})).data,'synthetic attachment');assert.equal((await h.app.call(download,{token:h.other.tokens.owner})).status,404);
  await h.deliver(c,p,raw);transcript=await h.app.ok('/api/conversations/'+t.conversation_id+'/messages',{token:h.token});assert.equal(transcript.messages.length,1);assert.equal(transcript.messages[0].media.length,1);
  const file=await h.app.ok('/api/conversations/'+t.conversation_id+'/media',{token:h.token,raw:true,body:'synthetic outbound attachment',headers:{'Content-Type':'text/plain','X-Filename':'answer.txt'}});
  await h.reply(t,{content:'',mediaIds:[file.id]});assert.equal((await h.call('/conversations/'+t.conversation_id)).data.sends[0].state,'accepted');
  const sent=h.sends.at(-1),grant=p==='sms'?new URLSearchParams(sent.body).get('MediaUrl'):p==='whatsapp'?JSON.parse(sent.body).document.link:p==='slack'?JSON.parse(sent.body).attachments[0].title_link:p==='teams'?JSON.parse(sent.body).attachments[0].contentUrl:JSON.parse(sent.body).message.attachment.payload.url;
  assert.ok(grant.startsWith('https://app.example/api/support-channels/attachments/'));assert.equal((await h.app.call(new URL(grant).pathname)).data,'synthetic outbound attachment');
  if(['slack','teams'].includes(p)){
   const b=JSON.parse(raw),at=new Date().toISOString(),changed=p==='slack'?{team_id:h.input(p).account,event_id:'synthetic-happytohelp-media-edit',event:{type:'message',subtype:'message_changed',channel:h.input(p).channels[0],event_ts:String(Date.now()/1000),message:{ts:b.event.ts,user:b.event.user,text:'Changed attachment caption'}}}:{...b,type:'messageUpdate',timestamp:at,attachments:[],text:'Changed attachment caption'};
   const result=await h.deliver(c,p,JSON.stringify(changed));assert.equal(result.data.data[0].reason,'attachment_change_requires_review');
   const preserved=await h.app.ok('/api/conversations/'+t.conversation_id+'/messages',{token:h.token});assert.equal(preserved.messages[0].media[0].id,f.id);assert.equal((await h.app.call(download,{token:h.token})).data,'synthetic attachment');
  }
  await h.call('/connections/'+c.id,undefined,{method:'DELETE'});assert.equal((await h.app.call(new URL(grant).pathname)).status,404);
  if(['slack','teams'].includes(p)){await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${t.contact_id}/erase`,{token:h.token,body:{}});assert.equal((await h.app.call(download,{token:h.token})).status,404);}

 }
 const c=await h.connect('sms');h.mediaResponses.push({status:302,headers:{location:'https://untrusted.example/private'}});assert.equal((await h.deliver(c,'sms',h.event('sms',{sender:'+12025550128',media:true,validMedia:true}))).status,422);assert.ok(!h.app.requests.some(r=>r.url.includes('untrusted.example')));
 }finally{await h.close();}}
async function templateExchange(){const h=await channelHarness();try{
 const c=await h.connect('whatsapp');await h.deliver(c,'whatsapp',h.event('whatsapp'));const t=await h.ticket(c),path='/conversations/'+t.conversation_id+'/templates';
 const send=async(extra={})=>h.app.call(h.root+path,{token:h.token,body:{template_id:h.templates[0].id,local_id:randomUUID(),parameters:['123'],expected_revision:(await h.app.ok('/api/conversations/'+t.conversation_id,{token:h.token})).revision,...extra}});
 await h.app.db.prepare('UPDATE support_channel_threads SET last_inbound_at=0 WHERE id=?').bind(t.id).run();assert.equal((await send()).status,409);assert.equal(h.sends.length,0);
 await h.deliver(c,'whatsapp',h.event('whatsapp',{text:'I agree to WhatsApp support updates'}));await h.app.db.prepare('UPDATE support_channel_threads SET last_inbound_at=0 WHERE id=?').bind(t.id).run();
 assert.equal((await h.call(path)).data.length,1);assert.equal((await send({template_id:'unapproved'})).status,409);
 h.templates[0].status='PAUSED';assert.equal((await send()).status,409);h.templates[0].status='APPROVED';
 const revision=(await h.app.ok('/api/conversations/'+t.conversation_id,{token:h.token})).revision,local_id=randomUUID();assert.equal((await send({expected_revision:revision,local_id})).status,200);assert.equal((await send({expected_revision:revision,local_id})).status,200);assert.equal(h.sends.length,1);assert.equal(JSON.parse(h.sends[0].body).type,'template');
 await h.reply(t);assert.equal(h.sends.length,1,'a template does not reopen the free-text window');
 await h.deliver(c,'whatsapp',h.event('whatsapp',{text:'STOP'}));assert.equal((await send()).status,409);await h.call('/connections/'+c.id,undefined,{method:'DELETE'});await h.connect('whatsapp');await h.deliver(c,'whatsapp',h.event('whatsapp',{text:'START'}));assert.equal((await send()).status,409,'START never restores continuation authority');await h.deliver(c,'whatsapp',h.event('whatsapp',{text:'I agree to WhatsApp support updates'}));assert.equal((await send()).status,409);assert.equal(h.sends.length,1);
 }finally{await h.close();}}

async function sharedExchange(){const h=await channelHarness();try{
 for(const p of ['slack','teams']){
  const c=await h.connect(p);const company=(await h.app.ok(`/api/management/projects/${h.ws.projectId}/companies`,{token:h.token,body:{name:'Customer account '+p}})).company;await h.call('/connections/'+c.id+'/accounts',{channel_id:h.input(p).channels[0],company_id:company.id},{method:'PUT'});const raw=h.event(p,{id:'synthetic-happytohelp-inbound-'+p});assert.equal((await h.deliver(c,p,raw)).status,200);const t=await h.ticket(c);
  const companyView=await h.app.ok(`/api/management/projects/${h.ws.projectId}/companies/${company.id}`,{token:h.token});assert.ok(companyView.members.some(m=>m.id===t.contact_id));
  const followup=h.event(p,{sender:'synthetic-happytohelp-colleague',text:'I can add more detail'});assert.equal((await h.deliver(c,p,followup)).status,200);const participants=await h.app.ok('/api/conversations/'+t.conversation_id+'/messages',{token:h.token});assert.notEqual(participants.messages[0].actor_id,participants.messages[1].actor_id);assert.equal((await h.app.ok('/api/conversations/'+t.conversation_id,{token:h.token})).contact_id,t.contact_id);
  const challenge=async role=>(await h.app.ok(h.root+'/connections/'+c.id+'/link-code',{token:h.ws.tokens[role],body:{}})).data.code;
  const ownerCode=await challenge('owner');assert.equal((await h.deliver(c,p,h.event(p,{text:'support link '+ownerCode,sender:'synthetic-happytohelp-owner'}))).status,403);assert.equal((await h.deliver(c,p,h.event(p,{text:'support link '+ownerCode,sender:'synthetic-happytohelp-owner',personal:true,channel:p==='slack'?'D12345678':''}))).status,200);
  assert.equal((await h.deliver(c,p,h.event(p,{text:'support link '+ownerCode,sender:'synthetic-happytohelp-other',personal:true,channel:p==='slack'?'D12345678':''}))).status,403);
  const adminCode=await challenge('admin');assert.equal((await h.deliver(c,p,h.event(p,{text:'support link '+adminCode,sender:'synthetic-happytohelp-admin',personal:true,channel:p==='slack'?'D12345678':''}))).status,200);
  const command=(text,extra={})=>h.deliver(c,p,h.event(p,{text,sender:'synthetic-happytohelp-owner',...extra}));
  assert.equal((await h.deliver(c,p,h.event(p,{text:'support acknowledge'}))).status,403);
  const acknowledge=h.event(p,{text:'support acknowledge',sender:'synthetic-happytohelp-owner'});assert.equal((await h.deliver(c,p,acknowledge)).status,200);let ticket=await h.app.ok('/api/conversations/'+t.conversation_id,{token:h.token});assert.equal(ticket.assigned_to,h.ws.users.owner);const count=h.sends.length;await h.deliver(c,p,acknowledge);assert.equal(h.sends.length,count);
  assert.equal((await command('support handoff synthetic-happytohelp-admin')).status,200);ticket=await h.app.ok('/api/conversations/'+t.conversation_id,{token:h.token});assert.equal(ticket.assigned_to,h.ws.users.admin);
  assert.equal((await command('support assign synthetic-happytohelp-owner')).status,200);const response=h.event(p,{text:'We are checking your order.',sender:'synthetic-happytohelp-owner'});assert.equal((await h.deliver(c,p,response)).status,200);assert.equal((await h.deliver(c,p,response)).status,200);const transcript=await h.app.ok('/api/conversations/'+t.conversation_id+'/messages',{token:h.token});assert.equal(transcript.messages.at(-1).actor_id,h.ws.users.owner);
  const before=h.sends.length;await h.app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${t.conversation_id}/notes`,{token:h.token,body:{content:'Private escalation detail'}});assert.equal(h.sends.length,before);
  const current=await h.app.ok('/api/conversations/'+t.conversation_id,{token:h.token});await h.app.ok(`/api/dashboard/projects/${h.ws.projectId}/conversations/${t.conversation_id}/ticket`,{method:'PATCH',token:h.token,body:{agent_id:h.ws.users.admin,expected_ticket_version:current.ticket_version}});assert.ok(h.sends.length>before);assert.ok(!h.sends.some(s=>s.body.includes('Private escalation')));
  const change=(kind,{media=false,sender='synthetic-happytohelp-customer',id='synthetic-happytohelp-'+kind+'-'+p}={})=>{
   if(p==='teams'){const changed=JSON.parse(raw);changed.from={id:sender,aadObjectId:sender};changed.type=kind==='deleted'?'messageDelete':'messageUpdate';changed.text='Corrected order';changed.timestamp=new Date().toISOString();if(media)changed.attachments=[{contentType:'application/vnd.microsoft.card.adaptive',content:{private:'unsupported replacement'}}];return JSON.stringify(changed);}
   return JSON.stringify({team_id:h.input(p).account,event_id:id,event:{type:'message',subtype:kind==='deleted'?'message_deleted':'message_changed',channel:'C12345678',event_ts:String(Date.now()/1000),message:{ts:'1710000000.1',user:sender,text:'Corrected order',...(media?{files:[{id:'synthetic-happytohelp-replacement'}]}:{})}}});
  };
  const edit=change('edited');assert.equal((await h.deliver(c,p,edit)).status,200);await h.deliver(c,p,edit);let changes=(await h.call('/conversations/'+t.conversation_id)).data.changes;assert.equal(changes.length,1);assert.equal(changes[0].content,'Corrected order');assert.equal(changes[0].actor_id,t.contact_id);assert.ok(changes[0].actor_name&&changes[0].at>0);
  const held=await h.deliver(c,p,change('edited',{media:true,id:'synthetic-happytohelp-attachment-'+p}));assert.equal(held.status,200);assert.equal(held.data.data[0].reason,'attachment_change_requires_review');
  assert.equal((await h.deliver(c,p,change('deleted'))).status,200);changes=(await h.call('/conversations/'+t.conversation_id)).data.changes;assert.deepEqual(new Set(changes.map(x=>x.kind)),new Set(['edited','deleted','attachment_review']));
  const retained=await h.app.ok('/api/conversations/'+t.conversation_id+'/messages',{token:h.token});assert.equal(retained.messages[0].content,'Please help with my order');
  const unknown=await h.deliver(c,p,change('edited',{sender:'synthetic-happytohelp-stranger'}));assert.equal(unknown.data.data[0].held,true);assert.equal((await h.call('/conversations/'+t.conversation_id)).data.changes.length,3);
  assert.equal((await h.deliver(c,p,h.event(p,{channel:p==='slack'?'C99999999':'19:synthetic-happytohelp-forbidden'}))).status,403);assert.equal((await h.deliver(c,p,raw,{})).status,401);
  if(p==='teams'){const wrong=JSON.parse(raw);wrong.channelData.tenant.id='synthetic-happytohelp-foreign';assert.equal((await h.deliver(c,p,JSON.stringify(wrong))).status,403);for(const override of [{aud:'foreign-app'},{iss:'https://untrusted.example'},{serviceurl:'https://untrusted.example/'}])assert.equal((await h.deliver(c,p,raw,h.signed(c,p,raw,undefined,override))).status,401);}
  else{assert.equal((await h.deliver(c,p,raw,h.signed(c,p,raw,'1'))).status,401);assert.equal((await h.deliver(c,p,h.event(p,{subtype:'channel_join'}))).data.data[0].held,true);}
  const final=h.sends.length;await h.call('/connections/'+c.id,undefined,{method:'DELETE'});assert.equal((await command('support acknowledge')).status,410);await h.reply(t);assert.equal(h.sends.length,final);await h.connect(p);assert.equal((await command('support status')).status,200);assert.equal(h.sends.length,final+1);await h.reply(t);assert.equal(h.sends.length,final+2);if(p==='slack'){assert.equal(JSON.parse(h.sends.at(-1).body).thread_ts,'1710000000.1');assert.equal(JSON.parse(h.sends.at(-1).body).mrkdwn,false);}
  await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${t.contact_id}/erase`,{token:h.token,body:{}});assert.equal((await h.call('/conversations/'+t.conversation_id)).data,null);assert.equal((await h.app.first('SELECT count(*) n FROM support_channel_changes WHERE conversation_id=?',t.conversation_id)).n,0);assert.equal((await h.deliver(c,p,raw)).data.data[0].erased,true);assert.equal((await h.deliver(c,p,edit)).data.data[0].held,true);
 }
 // Native member erasure also removes linked provider identities and unused linking grants.
 const teams=(await h.call('/connections')).data.find(c=>c.provider==='teams');
 const pending=(await h.app.ok(h.root+'/connections/'+teams.id+'/link-code',{token:h.ws.tokens.admin,body:{}})).data.code;
 await h.app.ok(`/api/management/projects/${h.ws.projectId}/agents/${h.ws.users.admin}/erase`,{token:h.token,body:{}});
 assert.equal((await h.deliver(teams,'teams',h.event('teams',{text:'support status',sender:'synthetic-happytohelp-admin'}))).status,403);
 assert.equal((await h.deliver(teams,'teams',h.event('teams',{text:'support link '+pending,sender:'synthetic-happytohelp-admin',personal:true,channel:''}))).status,403);
 }finally{await h.close();}}

async function consentExchange(){const h=await channelHarness();try{
 for(const p of ['sms','whatsapp']){
  const event=(options={})=>h.event(p,{sender:'+12025550124',...options});
  const c=await h.connect(p),inbound=event();await h.deliver(c,p,inbound);const t=await h.ticket(c),status=()=>h.call('/conversations/'+t.conversation_id);
  const schedule=async()=>h.app.ok(`/api/management/projects/${h.ws.projectId}/workflow-schedules`,{token:h.token,body:{conversation_id:t.conversation_id,kind:'reply',due_at:Date.now()+3600000,timezone:'UTC',body:'Queued during opt-out',owner_id:h.ws.users.owner}});
  const stop=event({text:'STOP'});assert.equal((await h.deliver(c,p,stop)).status,200);await h.reply(t);const blocked=(await status()).data.sends[0];assert.equal(blocked.error_code,'customer_opted_out');
  const scheduled=await schedule();assert.equal(scheduled.data.state,'cancelled');
  await h.call('/connections/'+c.id,undefined,{method:'DELETE'});await h.connect(p);assert.match((await status()).data.blocked,/customer_opted_out/);
  assert.equal((await h.app.call(h.root+'/conversations/'+t.conversation_id+'/consent',{token:h.token,body:{consent:true}})).status,409);
  const before=h.sends.length,help=event({text:'HELP'}),helpResult=await h.deliver(c,p,help);assert.equal(helpResult.status,200);if(p==='sms')assert.match(helpResult.data,/<Message>/);else assert.equal(h.sends.length,before+1);assert.match((await status()).data.blocked,/customer_opted_out/);await h.deliver(c,p,help);assert.equal(h.sends.length,p==='sms'?before:before+1);
  const start=event({text:'START',id:'synthetic-happytohelp-start-'+p});assert.equal((await h.deliver(c,p,start,{})).status,401);assert.match((await status()).data.blocked,/customer_opted_out/);
  // A different subscriber and a different channel cannot grant this thread consent.
  await h.deliver(c,p,event({text:'START',sender:p==='sms'?'+12025550129':'synthetic-happytohelp-other'}));assert.match((await status()).data.blocked,/customer_opted_out/);
  const otherProvider=p==='sms'?'whatsapp':'sms',otherChannel=await h.connect(otherProvider);await h.deliver(otherChannel,otherProvider,h.event(otherProvider,{text:'START',sender:'+12025550124'}));assert.match((await status()).data.blocked,/customer_opted_out/,'consent is scoped to its channel');
  assert.equal((await h.deliver(c,p,start)).status,200);assert.equal((await status()).data.blocked,null);const fact=(await status()).data.consent.find(f=>f.kind==='start');assert.equal(fact.event_id,'synthetic-happytohelp-start-'+p);assert.ok(fact.at>0&&fact.received_at>=fact.at);
  const count=h.sends.length;await h.app.scheduled();assert.equal(h.sends.length,count);assert.equal((await status()).data.sends.find(s=>s.message_id===blocked.message_id).state,'blocked');
  await h.reply(t,{content:'A freshly approved support reply'});assert.equal(h.sends.length,count+1);
  await h.deliver(c,p,event({text:'STOP'}));await h.deliver(c,p,start);assert.match((await status()).data.blocked,/customer_opted_out/,'replayed START cannot undo later STOP');
  await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${t.contact_id}/erase`,{token:h.token,body:{}});assert.equal((await status()).data,null);assert.equal((await h.app.first('SELECT count(*) n FROM support_channel_consent WHERE contact_id=?',t.contact_id)).n,0);
 }
 }finally{await h.close();}}
