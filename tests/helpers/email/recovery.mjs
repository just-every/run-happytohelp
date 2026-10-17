import assert from 'node:assert/strict'
import {mailApp} from './app.mjs'
import {sha} from '../../journeys/kit/app.mjs'

const withAttachment=(id,text,bytes)=>`From: Customer <customer@example.com>\r\nTo: inbound@example.com\r\nMessage-ID: <${id}>\r\nAuthentication-Results: mx.cloudflare.net; dkim=pass header.d=example.com\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--b\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="note.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n${btoa(bytes)}\r\n--b--`
// A delivery's outcome: the Worker's thrown error or rejection, or delivered.
const outcome=async promise=>{try{return (await promise)||'delivered'}catch(error){return error.message}}

// Inbound mail survives real D1 failures before and after admission: staged attachments are stable, a changed
// message under the same identity is refused, retries admit exactly once, and only an owner releases an interrupted receipt.
export async function recoveryJourney(){
 const m=await mailApp(),{DB,app,gateway,email}=m
 const trigger=(name,table,timing,when='1=1',message=name)=>DB.prepare(`CREATE TRIGGER ${name} ${timing} ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT,'${message}'); END`).run(),drop=name=>DB.prepare(`DROP TRIGGER ${name}`).run()
 const count=async table=>(await DB.prepare(`SELECT count(*) n FROM ${table}`).first()).n
 try{
  const deliver=(text='Durable email',bytes='attachment')=>email(withAttachment('recover',text,bytes),{from:'customer@example.com',to:'inbound@example.com'})
  await trigger('fail_email_admission','messages','BEFORE INSERT','1=1','temporary admission failure')
  assert.match(await outcome(deliver()),/temporary admission failure/)
  const failed=await m.claim('recover');assert.equal(failed.state,'failed');assert.ok(failed.conversation_id);assert.equal(await count('messages'),0)
  await drop('fail_email_admission')
  // Another copy under the same Message-ID with different text or attachment bytes is never admitted (nor bounced).
  for(const changed of [deliver('Changed intent'),deliver('Durable email','changed')]){assert.equal(await outcome(changed),'delivered');assert.equal(await count('messages'),0)}
  assert.equal((await m.claim('recover')).intent_hash,failed.intent_hash)
  assert.equal(await outcome(deliver()),'delivered');const recovered=await m.claim('recover');assert.equal(recovered.state,'delivered');assert.equal(recovered.conversation_id,failed.conversation_id)
  assert.deepEqual([await count('conversations'),await count('media'),await count('messages'),(await (await app.files).list()).objects.length],[1,1,1,1],'the staged attachment is stored once')
  assert.equal(await outcome(deliver()),'delivered');assert.equal(await count('messages'),1)
  // A completion failure after the atomic message/outbox admission: the retry only reconciles.
  const conversationId=recovered.conversation_id,after={messageId:'after-admission',to:'inbound@example.com',from:'customer@example.com',text:'Durable email',conversationId}
  await trigger('fail_email_completion','inbound_emails','BEFORE UPDATE OF state',"NEW.id='after-admission' AND NEW.state='delivered'")
  assert.equal((await gateway(after)).status,500);await drop('fail_email_completion')
  const reconciled=await (await gateway(after)).json();assert.equal(reconciled.state,'delivered');assert.equal(reconciled.duplicate,true);assert.equal(reconciled.message,undefined)
  assert.equal((await DB.prepare('SELECT revision FROM conversations').first()).revision,2);assert.equal(await count('conversation_outbox'),2)
  // Receipts without a conversation checkpoint, and a process lost in processing, also reconcile.
  await DB.prepare("UPDATE inbound_emails SET state='failed',conversation_id=NULL,claim_token=NULL WHERE id='after-admission'").run();assert.equal((await (await gateway(after)).json()).conversationId,conversationId)
  await DB.prepare("UPDATE inbound_emails SET state='processing' WHERE id='after-admission'").run();assert.equal((await (await gateway(after)).json()).state,'delivered')
  // Receipts from before project-scoped local ids replay without a second message.
  const legacy={messageId:'legacy-existing',to:'inbound@example.com',from:'legacy@example.com',text:'Already committed'},legacyLocalId=`email:${sha(legacy.messageId)}`
  await DB.batch([
   DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('legacy-contact','p','legacy@example.com',1)"),
   DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('legacy-conversation','p','legacy-contact',1,'legacy-message',1,1)"),
   DB.prepare("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,error,created_at,claim_token) VALUES('legacy-existing','p','legacy-conversation',?,'processing',NULL,1,NULL)").bind(sha(JSON.stringify({to:'inbound@example.com',from:'legacy@example.com',content:'Already committed',conversationId:null,attachments:[]}))),
   DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,intent_hash) VALUES('legacy-message','p','legacy-conversation',?,'legacy-contact','contact','Already committed',1,1,NULL)").bind(legacyLocalId),
  ])
  const legacyReplay=await (await gateway(legacy)).json();assert.equal(legacyReplay.state,'delivered');assert.equal(legacyReplay.duplicate,true);assert.equal((await DB.prepare("SELECT count(*) n FROM messages WHERE conversation_id='legacy-conversation'").first()).n,1)
  // An interrupted receipt is released only by an owner who confirms the observed receipt, exactly once.
  const interrupted={messageId:'interrupted',to:'inbound@example.com',from:'customer@example.com',text:'Durable email'}
  await trigger('fail_interrupted','messages','BEFORE INSERT');assert.equal((await gateway(interrupted)).status,500);await drop('fail_interrupted')
  await DB.prepare("UPDATE inbound_emails SET state='processing' WHERE id='interrupted'").run()
  const receipt=await m.claim('interrupted'),observed={projectId:'p',messageId:receipt.id,intentHash:receipt.intent_hash,createdAt:receipt.created_at,conversationId:receipt.conversation_id,claimToken:receipt.claim_token,priorExecutionEnded:true}
  await DB.batch([DB.prepare("INSERT INTO users VALUES('owner','owner@example.com','Owner',1)"),DB.prepare("INSERT INTO memberships VALUES('p','owner','owner')"),DB.prepare("INSERT INTO sessions VALUES(?,'owner','p','owner',NULL,?,NULL)").bind(sha('owner-token'),Date.now()+60000)])
  const route='/api/management/projects/p/inbound-emails/interrupted',owner={Authorization:'Bearer owner-token'}
  const release=(body,headers=owner)=>app.request(route+'/reconcile',{method:'POST',headers,body})
  assert.equal((await app.request(route)).status,401);assert.equal((await app.request(route,{headers:owner})).status,200);assert.equal((await app.request('/api/management/projects/other/inbound-emails/interrupted',{headers:owner})).status,403)
  for(const body of [{...observed,priorExecutionEnded:false},{...observed,conversationId:null}])assert.ok((await release(body)).status>=400,JSON.stringify(body))
  assert.equal((await app.request('/api/management/projects/other/inbound-emails/interrupted/reconcile',{method:'POST',headers:owner,body:observed})).status,403,'never outside the owner\'s workspace')
  await DB.batch([DB.prepare("UPDATE memberships SET role='operator' WHERE user_id='owner'"),DB.prepare("UPDATE sessions SET role='operator' WHERE actor_id='owner'")]);assert.equal((await release(observed)).status,403)
  await DB.batch([DB.prepare("UPDATE memberships SET role='owner' WHERE user_id='owner'"),DB.prepare("UPDATE sessions SET role='owner' WHERE actor_id='owner'")])
  assert.equal((await Promise.all([release(observed),release(observed)])).filter(response=>response.status===200).length,1,'one release wins')
  await trigger('interrupt_again','messages','BEFORE INSERT');assert.equal((await gateway(interrupted)).status,500);await drop('interrupt_again')
  await DB.prepare("UPDATE inbound_emails SET state='processing' WHERE id='interrupted'").run();assert.ok((await release(observed)).status>=400,'a newer claim changed the receipt')
  const newer=(await m.claim('interrupted')).claim_token;assert.notEqual(newer,observed.claimToken)
  assert.equal((await release({...observed,claimToken:newer})).status,200);assert.equal((await (await gateway(interrupted)).json()).state,'delivered')
  await DB.prepare("UPDATE inbound_emails SET state='processing' WHERE id='interrupted'").run();assert.ok((await release(observed)).status>=400,'already admitted');assert.equal((await (await gateway(interrupted)).json()).state,'delivered')
  // The same message to another workspace's mailbox is that workspace's own conversation.
  await DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('other','Other','other-w','https://example.com',1)").run();await DB.prepare("UPDATE email_settings SET project_id='other'").run()
  const cross=await (await gateway({messageId:'recover',to:'inbound@example.com',from:'customer@example.com',text:'Durable email'})).json();assert.equal(cross.state,'delivered');assert.notEqual(cross.conversationId,conversationId)
 }finally{await m.close()}
}

