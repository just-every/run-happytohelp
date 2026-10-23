import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
// Extends the existing connection-settings journey at both widths; only the provider network is faked.
export async function channelsBrowser({page,context,runtime,owner,width,audit}){
 const root=`/api/support-channels/projects/${owner.projectId}`;
 await page.goto(runtime.origin+`/projects/${owner.projectId}/support-channels`);
 await page.getByLabel('Provider account ID',{exact:true}).fill('synthetic-happytohelp-account-'+width);
 await page.getByLabel('US sender number (+1)',{exact:true}).fill('+12025550123');
 await page.getByLabel('Provider access token',{exact:true}).fill('synthetic-happytohelp-2');
 await page.getByLabel('Twilio auth token for signature verification',{exact:true}).fill('synthetic-happytohelp-1');
 await page.getByLabel('I have completed the provider’s A2P 10DLC registration for this US sender.',{exact:true}).check();
 await page.getByRole('button',{name:'Save support channel',exact:true}).click();
 await page.getByRole('button',{name:'Dismiss verification token',exact:true}).click();
 assert.equal(await page.getByLabel('Provider access token',{exact:true}).inputValue(),'');
 await audit(page,'support-channel-settings-'+width);
 const list=await (await context.request.get(runtime.origin+root+'/connections')).json(),c=list.data[0];assert.ok(c);
 const raw=new URLSearchParams({AccountSid:c.account,From:'+12025550124',To:c.sender,MessageSid:'synthetic-happytohelp-'+width,Body:'Can you help with my delivery?',NumMedia:'0'}).toString(),f=new URLSearchParams(raw),url=runtime.origin+'/api/support-channels/webhooks/'+c.id;
 const signed=url+[...f.keys()].sort().map(k=>k+f.get(k)).join('');
 const response=await context.request.post(url,{data:raw,headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':createHmac('sha1','synthetic-happytohelp-1').update(signed).digest('base64')}});assert.equal(response.status(),200);
 const conversations=await (await context.request.get(runtime.origin+'/api/conversations')).json(),ticket=conversations.conversations.find(t=>t.channel==='sms');assert.ok(ticket);
 const sent=await context.request.post(runtime.origin+`/api/conversations/${ticket.id}/messages`,{data:{localId:'browser-channel-reply',content:'We will check that for you.',expectedRevision:ticket.revision,authoring:{kind:'human'}}});assert.equal(sent.status(),200);
 await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations/${ticket.id}`);
 await page.locator('.conversation-header').waitFor();
 const tab=page.getByRole('tab',{name:'Ticket',exact:true});if(!await tab.isVisible())await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();await tab.click();
 await page.locator('#ticket-section-support-channel-heading').click();
 await page.getByText('Channel send: accepted',{exact:true}).waitFor();await audit(page,'support-channel-inbox-'+width);
 await context.request.delete(runtime.origin+root+'/connections/'+c.id);
 await page.getByRole('button',{name:'Refresh channel status',exact:true}).click();await page.getByText(/connection revoked: reconnect/).waitFor();await audit(page,'support-channel-revoked-'+width);
 await page.goto(runtime.origin+`/projects/${owner.projectId}/support-channels`);await page.getByText('Status: Revoked',{exact:true}).waitFor();await page.getByText('Twilio US SMS: accepted · 1',{exact:true}).waitFor();await audit(page,'support-channel-report-'+width);
}
