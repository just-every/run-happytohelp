import assert from 'node:assert/strict'
import {mailApp,message} from './app.mjs'
import {sha} from '../../journeys/kit/app.mjs'
import {cronBacklogFlow} from '../workflows/schedules.mjs'

const multipart=({id,to,text})=>`From: Customer <customer@example.com>\r\nTo: ${to}\r\nMessage-ID: <${id}>\r\nAuthentication-Results: mx.cloudflare.net; dkim=pass header.d=example.com\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--b\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="example.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nYXR0YWNobWVudA==\r\n--b--`

// Mail through the Worker's email entry: attachments stored, the reply address continues the thread,
// duplicates coalesce, HTML is sanitised, and a delivery that crashed mid-admission is admitted once.
export async function workerJourney(){
 const m=await mailApp(),{DB,email,replyAddress}=m
 const deliver=(id,to,text,attachment=false)=>email(attachment?multipart({id,to,text}):message({id,to,text,type:text.startsWith('<')?'text/html':'text/plain'}),{from:'customer@example.com',to})
 const latest=()=>DB.prepare('SELECT content FROM messages ORDER BY revision DESC LIMIT 1').first()
 try{
  assert.equal(await deliver('first@example.com','inbound@example.com','First email',true),undefined)
  const c=await DB.prepare('SELECT * FROM conversations').first();assert.equal(c.revision,1);assert.equal((await DB.prepare('SELECT * FROM media').first()).filename,'example.txt')
  const reply=await replyAddress(c.id,'customer@example.com');assert.match(reply,/^inbound\+r\./)
  await deliver('second@example.com',reply,'Reply email');assert.equal((await DB.prepare('SELECT count(*) n FROM conversations').first()).n,1);assert.equal((await DB.prepare('SELECT revision FROM conversations').first()).revision,2)
  await deliver('second@example.com',reply,'Reply email');assert.equal((await DB.prepare('SELECT revision FROM conversations').first()).revision,2,'a duplicate delivery coalesces')
  await deliver('html@example.com',reply,'<p>HTML <b>reply</b></p><script>secret()</script>');assert.match((await latest()).content,/HTML reply/);assert.ok(!(await latest()).content.includes('secret()'))
  await deliver('only-file@example.com',reply,'',true);assert.equal((await latest()).content,'')
  assert.ok((await DB.prepare('SELECT m.id FROM media a JOIN messages m ON m.id=a.message_id ORDER BY m.revision DESC LIMIT 1').first()).id)
  // A retry after an attempt that crashed mid-admission is never dropped: while the claim may be live the
  // sender is told to retry; a stale claim is reclaimed and the mail admitted exactly once.
  await DB.prepare("CREATE TRIGGER crash_admission BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'worker crashed'); END").run()
  const crashed=()=>email(message({id:'crashed@example.com',to:'inbound@example.com',from:'ana@customer.example'}),{from:'ana@customer.example',to:'inbound@example.com'})
  await assert.rejects(crashed(),/worker crashed/);await DB.prepare('DROP TRIGGER crash_admission').run()
  await DB.prepare("UPDATE inbound_emails SET state='processing' WHERE id='<crashed@example.com>'").run();await assert.rejects(crashed(),/already processing/)
  await DB.prepare("UPDATE inbound_emails SET created_at=created_at-180000 WHERE id='<crashed@example.com>'").run()
  assert.equal(await crashed(),undefined);assert.equal(await crashed(),undefined)
  assert.equal((await DB.prepare('SELECT count(*) n FROM messages WHERE local_id=?').bind((await m.claim('crashed@example.com')).local_id).first()).n,1)
  // A reply to a Closed ticket is never refused: it opens a new ticket for the same customer.
  await DB.prepare("UPDATE conversations SET status_id='closed',status_category='closed' WHERE id=?").bind(c.id).run()
  assert.equal(await deliver('after-close@example.com',reply,'Following up after you closed this'),undefined)
  const followUp=await DB.prepare("SELECT c.contact_id,i.state FROM inbound_emails i JOIN conversations c ON c.id=i.conversation_id JOIN messages m ON m.id=i.message_id WHERE i.id='<after-close@example.com>' AND m.content='Following up after you closed this' AND c.id<>?").bind(c.id).first()
  assert.deepEqual(followUp,{contact_id:c.contact_id,state:'delivered'})
  // Each reply to the Closed ticket opens its own ticket, never joining another open ticket of the customer's (here, that follow-up).
  assert.equal(await deliver('after-close-again@example.com',reply,'One more thing about the closed order'),undefined)
  const again=(await m.claim('after-close-again@example.com')).conversation_id
  assert.ok(![c.id,(await m.claim('after-close@example.com')).conversation_id].includes(again));assert.equal((await DB.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(again).first()).contact_id,c.contact_id)
 }finally{await m.close()}
}