// Classification survives recovery: a lost completion write, a failed claim and a receipt from before
// classification all keep automatic mail quiet on replay, while customer mail still notifies.
export async function classificationRecoveryJourney(){
 const m=await mailApp(),{DB,app,gateway,mail,idle}=m
 const away={'Auto-Submitted':'auto-replied'},message=messageId=>DB.prepare("SELECT m.* FROM messages m JOIN inbound_emails i ON i.local_id=m.local_id AND i.conversation_id=m.conversation_id WHERE i.id=?").bind(messageId).first()
 const origin=async row=>(await app.call(`/api/conversations/${row.conversation_id}/messages`,{headers:m.operator,status:200})).data.messages.find(entry=>entry.id===row.id).origin
 try{
  await DB.batch([DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('customer','p','customer@example.com',1)"),DB.prepare("INSERT INTO conversations(id,project_id,contact_id,assigned_to,created_at,updated_at) VALUES('assigned','p','customer','op',1,1)")])
  // Admission committed, completion write lost: replay still finds the classification.
  const lost={messageId:'lost-away',to:'inbound+assigned@example.com',from:'customer@example.com',text:'Away until Monday',subject:'Automatic reply: my order',headers:away}
  await DB.prepare("CREATE TRIGGER fail_away_completion BEFORE UPDATE OF state ON inbound_emails WHEN NEW.state='delivered' BEGIN SELECT RAISE(ABORT,'completion lost'); END").run()
  assert.equal((await gateway(lost)).status,500);assert.equal((await gateway({messageId:'lost-customer',to:'inbound+assigned@example.com',from:'customer@example.com',text:'Any news?',subject:'Re: my order'})).status,500)
  await DB.prepare('DROP TRIGGER fail_away_completion').run()
  assert.equal((await m.claim('lost-away')).message_id,null);assert.equal((await m.claim('lost-away')).automatic,1)
  const lostMessage=await message('lost-away');assert.equal((await origin(lostMessage)).automatic,true)
  await m.replay(lostMessage);assert.equal(mail.sent.length,0)
  // The same crash for customer mail still notifies the assigned operator once, with loop-suppression headers.
  await m.replay(await message('lost-customer'));await idle()
  assert.equal(mail.sent.length,1);assert.deepEqual(mail.sent[0].body.to,['op@example.com']);assert.deepEqual(mail.sent[0].body.headers,{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'})
  // A redelivery through a relay that stripped the headers reconciles and keeps the first answer.
  const reconciled=await (await gateway({...lost,subject:'Re: my order',headers:{}})).json();assert.equal(reconciled.duplicate,true);assert.equal(reconciled.automatic,true)
  assert.equal((await m.claim('lost-away')).message_id,lostMessage.id)
  // Failure before admission: the retried claim keeps the first classification.
  const retried={messageId:'retried-away',to:'inbound+assigned@example.com',from:'customer@example.com',text:'Out of the office',subject:'Automatic reply: my order',headers:away}
  await DB.prepare("CREATE TRIGGER fail_admission BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'admission failed'); END").run()
  assert.equal((await gateway(retried)).status,500);await DB.prepare('DROP TRIGGER fail_admission').run()
  assert.equal((await m.claim('retried-away')).state,'failed');assert.equal((await m.claim('retried-away')).automatic,1)
  const retry=await (await gateway({...retried,subject:'Re: my order',headers:{}})).json();assert.equal(retry.state,'delivered');assert.equal(retry.duplicate,false);assert.equal(retry.automatic,true)
  assert.deepEqual(JSON.parse((await m.claim('retried-away')).evidence_json).reasons,['auto-submitted','subject'])
  await m.replay(retry.message);await idle();assert.equal(mail.sent.length,1)
  // A failed receipt from before classification is classified when it is claimed again.
  await DB.prepare("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,error,created_at,claim_token) VALUES('legacy-away','p',NULL,?,'failed','interrupted',1,NULL)").bind(sha(JSON.stringify({to:'inbound@example.com',from:'customer@example.com',content:'I am away',conversationId:null,attachments:[]}))).run()
  const legacy=await (await gateway({messageId:'legacy-away',to:'inbound@example.com',from:'customer@example.com',text:'I am away',subject:'Automatic reply: my order',headers:away})).json()
  assert.equal(legacy.duplicate,false);assert.equal(legacy.automatic,true);assert.equal((await m.claim('legacy-away')).automatic,1);assert.equal((await origin(legacy.message)).automatic,true)
 }finally{await m.close()}
}
