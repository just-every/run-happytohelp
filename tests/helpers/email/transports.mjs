import assert from 'node:assert/strict'
import {mailApp} from './app.mjs'
import {mailboxProviderJourney} from './mailbox-provider.mjs'

const png=new TextEncoder().encode('image'),b64=bytes=>btoa(String.fromCharCode(...bytes))

// A mail customer's conversation on one transport, with helpers to reply and read delivery states.
async function transport(provider){
 const m=await mailApp({bindings:{EMAIL_PROVIDER:provider,EMAIL_API_KEY:'fixture-key',EMAIL_ACCOUNT_ID:'a'.repeat(32)},outbox:'help@support.example.com'}),{DB,app}=m
 await DB.batch([
  DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('contact','p','customer@example.com',1)"),
  DB.prepare("INSERT INTO conversations(id,project_id,contact_id,assigned_to,revision,last_message_id,created_at,updated_at) VALUES('c','p','contact','op',1,'earlier',1,1)"),
  DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('earlier','p','c','earlier','contact','contact','An earlier question',1,1)"),
 ])
 const reply=async(localId,content='Here is your answer.',mediaIds=[])=>{const head=await DB.prepare("SELECT revision,last_message_id FROM conversations WHERE id='c'").first();const response=await m.post('c/messages',{localId,content,expectedRevision:head.revision,expectedLastMessageId:head.last_message_id,mediaIds});assert.equal(response.status,200,await response.clone().text());return (await response.json()).message}
 const upload=async(name,type,bytes)=>(await (await app.request('/api/conversations/c/media',{method:'POST',raw:true,headers:{...m.operator,'Content-Type':type,'X-Filename':name},body:bytes})).json()).id
 const state=message=>DB.prepare('SELECT state FROM email_deliveries WHERE id LIKE ?').bind(`message:${message.id}:%`).first().then(row=>row?.state)
 const settle=async message=>{await app.until(async()=>!['sending',undefined].includes(await state(message)),{message:'delivery outcome'});return state(message)}
 return {...m,reply,upload,state,settle}
}

// Every configured transport carries the reply with its inline image and file, a reply address that leads back,
// and an exact delivery identity; acceptance, refusal, a lost response or a bounce settles once and is never resent.
export async function transportsJourney(){
 await mailboxProviderJourney()
 for(const provider of ['sendgrid','resend','cloudflare']){
  const t=await transport(provider),{mail,app}=t
  try{
   const message=await t.reply('rich','<p>Body</p>',[await t.upload('shot.png','image/png',png),await t.upload('note.txt','text/plain',new TextEncoder().encode('note'))])
   assert.equal(await t.settle(message),'sent',provider);const [wire]=mail.sent,body=wire.body
   if(provider==='sendgrid'){
    assert.equal(wire.url,'https://api.sendgrid.com/v3/mail/send');assert.equal(wire.headers.authorization,'Bearer fixture-key');assert.equal(body.from.email,'help@support.example.com')
    assert.match(body.reply_to.email,/^inbound\+r\./);assert.deepEqual(body.personalizations[0].to,[{email:'customer@example.com'}]);assert.match(body.custom_args.rer_delivery_id,/^message:/)
   }else if(provider==='resend'){assert.equal(wire.url,'https://api.resend.com/emails');assert.ok(wire.headers['idempotency-key']);assert.match(body.reply_to,/^inbound\+r\./)}
   else{assert.equal(wire.url,`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/email/sending/send`);assert.match(body.reply_to,/^inbound\+r\./)}
   const files=body.attachments;assert.equal(files[0].filename,'shot.png');assert.equal(files[0].content,b64(png));assert.equal(files[1].content,btoa('note'));if(provider!=='resend')assert.equal(files[0].disposition,'inline')
   assert.match(provider==='sendgrid'?body.content.find(part=>part.type==='text/html').value:body.html,new RegExp('cid:'+files[0].content_id))
   // The reply address leads back into this conversation as the customer.
   const to=provider==='sendgrid'?body.reply_to.email:body.reply_to
   assert.equal(await t.email(`From: customer@example.com\r\nTo: ${to}\r\nMessage-ID: <back-${provider}@example.com>\r\nContent-Type: text/plain\r\n\r\nThanks`,{from:'customer@example.com',to}),undefined);assert.equal((await t.admitted(`back-${provider}@example.com`)).conversation_id,'c')
   // The operator digest carries loop-suppression headers wherever the transport accepts custom headers.
   const before=mail.sent.length;await t.idle();const digest=mail.sent.slice(before).find(entry=>JSON.stringify(entry.body).includes('op@example.com'));assert.ok(digest,provider)
   assert.deepEqual(digest.body.headers,provider==='cloudflare'?undefined:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'})
   // A replayed delivery never sends again; a lost response is uncertain and never resent.
   const sent=mail.sent.length;await t.replay(message);assert.equal(mail.sent.length,sent)
   mail.mode='lost';const lost=await t.reply('lost');assert.equal(await t.settle(lost),'uncertain');const attempts=mail.attempts;mail.mode='deliver'
   await t.replay(lost);assert.equal(mail.attempts,attempts)
   // A provider refusal fails the delivery once; Cloudflare reports bounces and omissions in its body.
   const refusals=provider==='cloudflare'?[[{success:true,result:{queued:[],delivered:[],permanent_bounces:['customer@example.com']}},'failed'],[{success:true,result:{queued:[],delivered:[],permanent_bounces:[]}},'uncertain']]:[[new Response('provider details must stay private',{status:401}),'failed']]
   for(const [index,[answer,expected]] of refusals.entries()){
    mail.respond=()=>answer instanceof Response?answer.clone():Response.json(answer);const refused=await t.reply('refused-'+index);assert.equal(await t.settle(refused),expected,provider);mail.respond=null
    const tries=mail.attempts;await t.replay(refused);assert.equal(mail.attempts,tries)
   }
   if(provider==='sendgrid'){
    // While the provider has not answered, a replay cannot submit a second attempt; the answer settles it once.
    for(const outcome of ['sent','uncertain']){
     let finish;const answer=new Promise(done=>{finish=done});mail.respond=()=>answer
     const pending=await t.reply('pending-'+outcome);await app.until(async()=>await t.state(pending)==='sending',{message:'sending claim'});const tries=mail.attempts
     await t.replay(pending);assert.equal(mail.attempts,tries,'a pending claim cannot submit again')
     finish(outcome==='sent'?new Response(null,{status:202,headers:{'X-Message-Id':'deferred'}}):new Response(null,{status:500}));assert.equal(await t.settle(pending),outcome);mail.respond=null
     await t.replay(pending);assert.equal(mail.attempts,tries)
    }
    // A mailbox that cannot receive mail gets no reply address; the email points to the chat instead.
    await t.DB.prepare("UPDATE email_settings SET inbound_address='inbound@unrouted.example' WHERE project_id='p'").run()
    const unrouted=await t.reply('unrouted');assert.equal(await t.settle(unrouted),'sent');const last=mail.sent.at(-1).body
    assert.equal(last.reply_to,undefined);assert.match(last.content[0].value,/Replies to this email are not received\. To answer, continue in the chat: https:\/\/example\.com\/#launch-chat$/)
   }
  }finally{await t.close()}
 }
}