// Seed shared by the automatic-mail, notification and people journeys: an AI-answered widget thread
// and an operator-owned thread for one mail customer.
async function seeded(){
 const m=await mailApp({bindings:{OPENAI_API_KEY:'fixture-openai'}}),{DB}=m
 await DB.batch([
  DB.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('ai','p','Assistant','Support','Answer customers.','gpt-5-mini',1)"),
  DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('customer','p','customer@example.com',1)"),
  DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('widget','p','customer',1,1)"),
  DB.prepare("INSERT INTO conversation_ai VALUES('widget','ai')"),
  DB.prepare("INSERT INTO conversations(id,project_id,contact_id,assigned_to,created_at,updated_at) VALUES('assigned','p','customer','op',1,1)"),
  // Each thread already holds the customer's earlier message, so a transcript of it can be mailed.
  ...['widget','assigned'].flatMap(id=>[DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,'p',?,'earlier','customer','contact','An earlier question',1,1)").bind('earlier-'+id,id),DB.prepare("UPDATE conversations SET revision=1,last_message_id=? WHERE id=?").bind('earlier-'+id,id)]),
 ])
 const addresses={widget:await m.replyAddress('widget','customer@example.com'),assigned:await m.replyAddress('assigned','customer@example.com')}
 const deliver=async({id,to,envelopeTo,from='customer@example.com',headerFrom='Customer <customer@example.com>',...rest})=>m.email(message({id,to,from:headerFrom,...rest}),{from,to:envelopeTo||to})
 return {...m,addresses,deliver,deliveries:await m.count('SELECT count(*) n FROM email_deliveries')}
}

// Automatic mail (out-of-office, list, bounce, null sender) through the Worker and the JSON gateway is admitted
// and labelled with its reasons, but never answered by the assistant, notified or emailed onward.
export async function automaticJourney(){
 const m=await seeded(),{DB,mail,deliver,addresses,claim,admitted,replay,idle,count,gateway}=m,jobs=new Map()
 const pull=async()=>{for(const job of await m.app.takeJobs())jobs.set(job.id,job);return [...jobs.values()]}
 try{
  assert.equal(await deliver({id:'ooo@example.com',to:addresses.widget,subject:'Automatic reply: Question about my order',headers:'Auto-Submitted: auto-replied\r\nX-Auto-Response-Suppress: All\r\n',text:'I am out of the office until Monday.'}),undefined)
  const ooo=await claim('ooo@example.com'),oooMessage=await admitted('ooo@example.com')
  assert.equal(ooo.state,'delivered');assert.equal(ooo.automatic,1);assert.equal(oooMessage.conversation_id,'widget')
  assert.deepEqual(JSON.parse(ooo.evidence_json).reasons,['auto-submitted','x-auto-response-suppress','subject']);assert.equal(JSON.parse(ooo.evidence_json).headers['auto-submitted'],'auto-replied')
  await replay(oooMessage);assert.equal(await count('SELECT count(*) n FROM ai_generations'),0);assert.deepEqual(await pull(),[])
  assert.equal(await count('SELECT count(*) n FROM email_deliveries'),m.deliveries);assert.equal(mail.sent.length,0)
  // List mail and an autoresponder subject to the operator-owned thread: no notification.
  await deliver({id:'list@example.com',to:addresses.assigned,subject:'Weekly product news',headers:'List-Id: <news.example.com>\r\nPrecedence: bulk\r\n'})
  await deliver({id:'away@example.com',to:addresses.assigned,subject:'Out of Office: Re: Question about my order'})
  for(const id of ['list@example.com','away@example.com']){assert.equal((await claim(id)).automatic,1,id);await replay(await admitted(id))}
  assert.deepEqual(JSON.parse((await claim('list@example.com')).evidence_json).reasons,['precedence','list-id']);assert.deepEqual(JSON.parse((await claim('away@example.com')).evidence_json).reasons,['subject'])
  // A mailer-daemon bounce opens its own quiet thread; a null envelope sender is admitted under its unverified From.
  await deliver({id:'bounce@example.com',to:'inbound@example.com',from:'mailer-daemon@mx.example.net',headerFrom:'Mail Delivery System <MAILER-DAEMON@mx.example.net>',subject:'Undeliverable: Reply to your support conversation'})
  assert.deepEqual(JSON.parse((await claim('bounce@example.com')).evidence_json).reasons,['mailer-daemon','subject']);await replay(await admitted('bounce@example.com'))
  // Handing machine mail to the assistant still earns no reply: it stays with people.
  const bounceThread=(await admitted('bounce@example.com')).conversation_id
  assert.equal((await m.app.request(`/api/dashboard/projects/p/conversations/${bounceThread}/actions`,{method:'POST',headers:m.operator,body:{action:'assignAi',data:{ai_id:'ai'}}})).status,200)
  assert.equal(await count(`SELECT count(*) n FROM ai_generations WHERE conversation_id='${bounceThread}'`),0)
  assert.equal(await deliver({id:'null@example.com',to:'inbound@example.com',from:'<>',headerFrom:'victim@example.org',subject:'Delivery Status Notification (Failure)'}),undefined)
  assert.deepEqual(JSON.parse((await claim('null@example.com')).evidence_json).reasons,['subject','null-sender']);await replay(await admitted('null@example.com'))
  assert.equal(await count('SELECT count(*) n FROM ai_generations'),0);await idle();assert.equal(mail.sent.length,0)
  // Ordinary customer mail still earns an assistant reply and an operator notification with loop-suppression headers.
  await deliver({id:'customer-widget@example.com',to:addresses.widget,subject:'Re: Question about my order',text:'Is it shipping today?'})
  const customerMessage=await admitted('customer-widget@example.com');assert.equal((await claim('customer-widget@example.com')).automatic,0)
  assert.equal((await DB.prepare('SELECT state FROM ai_generations WHERE id=?').bind(`reply:${customerMessage.id}`).first())?.state,'queued')
  assert.deepEqual(await pull(),[{type:'ai.generate',id:`reply:${customerMessage.id}`,projectId:'p'}])
  await deliver({id:'customer-assigned@example.com',to:addresses.assigned,subject:'Re: Question about my order',text:'Any update?'});await replay(await admitted('customer-assigned@example.com'))
  await idle();const alerts=mail.sent.filter(entry=>entry.body.to?.includes('op@example.com'));assert.equal(alerts.length,1)
  assert.deepEqual(alerts[0].body.headers,{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'})
  // The JSON gateway: supplied headers, subject and an empty envelope are classification evidence.
  const away=await gateway({messageId:'gateway-away',to:addresses.assigned,from:'customer@example.com',text:'Away until Monday',subject:'Automatic reply: Any update?',headers:{'Auto-Submitted':'auto-replied'}})
  assert.equal(away.status,201);assert.equal((await away.json()).automatic,true)
  const bounce=await gateway({messageId:'gateway-bounce',to:addresses.assigned,from:'customer@example.com',envelopeFrom:'',text:'Delivery failed'})
  assert.equal((await bounce.json()).automatic,true);assert.deepEqual(JSON.parse((await claim('gateway-bounce')).evidence_json).reasons,['null-sender'])
  const customer=await gateway({messageId:'gateway-customer',to:addresses.assigned,from:'customer@example.com',text:'Thanks',subject:'Re: Any update?',headers:{'Auto-Submitted':'no'}});assert.equal((await customer.json()).automatic,false)
  for(const id of ['gateway-away','gateway-bounce'])await replay(await admitted(id))
  await idle();assert.equal(mail.sent.filter(entry=>entry.body.to?.includes('op@example.com')).length,2,'only the customer mail notifies')
  // Operators see why in the transcript and dashboard; `email:` local ids belong to inbound claims.
  const transcript=(await m.app.call('/api/conversations/widget/messages',{headers:m.operator,status:200})).data
  assert.deepEqual(transcript.messages.find(row=>row.id===oooMessage.id).origin,{channel:'email',automatic:true,reasons:['auto-submitted','x-auto-response-suppress','subject']})
  assert.deepEqual(transcript.messages.find(row=>row.id===customerMessage.id).origin,{channel:'email',automatic:false,reasons:[]})
  const bucket=(await m.app.call('/api/dashboard/projects/p/conversations/widget/buckets/widget',{headers:m.operator,status:200})).data,rows=(bucket.data??bucket).messages
  assert.equal(rows.find(row=>row.id===oooMessage.id).origin.automatic,true);assert.equal(rows.find(row=>row.id===customerMessage.id).origin.automatic,false)
  const revision=(await DB.prepare("SELECT revision FROM conversations WHERE id='widget'").first()).revision
  assert.equal((await m.post('widget/messages',{localId:'email:forged',content:'Forged',expectedRevision:revision})).status,400);assert.equal((await DB.prepare("SELECT revision FROM conversations WHERE id='widget'").first()).revision,revision)
  assert.equal((await m.post('widget/messages',{localId:'operator-reply-1',content:'We are on it.',expectedRevision:revision})).status,200)
 }finally{await m.close()}
}

// Operator mail: an unread digest after inactivity that coalesces and honours read frontiers and opt-in scope,
// a lost provider response recorded once and never resent, and assignment mail from the real mutation.
export async function notificationsJourney(){
 const m=await seeded(),{DB,mail,addresses,admitted,replay,idle,gateway,app}=m
 const unread=async(messageId,text)=>{await gateway({messageId,to:addresses.assigned,from:'customer@example.com',text});await replay(await admitted(messageId))}
 const toOperators=()=>mail.sent.filter(entry=>entry.body.to?.some(to=>to!=='customer@example.com'))
 try{
  await DB.prepare("INSERT INTO user_settings(user_id,is_notifiable_on_conversation_assignment) VALUES('op',0)").run()
  await unread('digest-first','First unread question');await unread('digest-second','Second unread question')
  const first=await admitted('digest-first'),second=await admitted('digest-second')
  await app.scheduled();assert.equal(toOperators().length,0,'no digest before a minute of inactivity')
  await DB.prepare("INSERT INTO conversation_reads VALUES('assigned','op',?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET revision=excluded.revision").bind(first.revision).run()
  await idle();assert.equal(toOperators().length,1);const digest=toOperators()[0].body.text
  assert.match(digest,/Second unread question/);assert.equal(digest.split('Unread customer messages:')[1].includes('First unread question'),false,'read messages are context only');assert.match(digest,/Previous context:/)
  await replay(second);await idle();assert.equal(toOperators().length,1)
  await unread('already-read','Read before email');await DB.prepare("UPDATE conversation_reads SET revision=? WHERE conversation_id='assigned' AND user_id='op'").bind((await admitted('already-read')).revision).run()
  await idle();assert.equal(toOperators().length,1)
  // Unassigned mail reaches opted-in members only, each with their own read frontier, never another workspace.
  await DB.batch([
   DB.prepare("INSERT INTO users VALUES('watcher','watcher@example.com','Watcher',1)"),DB.prepare("INSERT INTO users VALUES('quiet','quiet@example.com','Quiet',1)"),DB.prepare("INSERT INTO users VALUES('outsider','outsider@example.com','Outsider',1)"),
   DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('other','Other','other-key','https://other.example',1)"),
   DB.prepare("INSERT INTO memberships VALUES('p','watcher','operator')"),DB.prepare("INSERT INTO memberships VALUES('p','quiet','operator')"),DB.prepare("INSERT INTO memberships VALUES('other','outsider','owner')"),
   DB.prepare("INSERT INTO user_project_preferences(project_id,user_id,is_notified_on_unassigned_activity) VALUES('p','op',1),('p','watcher',1),('other','outsider',1)"),
   DB.prepare("UPDATE conversations SET assigned_to=NULL WHERE id='assigned'"),
  ])
  await unread('unassigned-burst-1','Unassigned first');await unread('unassigned-burst-2','Unassigned second')
  await DB.prepare("UPDATE conversation_reads SET revision=? WHERE conversation_id='assigned' AND user_id='op'").bind((await admitted('unassigned-burst-2')).revision).run()
  await Promise.all([app.scheduled(undefined,{after:61000}),app.scheduled(undefined,{after:61000})])
  assert.equal(toOperators().length,2,'concurrent schedules send one digest');assert.deepEqual(toOperators()[1].body.to,['watcher@example.com'])
  assert.match(toOperators()[1].body.text,/Unassigned first/);assert.match(toOperators()[1].body.text,/Unassigned second/)
  // A lost provider response is recorded as uncertain once and never sent again.
  await DB.prepare("UPDATE user_project_preferences SET is_notified_on_unassigned_activity=0 WHERE user_id='op'").run()
  await unread('uncertain-alert','A lost response');mail.mode='lost';const attempts=mail.attempts
  await idle();const uncertain=await DB.prepare("SELECT * FROM email_deliveries WHERE state='uncertain'").first();assert.equal(mail.attempts-attempts,1);assert.equal(uncertain.recipient,'watcher@example.com')
  await replay(await admitted('uncertain-alert'));await idle();assert.equal(mail.attempts-attempts,1);mail.mode='deliver'
  // The operator's assignment creates assignment-mail intent with the ownership; same-owner, self and opted-out stay quiet.
  const assign=async agent_id=>{const response=await app.request('/api/dashboard/projects/p/conversations/assigned',{method:'PUT',headers:m.operator,body:{agent_id}});assert.equal(response.status,200,await response.text());await app.scheduled()}
  const before=toOperators().length
  await assign('watcher');assert.equal(toOperators().length,before+1);assert.deepEqual(toOperators().at(-1).body.to,['watcher@example.com']);assert.ok(toOperators().at(-1).body.text.includes('https://app.example/projects/p/conversations/assigned'))
  await assign('watcher');await assign('op');assert.equal(toOperators().length,before+1)
  await DB.prepare("INSERT INTO user_settings(user_id,is_notifiable_on_conversation_assignment) VALUES('watcher',0)").run();await assign('watcher');assert.equal(toOperators().length,before+1)
  // With mail unconfigured the intent waits durably and is sent once by the schedule after mail returns.
  await app.configure({EMAIL_API_KEY:undefined});await assign('quiet');assert.equal(toOperators().length,before+1)
  await app.configure({EMAIL_API_KEY:'fixture-resend'});await app.scheduled();assert.equal(toOperators().length,before+2);assert.deepEqual(toOperators().at(-1).body.to,['quiet@example.com'])
  await app.scheduled();assert.equal(toOperators().length,before+2)
  await cronBacklogFlow(m)
 }finally{await m.close()}
}

// Who mail speaks for: CC participants of verified senders, operators by membership, preferred addresses only
// through their own reply address, Cloudflare's own verdict over forgeries, the latest open thread for a bare
// mailbox, and replies that reach only the address that wrote. Original bodies follow erasure.
export async function peopleJourney(){
 const m=await seeded(),{DB,mail,deliver,addresses,claim,admitted,gateway,replyAddress,app}=m
 const outside=async(response,id)=>{assert.equal(response.status,201);assert.equal((await claim(id)).state,'suspended');assert.equal(await admitted(id),null);assert.equal((await claim(id)).conversation_id,null)}
 const operatorReply=async(conversationId,localId,content)=>{const head=await DB.prepare('SELECT revision FROM conversations WHERE id=?').bind(conversationId).first();assert.equal((await m.post(`${conversationId}/messages`,{localId,content,expectedRevision:head.revision})).status,200);await app.scheduled()}
 const sentWith=text=>mail.sent.filter(entry=>entry.body.text?.includes(text)).map(entry=>entry.body.to)
 try{
  // A visible reply keeps its original body; CC recipients join the thread once, only within this workspace.
  const rawReply='The export now works.\n\n-- \nMaya Chen\n\nOn Fri, 16 Oct 2026 Support wrote:\n> Can you retry?'
  const cc={messageId:'people-cc',to:addresses.assigned,from:'customer@example.com',text:rawReply,cc:['finance@example.com','op@example.com','customer@example.com']}
  assert.equal((await gateway(cc)).status,201);const ccMessage=await admitted('people-cc');assert.equal(ccMessage.content,'The export now works.');assert.equal(ccMessage.content_raw,rawReply)
  const participant=await DB.prepare("SELECT ct.id FROM contacts ct JOIN conversation_participants cp ON cp.contact_id=ct.id WHERE cp.conversation_id='assigned' AND ct.project_id='p' AND ct.email='finance@example.com'").first();assert.ok(participant)
  assert.equal((await gateway(cc)).status,200);assert.equal((await gateway({...cc,cc:['outsider@example.com']})).status,409)
  const reply=await gateway({messageId:'participant-reply',to:addresses.assigned,from:'finance@example.com',text:'I can confirm the report totals.'});assert.equal(reply.status,201);assert.equal((await admitted('participant-reply')).actor_id,participant.id)
  // Somebody outside a thread who writes to its address starts their own conversation.
  await outside(await gateway({messageId:'forged-person',to:addresses.assigned,from:'unrelated@example.com',text:'Pretend to be the customer',cc:['hijack@example.com']}),'forged-person')
  assert.equal(await DB.prepare("SELECT cp.id FROM conversation_participants cp JOIN contacts ct ON ct.id=cp.contact_id WHERE cp.conversation_id='assigned' AND ct.email='hijack@example.com'").first(),null)
  await DB.prepare("DELETE FROM conversation_participants WHERE conversation_id='assigned' AND contact_id=?").bind(participant.id).run()
  await outside(await gateway({messageId:'removed-person',to:addresses.assigned,from:'finance@example.com',text:'No longer a participant'}),'removed-person')
  // The original body is operator-only.
  await DB.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,'customer','p','contact','customer',?)").bind(sha('customer-token'),Date.now()+60000).run()
  const customerView=(await app.call('/api/conversations/assigned/messages',{token:'customer-token',status:200})).data;assert.ok(customerView.messages.length>1&&customerView.messages.every(row=>!('content_raw' in row)))
  assert.equal((await app.call('/api/conversations/assigned/messages',{headers:m.operator,status:200})).data.messages.find(row=>row.id===ccMessage.id).content_raw,rawReply)
  // Operators write by membership; another sender with their reply address does not; a removed operator is a contact.
  const operatorAddress=await replyAddress('assigned','op@example.com')
  assert.equal(await deliver({id:'worker-operator@example.com',to:operatorAddress,from:'op@example.com',headerFrom:'Operator <op@example.com>',text:'Reply from the operator mail client'}),undefined)
  assert.equal((await admitted('worker-operator@example.com')).actor_id,'op')
  assert.equal(await deliver({id:'stolen-address@example.com',to:operatorAddress,from:'forged@example.com',headerFrom:'forged@example.com',text:'Forged sender with somebody else’s reply address'}),undefined)
  assert.equal((await claim('stolen-address@example.com')).state,'suspended');assert.equal(await admitted('stolen-address@example.com'),null)
  const operatorMail=await gateway({messageId:'operator-email',to:addresses.assigned,from:'op@example.com',text:'Your export is ready.\n\nOn Fri, 16 Oct 2026 Maya wrote:\n> Please help'})
  assert.equal(operatorMail.status,201);assert.deepEqual([(await admitted('operator-email')).actor_role,(await admitted('operator-email')).actor_id],['operator','op'])
  await DB.prepare("DELETE FROM memberships WHERE project_id='p' AND user_id='op'").run()
  assert.equal(await deliver({id:'revoked-worker@example.com',to:operatorAddress,from:'op@example.com',headerFrom:'Operator <op@example.com>',text:'Reply after leaving the workspace'}),undefined)
  assert.equal((await claim('revoked-worker@example.com')).state,'suspended');assert.equal(await admitted('revoked-worker@example.com'),null)
  await outside(await gateway({messageId:'revoked-operator',to:addresses.assigned,from:'op@example.com',text:'Revoked reply'}),'revoked-operator')
  await DB.prepare("INSERT INTO memberships VALUES('p','op','operator')").run()
  // A preferred notification address replies as the customer only through its own reply address.
  await DB.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.provided_email','preferred@example.com') WHERE id='customer'").run()
  await outside(await gateway({messageId:'preferred-forgery',to:addresses.assigned,from:'preferred@example.com',text:'Not canonical identity'}),'preferred-forgery')
  assert.equal(await deliver({id:'preferred-reply@example.com',to:await replyAddress('assigned','preferred@example.com'),from:'preferred@example.com',headerFrom:'preferred@example.com',text:'Replying from my preferred address'}),undefined)
  assert.deepEqual([(await admitted('preferred-reply@example.com')).conversation_id,(await admitted('preferred-reply@example.com')).actor_id],['assigned','customer'])
  // A bare mailbox follows the most recently active open thread and starts afresh after resolution.
  const bare=async id=>(await (await gateway({messageId:id,to:'inbound@example.com',from:'new-customer@example.com',text:'Question about the account'})).json()).conversationId
  const firstBare=await bare('bare-first');assert.equal(await bare('bare-second'),firstBare)
  await DB.prepare('UPDATE conversations SET resolved_at=? WHERE id=?').bind(Date.now(),firstBare).run();const nextBare=await bare('bare-after-close');assert.notEqual(nextBare,firstBare)
  await DB.prepare('UPDATE conversations SET resolved_at=NULL WHERE id=?').bind(firstBare).run();assert.equal(await bare('bare-two-open'),nextBare)
  // The header From is the author; only Cloudflare's own topmost verdict verifies it, and only a verified sender's CCs join.
  const verdict=(domain,result='pass')=>`Authentication-Results: mx.cloudflare.net; dkim=${result} header.d=${domain} header.s=s1; dmarc=${result} header.from=${domain}\r\n`
  const forwardedCc='Delivered-To: support@company.example\r\nCc: Colleague <colleague@customer.example>, support@company.example, inbound@example.com\r\n'
  const people=async id=>{const row=await admitted(id);return {contact:(await DB.prepare('SELECT email FROM contacts WHERE id=?').bind(row.actor_id).first()).email,verified:JSON.parse((await claim(id)).evidence_json).sender_verified,participants:(await DB.prepare('SELECT ct.email FROM conversation_participants cp JOIN contacts ct ON ct.id=cp.contact_id WHERE cp.conversation_id=? ORDER BY ct.email').bind(row.conversation_id).all()).results.map(p=>p.email)}}
  const forwarded=(id,headerFrom,headers)=>deliver({id,authenticated:false,to:'support@company.example',envelopeTo:'inbound@example.com',from:`SRS0=x1=AB=customer.example=${id}@company.example`,headerFrom,headers})
  assert.equal(await forwarded('first-cc','Ana <ana@customer.example>',verdict('customer.example')+forwardedCc),undefined);assert.deepEqual(await people('first-cc'),{contact:'ana@customer.example',verified:true,participants:['colleague@customer.example']})
  assert.equal(await forwarded('unsigned-cc','Ana <ana@customer.example>',forwardedCc),undefined);assert.equal((await claim('unsigned-cc')).state,'suspended');assert.equal(await admitted('unsigned-cc'),null)
  assert.equal(await forwarded('signed-cc','Ben <ben@customer.example>',verdict('customer.example')+forwardedCc),undefined);assert.deepEqual(await people('signed-cc'),{contact:'ben@customer.example',verified:true,participants:['colleague@customer.example']})
  assert.equal(await forwarded('forged-verdict','Cy <cy@customer.example>',verdict('customer.example','fail')+verdict('customer.example')+forwardedCc),undefined);assert.equal((await claim('forged-verdict')).state,'suspended');assert.equal(await admitted('forged-verdict'),null)
  // A widget-verified customer: signed mail continues her thread; mail that may forge her From lands apart, flagged.
  await DB.prepare("INSERT INTO contacts(id,project_id,email,external_id,is_verified,metadata_json,created_at) VALUES('signed-in','p','dana@customer.example','dana@customer.example',1,'{\"provided_email\":\"dana-home@customer.example\"}',1)").run()
  const dana=(id,headers)=>deliver({id,authenticated:false,to:'inbound@example.com',from:'dana@customer.example',headerFrom:'Dana <dana@customer.example>',headers:headers+'Reply-To: attacker@attacker.example\r\n'})
  assert.equal(await dana('verified-first',verdict('customer.example')),undefined);const danaThread=(await admitted('verified-first')).conversation_id;assert.equal((await admitted('verified-first')).actor_id,'signed-in')
  const cloudflare=results=>`Authentication-Results: mx.cloudflare.net; ${results}\r\n`
  const forgeries={'quoted-mail-from':cloudflare('dkim=none; spf=pass smtp.mailfrom="x;dkim=pass header.d=customer.example z"@attacker.example; dmarc=fail header.from=customer.example'),'spf-comment':cloudflare('dkim=none (no signatures found); spf=pass (mx.cloudflare.net: domain of "a);dkim=pass header.d=customer.example (b"@attacker.example designates 192.0.2.1 as permitted sender) smtp.mailfrom=attacker.example; dmarc=fail header.from=customer.example'),'helo-semicolon':cloudflare('dkim=none; spf=none smtp.helo=evil;dmarc=pass header.from=customer.example; spf=pass smtp.mailfrom=attacker.example'),'honest-fail':cloudflare('dkim=fail header.d=customer.example; spf=fail smtp.mailfrom=attacker.example; dmarc=fail header.from=customer.example'),'unsigned':''}
  for(const [id,header] of Object.entries(forgeries))assert.equal(await dana(id,header),undefined,id)
  for(const id of Object.keys(forgeries)){assert.equal((await claim(id)).state,'suspended',id);assert.equal(await admitted(id),null,id);assert.equal((await claim(id)).conversation_id,null)}
  assert.equal((await DB.prepare("SELECT json_extract(metadata_json,'$.provided_email') p FROM contacts WHERE id='signed-in'").first()).p,'dana-home@customer.example')
  assert.equal(await DB.prepare("SELECT id FROM contacts WHERE json_extract(metadata_json,'$.unverified_sender')=1").first(),null,'forged mail creates no contact or conversation')
  // A From with no usable address, under Cloudflare's SPF fail for the envelope, never joins her thread; replies email nobody.
  const anaThread=(await admitted('first-cc')).conversation_id,anaContact=(await admitted('first-cc')).actor_id
  const spfFail=cloudflare('dkim=none; dmarc=none policy.dmarc=none; spf=none smtp.helo=mx.attacker.test; spf=fail (mx.cloudflare.net: domain of ana@customer.example does not designate 192.0.2.7 as permitted sender) smtp.mailfrom=ana@customer.example; arc=none smtp.remote-ip=192.0.2.7')
  const noFrom=(id,fromLines,to='inbound@example.com')=>m.email(`${spfFail}${fromLines}To: ${to}\r\nSubject: Bank details\r\nMessage-ID: <${id}>\r\nContent-Type: text/plain\r\n\r\nPlease change my bank details`,{from:'ana@customer.example',to,direct:true})
  const unusable={'no-from':'','display-only':'From: Ana Customer\r\n','no-tld':'From: ana@customer\r\n','empty-angle':'From: <>\r\n'}
  await app.scheduled();const sentBefore=mail.sent.length
  for(const [id,line] of Object.entries(unusable))assert.equal(await noFrom(id,line),undefined,id)
  for(const id of Object.keys(unusable)){assert.equal((await claim(id)).state,'suspended',id);assert.equal(await admitted(id),null,id)}
  await app.scheduled();assert.equal(mail.sent.length,sentBefore,'suspended mail causes no outbound mail')
  assert.equal(await noFrom('no-from-owned','',await replyAddress(anaThread,'ana@customer.example')),undefined)
  assert.deepEqual([(await admitted('no-from-owned')).conversation_id,(await admitted('no-from-owned')).actor_id],[anaThread,anaContact])
  assert.equal(await noFrom('no-from-other-grant','',await replyAddress(danaThread,'dana@customer.example')),undefined)
  assert.equal((await claim('no-from-other-grant')).state,'suspended','an envelope sender different from the grant holder cannot continue the thread')
  assert.equal(await admitted('no-from-other-grant'),null)
  // A widget visitor who types a customer's address never receives that customer's mail nor the reply to it.
  const session=async(name,email)=>(await app.call('/api/identity/widget/session',{headers:{Origin:'https://example.com'},body:{widgetKey:'w',name,email},status:201})).data
  const thread=async token=>(await app.call('/api/conversations',{token,body:{projectId:'p'},status:201})).data
  const visitor=await session('Visitor','ceo@bigco.example'),visitorThread=await thread(visitor.token)
  assert.equal((await app.call(`/api/conversations/${visitorThread.id}/messages`,{token:visitor.token,body:{localId:'visitor-hello',content:'Hi, I am the CEO',expectedRevision:0}})).status,200)
  assert.equal(await deliver({id:'ceo-mail@example.com',to:'inbound@example.com',from:'ceo@bigco.example',headerFrom:'CEO <ceo@bigco.example>',headers:verdict('bigco.example'),text:'CONFIDENTIAL: renewal terms are 2.4M'}),undefined)
  const ceoMail=await admitted('ceo-mail@example.com');assert.notEqual(ceoMail.conversation_id,visitorThread.id);assert.notEqual(ceoMail.actor_id,visitor.contactId)
  await operatorReply(ceoMail.conversation_id,'ceo-reply','The renewal draft is attached');assert.deepEqual(sentWith('renewal draft'),[['ceo@bigco.example']])
  const visitorView=JSON.stringify((await app.call(`/api/conversations/${visitorThread.id}/messages`,{token:visitor.token})).data)
  assert.ok(visitorView.includes('Hi, I am the CEO'));assert.ok(!visitorView.includes('2.4M')&&!visitorView.includes('renewal draft'));assert.ok((await app.call(`/api/conversations/${ceoMail.conversation_id}/messages`,{token:visitor.token})).status>=400)
  // A visitor who typed her own address answers the emailed reply through its reply address, continuing her chat.
  const rosa=await session('Rosa','rosa@acme.test'),rosaThread=await thread(rosa.token)
  assert.equal((await app.call(`/api/conversations/${rosaThread.id}/messages`,{token:rosa.token,body:{localId:'rosa-hello',content:'My parcel arrived damaged',expectedRevision:0}})).status,200)
  await operatorReply(rosaThread.id,'rosa-reply','Could you send a photo of the box?')
  const notice=mail.sent.find(entry=>entry.body.text?.includes('photo of the box'));assert.deepEqual(notice.body.to,['rosa@acme.test']);assert.match(notice.body.reply_to,/^inbound\+r\./)
  assert.equal(await deliver({id:'rosa-answer@example.com',to:notice.body.reply_to,from:'rosa@acme.test',headerFrom:'Rosa <rosa@acme.test>',headers:verdict('acme.test'),text:'Photo attached, the corner is crushed.'}),undefined)
  assert.deepEqual([(await admitted('rosa-answer@example.com')).conversation_id,(await admitted('rosa-answer@example.com')).actor_id],[rosaThread.id,rosa.contactId])
  assert.ok(JSON.stringify((await app.call(`/api/conversations/${rosaThread.id}/messages`,{token:rosa.token})).data).includes('the corner is crushed'))
  assert.equal(await deliver({id:'rosa-fresh@example.com',to:'inbound@example.com',from:'rosa@acme.test',headerFrom:'Rosa <rosa@acme.test>',headers:verdict('acme.test'),text:'A separate question'}),undefined)
  assert.notEqual((await admitted('rosa-fresh@example.com')).conversation_id,rosaThread.id);assert.notEqual((await admitted('rosa-fresh@example.com')).actor_id,rosa.contactId)
  // Once her chat is Closed, her emailed reply still speaks as her: a new ticket of her own, listed in her widget, never the email contact's open thread.
  const memberAddress=await replyAddress(rosaThread.id,'op@example.com')
  await DB.prepare("UPDATE conversations SET status_id='closed',status_category='closed' WHERE id=?").bind(rosaThread.id).run()
  assert.equal(await deliver({id:'rosa-after-close@example.com',to:notice.body.reply_to,from:'rosa@acme.test',headerFrom:'Rosa <rosa@acme.test>',headers:verdict('acme.test'),text:'The replacement is damaged too.'}),undefined)
  const rosaFollowUp=await admitted('rosa-after-close@example.com')
  assert.equal(rosaFollowUp.actor_id,rosa.contactId);assert.ok(![rosaThread.id,(await admitted('rosa-fresh@example.com')).conversation_id].includes(rosaFollowUp.conversation_id))
  assert.equal((await DB.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(rosaFollowUp.conversation_id).first()).contact_id,rosa.contactId)
  assert.ok((await app.call('/api/conversations',{token:rosa.token})).data.conversations.some(row=>row.id===rosaFollowUp.conversation_id))
  // A member's mail to the Closed ticket is refused: the Worker bounces it, the gateway answers 422 and the member gets one notice.
  // Nothing is stored, no contact is made from their address, and the receipt keeps the refusal.
  const refusals=[mail.sent.length,await m.count("SELECT count(*) n FROM contacts WHERE lower(email)='op@example.com'"),await m.count('SELECT count(*) n FROM conversations')]
  assert.ok(await deliver({id:'member-closed@example.com',to:memberAddress,from:'op@example.com',headerFrom:'Operator <op@example.com>',text:'Answer by email after close'}))
  assert.equal((await gateway({messageId:'member-closed-gateway',conversationId:rosaThread.id,to:'inbound@example.com',from:'op@example.com',text:'Answer by gateway after close'})).status,422)
  for(const id of ['member-closed@example.com','member-closed-gateway'])assert.deepEqual([(await claim(id)).state,(await claim(id)).conversation_id,(await claim(id)).message_id],['ignored',rosaThread.id,null])
  assert.equal(await m.count("SELECT count(*) n FROM messages WHERE content LIKE 'Answer by % after close'"),0)
  assert.deepEqual([await m.count("SELECT count(*) n FROM contacts WHERE lower(email)='op@example.com'"),await m.count('SELECT count(*) n FROM conversations')],refusals.slice(1))
  assert.deepEqual(mail.sent.slice(refusals[0]).map(entry=>entry.body.to),[['op@example.com']])
  // A reply-all to more than 50 addresses is routed, never refused.
  const crowd=[...Array.from({length:60},(_,index)=>`person${index}@crowd.example`),`${'x'.repeat(330)}@crowd.example`,'inbound@example.com'].join(', ')
  assert.equal(await deliver({id:'reply-all@example.com',to:crowd,envelopeTo:'inbound@example.com',from:'ana@customer.example',headerFrom:'ana@customer.example'}),undefined);assert.equal((await claim('reply-all@example.com')).state,'delivered')
  // The original body follows the same erasure custody as the visible content.
  await DB.prepare("UPDATE messages SET content='' WHERE id=?").bind(ccMessage.id).run();assert.equal((await DB.prepare('SELECT content_raw FROM messages WHERE id=?').bind(ccMessage.id).first()).content_raw,null)
 }finally{await m.close()}
}

// The schedule's replay of a customer message delivered through the Worker reaches the same assistant reply command the
// delivery recorded, failed for a missing key or still queued, and marks the outbox delivered without a second command.
export async function replayJourney(){
 const m=await mailApp(),{app,replyAddress}=m,DB={prepare:sql=>app.db.prepare(sql),batch:statements=>app.db.batch(statements)}
 const pending=id=>DB.prepare('SELECT count(*) n FROM conversation_outbox WHERE conversation_id=? AND delivered_at IS NULL').bind(id).first().then(row=>row.n)
 const generations=id=>DB.prepare('SELECT id,state,actor_json,options_json FROM ai_generations WHERE conversation_id=?').bind(id).all().then(rows=>rows.results)
 const conversation=async id=>{await DB.batch([DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES(?,'p','ct',1,?,1,1)").bind(id,'earlier-'+id),DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,'p',?,'earlier','ct','contact','Earlier',1,1)").bind('earlier-'+id,id),DB.prepare("INSERT INTO conversation_ai(conversation_id,ai_id) VALUES(?,'ai')").bind(id)]);return replyAddress(id,'customer@example.com')}
 try{
  await DB.batch([DB.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,is_enabled,created_at) VALUES('ai','p','Assistant','reply','Use evidence','gpt-5.6-luna',1,1)"),DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('ct','p','customer@example.com',1)")])
  // Without a provider key the reply command is recorded failed, and replay finds that same command.
  const failedTo=await conversation('failed-conv');assert.equal(await m.email(message({id:'failed@example.com',to:failedTo,text:'Where is my order?'}),{from:'customer@example.com',to:failedTo}),undefined);const failed={message:await m.admitted('failed@example.com')}
  const [recorded]=await app.until(async()=>(await generations('failed-conv')).length&&generations('failed-conv'),{message:'recorded reply command'});assert.equal(recorded.id,`reply:${failed.message.id}`);assert.equal(recorded.state,'failed')
  assert.equal(recorded.actor_json,'{"contactId":"ct","id":"ct","projectId":"p","role":"contact"}','the actor is stored canonically')
  await m.replay(failed.message);assert.equal(await pending('failed-conv'),0,'replay reaches the recorded command and marks the outbox delivered')
  assert.deepEqual((await generations('failed-conv')).map(row=>[row.id,row.state]),[[recorded.id,'failed']])
  // With a key the command is queued with the application origin; replay before the worker runs is idempotent.
  await app.configure({OPENAI_API_KEY:'sk-test-never-called'})
  const queuedTo=await conversation('queued-conv');assert.equal(await m.email(message({id:'queued@example.com',to:queuedTo,text:'Where is my order?'}),{from:'customer@example.com',to:queuedTo}),undefined);const queued={message:await m.admitted('queued@example.com')}
  await app.until(async()=>(await generations('queued-conv')).length,{message:'queued reply command'});assert.deepEqual((await generations('queued-conv')).map(row=>[row.id,row.state]),[[`reply:${queued.message.id}`,'queued']])
  assert.equal(JSON.parse((await generations('queued-conv'))[0].options_json).application_origin,'https://app.example')
  assert.ok((await app.takeJobs()).some(job=>job.id===`reply:${queued.message.id}`))
  await m.replay(queued.message);assert.equal(await pending('queued-conv'),0);assert.equal((await generations('queued-conv')).length,1)
  assert.equal(m.mail.sent.length,0)
 }finally{await m.close()}
}
