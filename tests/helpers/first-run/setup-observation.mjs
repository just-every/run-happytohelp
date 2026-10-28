import assert from 'node:assert/strict'

// Continue the provisioned workspace into Setup. A single mutable provider edge
// lets the same saved configuration progress from unchecked to observed, stale,
// rejected and uncertain, without rebuilding the installation for each state.
export async function setupObservation(i,workspace){
 const {app,owner,call,observations:s}=i,token=owner.token,p=workspace.id
 const endpoint=`/api/management/projects/${p}/activation`
 const read=async()=> (await call(endpoint,{token,status:200})).data.data
 const check=async body=>(await call(endpoint+'/check',{token,body,status:200})).data.data
 const step=(data,id)=>data.steps.find(row=>row.id===id)
 const skip=async(id,skipped)=>(await call(endpoint+'/skip',{token,body:{step:id,skipped},status:200})).data.data
 const send=async()=>(await call(endpoint+'/test-mail',{token,body:{},status:200})).data.data
 let data=await read(),requests=app.requests.length
 const receipts=await app.sql('SELECT * FROM activation_receipts WHERE project_id=?',p)
 assert.equal(data.done,0);await read()
 assert.equal(app.requests.length,requests);assert.deepEqual(await app.sql('SELECT * FROM activation_receipts WHERE project_id=?',p),receipts)
 assert.ok(!JSON.stringify(data).includes('synthetic-provisioning'))
 assert.ok(!JSON.stringify(data).includes('fingerprint'))
 assert.equal((await app.call(endpoint)).status,401)
 const foreign=await app.seedWorkspace('onboarding-denied')
 assert.equal((await app.call(endpoint,{token:foreign.tokens.owner})).status,403)
 assert.equal((await app.call(endpoint+'/check',{token:foreign.tokens.operator,body:{}})).status,403)
 assert.equal((await app.call(endpoint+'/test-mail',{token,body:{to:'other@example.test'}})).status,400)
 assert.equal(step(await check({step:'model_key'}),'model_key').state,'unavailable')
 const beforeSkip=app.requests.length,skipped=await skip('widget_seen',true)
 assert.equal(step(skipped,'widget_seen').placement,'skipped');assert.notEqual(step(skipped,'widget_seen').state,'done')
 assert.equal(step(await read(),'widget_seen').placement,'skipped');assert.equal(app.requests.length,beforeSkip)
 await skip('widget_seen',false)
 await app.configure({OPENAI_API_KEY:'synthetic-provisioning-model',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-provisioning-mail',EMAIL_FROM:'support@example.test'})
 // This workspace was created with email disabled. Enable its saved mailbox
 // before testing delivery so Setup observes the same sender the send uses.
 const mailbox=await i.mailboxOf(token,p)
 await call(`/api/management/projects/${p}/email-settings`,{token,method:'PUT',body:{from_name:'Support',from_address:'support@example.test',inbound_address:mailbox.email_to_address,is_enabled:true},status:200})
 // The untouched starter chooses the installed model when validation begins.
 data=await check({auto:true})
 assert.equal(step(data,'model_key').state,'done')
 const fresh=app.requests.length;await check({auto:true});assert.equal(app.requests.length,fresh,'fresh automatic checks repeat no network work')
 await app.db.prepare("UPDATE activation_receipts SET checked_at=? WHERE project_id=? AND step_id='model_key'").bind(Date.now()-16*60000,p).run()
 assert.equal(step(await read(),'model_key').state,'unknown');assert.equal(app.requests.length,fresh)
 s.modelStatus=401;assert.equal(step(await check({step:'model_key'}),'model_key').state,'failed')
 await skip('model_key',true);assert.equal(step(await read(),'model_key').placement,'needs_you','a rejected key cannot be hidden with a skip')
 s.modelStatus=200;assert.equal(step(await check({step:'model_key'}),'model_key').state,'done')
 s.dns='pending';assert.equal(step(await check({step:'sender_dns'}),'sender_dns').state,'pending')
 s.dns='verified';assert.equal(step(await check({step:'sender_dns'}),'sender_dns').state,'done')
 // Provider acceptance is pending. Only an explicit delivered outcome confirms.
 let mail=await send();assert.equal(step(mail,'owner_mail').state,'pending')
 const sends=s.sent.size;await send();assert.equal(s.sent.size,sends)
 s.event='delivered';assert.equal(step(await check({step:'owner_mail'}),'owner_mail').state,'done')
 s.event='bounced';assert.equal(step(await check({step:'owner_mail'}),'owner_mail').state,'failed')
 await app.configure({EMAIL_API_KEY:'synthetic-rotated-provisioning-mail'});s.lost=true
 assert.equal(step(await send(),'owner_mail').state,'unknown')
 const attempted=s.attempts;await send();await app.scheduled();assert.equal(s.attempts,attempted,'uncertain explicit mail is never resent')
 s.lost=false;s.event='sent'
 // Origin and installed-widget observations belong to this workspace and site.
 const chat=await i.visitor(token,p,workspace.origin),widget=`/api/conversations/${chat.conversation.id}/widget-events`
 assert.equal((await app.call(widget,{token:chat.session.token,headers:{Origin:'https://foreign.test'},body:{action:'pingActive',data:{opened:true}}})).status,403)
 await skip('widget_seen',true)
 await call(widget,{token:chat.session.token,origin:workspace.origin,body:{action:'pingActive',data:{opened:true}},status:200})
 data=await check({auto:true});assert.equal(step(data,'widget_seen').state,'done');assert.equal(step(data,'widget_seen').placement,'set','a real observation wins over a skip')
 assert.equal(step(await check({step:'inbound_address'}),'inbound_address').state,'pending')
 await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer '+app.bindings.INBOUND_EMAIL_TOKEN},body:{messageId:'synthetic-onboarding-receipt',to:mailbox.email_to_address,from:'visitor@example.test',subject:'An inbound receipt',text:'Can you confirm my order?',headers:{'Auto-Submitted':'auto-generated'}}})
 assert.equal(step(await check({step:'inbound_address'}),'inbound_address').state,'done')
 await call(`/api/management/projects/${p}/settings`,{token,method:'PUT',body:{allowed_origin:'https://changed.example.test'},status:200})
 assert.notEqual(step(await read(),'widget_seen').state,'done')
}
