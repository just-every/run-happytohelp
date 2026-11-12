import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {mailApp,replyTo} from './app.mjs'

// Mailgun route forwards: the signed form post (no secret in the URL), the key and signature, freshness and one-time token
// rules, the release of a token when the forward is not answered 200, routing, attachments, threading, reply addresses
// and private partner replies. Synthetic key values only.
const key='synthetic-mailgun-webhook-signing-key',now=()=>Math.floor(Date.now()/1000)
const path='/api/integrations/email/mailgun/inbound'
const sign=(timestamp,token,secret=key)=>createHmac('sha256',secret).update(timestamp+token).digest('hex')
const pairs=(entries,id)=>JSON.stringify([...(id?[['Message-Id',`<${id}>`]]:[]),...entries])

export async function mailgunInboundJourney(){
 const m=await mailApp({bindings:{MAILGUN_WEBHOOK_SIGNING_KEY:key},inbound:'support@reply.support.example.com',outbox:'help@support.example.com'}),env={get DB(){return m.DB}}
 try{
  await env.DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('q','Second Project','q-w','https://example.com',1)").run()
  await env.DB.prepare("INSERT INTO email_settings VALUES('q','Support','help@support.example.com','second@reply.support.example.com',1,1)").run()
  // The form as Mailgun forwards it, signed; `prepare` keeps the exact bytes so a replay is byte-identical.
  const prepare=async({id,recipient='support@reply.support.example.com',from='Customer <customer@example.com>',sender='customer@example.com',subject='Question',text='Hello',headers=[],spf='Pass',files=[],timestamp=String(now()),token=randomBytes(25).toString('hex'),signature,secret=key,omit=[]})=>{
   const fields={recipient,sender,from,subject,'body-plain':text,'message-headers':pairs([['From',from],['To',recipient],['Subject',subject],...(spf?[['X-Mailgun-Spf',spf]]:[]),...headers],id),'attachment-count':String(files.length),timestamp,token,signature:signature??sign(timestamp,token,secret)}
   for(const name of omit)delete fields[name]
   const encoded=files.length?(()=>{const form=new FormData();for(const [name,value] of Object.entries(fields))form.set(name,value);files.forEach((file,index)=>form.set(`attachment-${index+1}`,new File([new TextEncoder().encode(file.body)],file.filename,{type:file.type})));return new Request('https://mailgun.example',{method:'POST',body:form})})():new Request('https://mailgun.example',{method:'POST',body:new URLSearchParams(fields)})
   return {type:encoded.headers.get('Content-Type'),bytes:await encoded.arrayBuffer()}
  }
  const submit=prepared=>m.app.request(path,{method:'POST',raw:true,headers:{'Content-Type':prepared.type},body:prepared.bytes})
  const post=async options=>submit(await prepare(options))
  const counts=async()=>Promise.all(['messages','inbound_emails','suspended_emails','media','contacts','conversations','mailgun_inbound_tokens'].map(table=>m.count(`SELECT count(*) n FROM ${table}`)))
  const nothingWritten=async(label,work)=>{const before=await counts(),response=await work();assert.equal(response.status,403,label);assert.deepEqual(await counts(),before,label+' wrote nothing');assert.ok(!(await response.text()).includes(key));return response}

  // A signed form without attachments is admitted into the workspace that receives the address, with 200.
  const first=await prepare({id:'mg-1@example.com',text:'My order is late.'}),firstResponse=await submit(first)
  assert.equal(firstResponse.status,200,await firstResponse.clone().text())
  const firstBody=await firstResponse.json()
  assert.equal(firstBody.state,'delivered')
  assert.equal(await m.count("SELECT count(*) n FROM conversations WHERE id='"+firstBody.conversationId+"' AND project_id='p'"),1)
  assert.equal(await m.count('SELECT count(*) n FROM messages'),1)
  // Own Mailgun receives through the same signed public door. Dormant signing
  // credentials cannot admit a forward while installation mail is explicitly off.
  await m.app.configure({MAIL_MODE:'own',EMAIL_PROVIDER:'mailgun',MAIL_PROVIDER:'mailgun',MAILGUN_DOMAIN:'mg.support.example',MAILGUN_SENDING_KEY:'synthetic-mailgun-sending-key'})
  await nothingWritten('own provider unsigned',()=>post({id:'mg-own-unsigned@example.com',omit:['signature']}))
  const own=await post({id:'mg-own-signed@example.com',text:'An own-provider signed request.'})
  assert.equal(own.status,200);assert.equal((await own.json()).state,'delivered')
  for(const mode of ['none','disabled','off','mail-mode']){
   await m.app.configure({MAIL_MODE:mode==='mail-mode'?'off':undefined,MAIL_PROVIDER:mode==='mail-mode'?'rer':mode})
   await nothingWritten('mail '+mode+', with dormant signing key',()=>post({id:'mg-off-'+mode+'@example.com'}))
  }
  await m.app.configure({MAIL_MODE:undefined,MAIL_PROVIDER:undefined,EMAIL_PROVIDER:'resend'})
  // Replaying the accepted bytes is refused and frees nothing: the next replay is refused too, with nothing written.
  await nothingWritten('replay',()=>submit(first));await nothingWritten('second replay',()=>submit(first))
  // The same Message-ID under a fresh signature is mail already received: 200, no second message.
  assert.equal((await post({id:'mg-1@example.com',text:'My order is late.'})).status,200)
  assert.equal(await m.count('SELECT count(*) n FROM messages'),2)
  // A reply that names the first mail threads into its conversation, whatever its subject.
  const threaded=await (await post({id:'mg-2@example.com',subject:'Totally different words',text:'Any news?',headers:[['In-Reply-To','<mg-1@example.com>'],['References','<mg-1@example.com>']]})).json()
  assert.equal(threaded.conversationId,firstBody.conversationId)
  // The recipient picks the workspace, and an attachment arrives as multipart/form-data with its bytes intact.
  const second=await post({id:'mg-3@example.com',recipient:'second@reply.support.example.com',text:'Please review the attached note.',files:[{filename:'note.txt',type:'text/plain',body:'attachment bytes'}]})
  assert.equal(second.status,200,await second.clone().text())
  const secondBody=await second.json()
  assert.equal((await env.DB.prepare('SELECT project_id FROM conversations WHERE id=?').bind(secondBody.conversationId).first()).project_id,'q')
  const media=await env.DB.prepare('SELECT * FROM media').first()
  assert.equal(media.filename,'note.txt')
  assert.equal(new TextDecoder().decode(await (await (await m.app.files).get(media.object_key)).arrayBuffer()),'attachment bytes')
  // List mail is admitted and classified automatic from message-headers alone.
  const list=await (await post({id:'mg-list@example.com',from:'News <news@example.com>',sender:'bounces@news.example.com',subject:'Weekly news',headers:[['List-Id','Product news <news.example.com>'],['DKIM-Signature','v=1; d=example.com; s=k1'],['X-Mailgun-Dkim-Check-Result','Pass']],spf:'Neutral'})).json()
  assert.equal(list.automatic,true)
  // Mail that fails the sender check is held in Suspended, with 200 so Mailgun stops retrying, and makes no ticket.
  const before=await counts()
  const held=await post({id:'mg-forged@example.com',from:'Boss <boss@victim.example>',sender:'bounce@attacker.example',spf:'Fail',text:'Pay this invoice'})
  assert.equal(held.status,200);assert.equal((await held.json()).state,'suspended')
  const after=await counts()
  assert.deepEqual([after[0],after[2]],[before[0],before[2]+1])
  // An address no workspace receives is not answered 200, and its token is freed so Mailgun's retry of the same request is not mistaken for a replay.
  const stray=await prepare({id:'mg-stray@example.com',recipient:'nobody@reply.support.example.com'}),tokens=await m.count('SELECT count(*) n FROM mailgun_inbound_tokens')
  assert.equal((await submit(stray)).status,404);assert.equal((await submit(stray)).status,404)
  assert.equal(await m.count('SELECT count(*) n FROM mailgun_inbound_tokens'),tokens)

  // A customer's reply to the reply address of their conversation joins it with no thread headers, and fresh mail does not.
  await env.DB.batch([
   env.DB.prepare("INSERT INTO contacts(id,project_id,email,metadata_json,created_at) VALUES('visitor','p','rosa@acme.test','{\"email_unproven\":1}',1)"),
   env.DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('chat','p','visitor',1,'chat-hello',1,1)"),
   env.DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('chat-hello','p','chat','hello','visitor','contact','My parcel arrived damaged',1,1)"),
  ])
  const rosaAddress=await m.replyAddress('chat','rosa@acme.test')
  const rosa=await (await post({id:'mg-rosa@example.com',recipient:rosaAddress,from:'Rosa <rosa@acme.test>',sender:'rosa@acme.test',text:'Photo attached, the corner is crushed.'})).json()
  assert.deepEqual([rosa.conversationId,rosa.actor.contactId],['chat','visitor'])
  const fresh=await (await post({id:'mg-rosa-fresh@example.com',from:'Rosa <rosa@acme.test>',sender:'rosa@acme.test'})).json()
  assert.notEqual(fresh.conversationId,'chat')

  // A partner's reply to a partner-forward address stays private on the partner thread; nobody else's mail creates anything.
  const ticket=`/api/dashboard/projects/p/conversations/${firstBody.conversationId}`,admitted=await m.admitted('mg-1@example.com')
  const forward={recipient:'partner@example.net',subject:'Investigate the delay',note:'Please check the carrier.',message_ids:[admitted.id],idempotencyKey:'mailgun-partner',expected_version:(await m.app.ok(ticket+'/ticket',{headers:m.operator})).data.ticket_version}
  await m.app.ok(ticket+'/partner-forwards',{headers:m.operator,body:forward})
  const partnerAddress=replyTo(m.mail.sent.find(entry=>JSON.stringify(entry.body).includes('partner@example.net')).body)
  const intruder=await nothingWritten('another sender',()=>post({id:'mg-intruder@example.com',recipient:partnerAddress,from:'Attacker <attacker@example.net>',sender:'attacker@example.net',text:'Private partner analysis'}))
  assert.ok(intruder)
  const partnerCounts=async()=>Promise.all([m.count('SELECT count(*) n FROM partner_replies'),m.count('SELECT count(*) n FROM messages'),m.count('SELECT count(*) n FROM conversations')])
  const partnerBefore=await partnerCounts(),reply=await post({id:'mg-partner@example.com',recipient:partnerAddress,from:'Partner <partner@example.net>',sender:'partner@example.net',text:'Private partner analysis'})
  assert.equal(reply.status,200,await reply.clone().text());assert.equal((await reply.json()).private,true)
  assert.deepEqual(await partnerCounts(),[partnerBefore[0]+1,partnerBefore[1],partnerBefore[2]])
  assert.ok(!JSON.stringify(await m.app.ok(`/api/conversations/${firstBody.conversationId}/messages`,{headers:m.operator})).includes('Private partner analysis'))

  // Refusals write nothing: no signature, wrong key, stale, future, malformed, and a short token.
  const stamp=seconds=>String(now()+seconds)
  await nothingWritten('unsigned',()=>post({id:'mg-bad-1@example.com',omit:['signature']}))
  await nothingWritten('no token',()=>post({id:'mg-bad-2@example.com',omit:['token']}))
  await nothingWritten('wrong key',()=>post({id:'mg-bad-3@example.com',secret:'synthetic-other-signing-key'}))
  await nothingWritten('sending key is not the signing key',()=>post({id:'mg-bad-4@example.com',secret:'synthetic-mailgun-sending-key'}))
  await nothingWritten('malformed signature',()=>post({id:'mg-bad-5@example.com',signature:'not-hex'}))
  await nothingWritten('truncated signature',()=>post({id:'mg-bad-6@example.com',signature:sign('1','a').slice(0,63)}))
  await nothingWritten('stale',()=>post({id:'mg-bad-7@example.com',timestamp:stamp(-10*3600)}))
  await nothingWritten('future',()=>post({id:'mg-bad-8@example.com',timestamp:stamp(10*60)}))
  await nothingWritten('short token',()=>post({id:'mg-bad-9@example.com',token:'abc'}))
  // Mailgun retries for 8 hours and may keep its first timestamp, so an old but unexpired forward is accepted once.
  assert.equal((await post({id:'mg-retry@example.com',timestamp:stamp(-8*3600)})).status,200)

  // With no signing key every forward is refused, even one signed with the empty string.
  for(const value of ['',undefined]){
   await m.app.configure({MAILGUN_WEBHOOK_SIGNING_KEY:value})
   await nothingWritten('key unset',()=>post({id:'mg-unset@example.com',secret:''}))
   await nothingWritten('key unset, signed with the old key',()=>post({id:'mg-unset@example.com'}))
  }
  // The key appears in no stored row.
  for(const table of ['inbound_emails','messages','suspended_emails'])assert.ok(!JSON.stringify((await m.DB.prepare(`SELECT * FROM ${table}`).all()).results).includes(key))
 }finally{await m.close()}
}
