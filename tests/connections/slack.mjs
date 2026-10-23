import {phases} from '../journeys/kit/scenarios.mjs';const test=phases(import.meta.url);import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {harness,body} from './harness.mjs';
const recorded=JSON.parse(readFileSync(new URL('./fixtures/slack-responses.json',import.meta.url),'utf8'));
const root='/api/management/projects/p/connections';
test('both Slack modes deliver one logical new-conversation notification and escape mentions, ampersands and links',async()=>{
 await (await import('../helpers/support-channels/journeys.mjs')).slack();
 for(const mode of ['incoming-webhook','bot']){const h=await harness();try{
  const privateValue=randomBytes(24).toString('hex'),input=mode==='bot'?{token:'xoxb-'+privateValue,channel:'C12345678'}:{url:'https://hooks.slack.com/services/T123/B123/'+privateValue};
  const saved=await h.call(root+'/slack',body({name:'Slack',mode,...input}));await h.contact();const conv=await h.conversation();
  // The owner answers the visitor without the dashboard open, so presence-based away is off.
  await h.call('/api/management/projects/p/availability',{...body({is_presence_away_enabled:false}),method:'PUT'});
  const hostile='<!channel> <@U123> & <https://example.test|link>';
  await h.dispatch();assert.equal(h.received.length,0,'empty widget conversation waits for native visitor context');
  await h.call('/api/conversations/'+conv.id+'/messages',{actor:'visitor',...body({content:hostile,localId:'hostile-visitor',expectedRevision:0})});
  // Recorded documented acknowledgements only; no live Slack account is called.
  h.responses.push(mode==='bot'?recorded.botAccepted:recorded.webhookAccepted);
  await h.dispatch();assert.equal(h.received.length,1);const message=JSON.parse(h.received[0].body);assert.equal(message.blocks[0].text.text,'&lt;!channel&gt; &lt;@U123&gt; &amp; &lt;https://example.test|link&gt;');assert.equal(message.mrkdwn,false);assert.equal(message.unfurl_links,false);assert.equal(message.blocks[0].text.type,'plain_text');if(mode==='bot'){assert.equal(message.channel,'C12345678');assert.ok(h.received[0].headers.authorization==='Bearer '+input.token)}else assert.equal(message.channel,undefined);
  await h.restart();await h.dispatch();assert.equal(h.received.length,1);await h.call('/api/conversations/'+conv.id+'/messages',body({content:'Follow up',localId:'followup',expectedRevision:1,authoring:{kind:'human'}}));await h.dispatch();assert.equal(h.received.length,1,'follow-up message does not post');
  const list=await h.call(root+'/slack'),logs=await h.call(root+'/deliveries');assert.equal(logs.data[0].state,'accepted');assert.ok(!JSON.stringify(list).includes(privateValue));assert.ok(!JSON.stringify(logs).includes(privateValue));
  h.responses.push(mode==='bot'?recorded.botRejected:recorded.webhookRejected);await h.call(root+'/slack/'+saved.id+'/test',body({}));assert.equal(h.received.length,2);const failed=(await h.call(root+'/deliveries')).data.find(x=>x.event==='integration.test');assert.equal(failed.state,'rejected');assert.ok(failed.error_class.startsWith('slack_'));
  assert.equal(h.external,0)
 }finally{await h.close()}}
});
test('Slack notification context and recipients stay inside their native workspace',async()=>{
 const h=await harness();try{
  for(const [project,actor,path] of [['p','owner','A'],['q','foreign','B']])await h.call(`/api/management/projects/${project}/connections/slack`,{actor,...body({name:'Workspace '+project,mode:'incoming-webhook',url:'https://hooks.slack.com/services/T123/B123/'+path})});
  await h.contact();await h.contact('foreign-visitor','q');const a=await h.conversation(),b=await h.conversation('foreign-visitor','q');
  for(const [conversation,actor,text] of [[a,'visitor','Only workspace A'],[b,'foreign-visitor','Only workspace B']])await h.call('/api/conversations/'+conversation.id+'/messages',{actor,...body({localId:'first-'+actor,content:text,expectedRevision:0})});
  h.responses.push({status:200,body:'ok'},{status:200,body:'ok'});await h.dispatch('p');assert.equal(h.received.length,1);assert.equal(JSON.parse(h.received[0].body).blocks[0].text.text,'Only workspace A');assert.ok(h.received[0].path.endsWith('/A'));
  await h.dispatch('q');assert.equal(h.received.length,2);assert.equal(JSON.parse(h.received[1].body).blocks[0].text.text,'Only workspace B');assert.ok(h.received[1].path.endsWith('/B'));await h.restart();await h.dispatch('p');await h.dispatch('q');assert.equal(h.received.length,2);
 }finally{await h.close()}
});
