import assert from 'node:assert/strict'
import {activationApp,hosted,local,origin,step,domainRecords} from './activation-app.mjs'

const password='synthetic-first-run-owner-password-123'
const loopback='http://127.0.0.1:8787'

// The owner's mail on Setup: a welcome email or a used sign-in link confirms the owner's mailbox only on what the
// provider observed, uncertain mail is never resent, local mail is suppressed, and the sender follows the domain
// the provider verified without ever overwriting an address the owner chose.
export async function ownerMailJourney(){
 await localMail()
 await hostedWelcome()
 await lostWelcome()
}

// Create workspace on a fresh installation: the one welcome email leaves through the durable send path.
const claim=async(a,{email,website,base=origin,setupToken})=>{
 const created=await a.app.call('/api/identity/bootstrap',{base,headers:{Origin:base},body:{email,password,allowedOrigin:website,...(setupToken?{setupToken}:{})},status:201})
 const {projectId,userId,token,welcomeEmail}=created.data
 return {ws:{projectId,tokens:{owner:token},users:{owner:userId}},welcomeEmail}
}

// A local installation: the loopback owner is claimed without a setup token, and customer, teammate, welcome and
// test mail are validated and suppressed without delivery records, reply grants or any provider request.
export async function localMail(){
 const a=await activationApp({bindings:{...hosted,...local},appOrigin:loopback,captureQueue:true}),{app}=a
 try{
  const owner='owner-mail@example.test',{ws,welcomeEmail}=await claim(a,{email:owner,website:'https://mail.example',base:loopback})
  assert.equal(welcomeEmail,'suppressed');const api=a.kit(ws)
  for(const data of [await api.check({step:'owner_mail'}),await api.testMail(),await api.testMail(),await api.check({auto:true})]){
   const mail=step(data,'owner_mail');assert.equal(mail.state,'pending');assert.ok(!mail.receiptRef)
  }
  assert.equal((await app.call('/api/identity/magic-link',{base:loopback,headers:{Origin:loopback,'CF-Connecting-IP':'127.0.0.9'},body:{email:owner}})).status,503)
  assert.equal((await app.first('SELECT count(*) n FROM magic_signins')).n,0)
  // A customer with an email address writes; the owner, who holds the conversation, replies.
  const visitor=await a.visitor(ws,'local-contact',{conversation:true})
  await app.db.batch([app.db.prepare("UPDATE contacts SET email='customer@example.test' WHERE id='local-contact'"),app.db.prepare('UPDATE conversations SET assigned_to=? WHERE id=?').bind(ws.users.owner,visitor.conversationId)])
  for(const [token,content] of [[visitor.token,'A real local question'],[ws.tokens.owner,'A real local reply']]){
   const transcript=(await app.call(`/api/conversations/${visitor.conversationId}/messages`,{base:loopback,token,status:200})).data
   await app.call(`/api/conversations/${visitor.conversationId}/messages`,{base:loopback,token,body:{localId:crypto.randomUUID(),content,expectedRevision:transcript.revision,expectedLastMessageId:transcript.lastMessageId},status:200})
  }
  await app.drainJobs();await app.scheduled();await app.scheduled(undefined,{after:61000})
  assert.equal((await app.first('SELECT state FROM operator_notifications WHERE conversation_id=?',visitor.conversationId)).state,'complete')
  assert.equal((await app.first('SELECT count(*) n FROM email_deliveries')).n,0,'suppressed welcome, test, customer and teammate mail create no delivery records')
  assert.deepEqual(await app.sql('SELECT * FROM email_reply_grants'),[])
  assert.deepEqual(app.requests.map(request=>new URL(request.url).host).filter(host=>host!=='cloudflare-dns.com'),[],'local sending and checks contact no provider (only the website\'s own name is resolved)')
 }finally{await a.close()}
}

// A hosted installation whose website domain the provider has not yet verified.
async function hostedWelcome(){
 const a=await activationApp({bindings:{...hosted,APP_ORIGIN:origin,H2H_SETUP_TOKEN:'synthetic-first-run-setup-token'}}),{app,s}=a
 const saved=projectId=>app.first('SELECT from_address,updated_at FROM email_settings WHERE project_id=?',projectId)
 try{
  // The welcome email leaves from the installation sender and counts only once the provider reports it delivered.
  s.recipient='owner@acme.test';const {ws,welcomeEmail}=await claim(a,{email:s.recipient,website:'https://www.acme.test',setupToken:'synthetic-first-run-setup-token'})
  assert.equal(welcomeEmail,'sent');assert.equal(s.sendCount,1);const api=a.kit(ws),sends=s.sendCount,mailbox=await saved(ws.projectId)
  let mail=step(await api.check({step:'owner_mail'}),'owner_mail');assert.equal(mail.state,'pending');assert.doesNotMatch(mail.detail,/delivered/i)
  s.event='delivered';mail=step(await api.check({step:'owner_mail'}),'owner_mail');assert.equal(mail.state,'done');assert.match(mail.receiptRef,/:delivered$/)
  // Until the website's own domain is verified, the installation sender stays in use and the proposal is named.
  let data=await api.check({})
  assert.deepEqual([step(data,'sender_dns').state,step(data,'owner_mail').state],['pending','done'])
  assert.deepEqual([data.facts.mail.sender,data.facts.mail.proposedSender,data.facts.mail.senderSwitch],[hosted.EMAIL_FROM,'support@acme.test',null])
  assert.equal((await saved(ws.projectId)).from_address,hosted.EMAIL_FROM,'an unverified domain is not adopted')
  // Verified, the proposed sender is adopted in the same observation; the mailbox version does not move.
  s.proposedStatus='verified';data=await api.check({})
  assert.equal(step(data,'sender_dns').state,'done');assert.deepEqual({...await saved(ws.projectId)},{from_address:'support@acme.test',updated_at:mailbox.updated_at},'the sender switches; the mailbox version does not')
  assert.deepEqual([data.facts.mail.sender,data.facts.mail.senderSwitch?.from,data.facts.mail.senderSwitch?.to],['support@acme.test',hosted.EMAIL_FROM,'support@acme.test'])
  assert.equal(step(data,'owner_mail').state,'done','the welcome email from the replaced installation sender still counts')
  const read=await api.get();assert.deepEqual([step(read,'sender_dns').state,step(read,'owner_mail').state],['done','done'],'the observation describes the sender now in use')
  for(let i=0;i<3;i++)await api.check({auto:true})
  assert.equal(s.sendCount,sends,'checks never send or resend')
  s.event='sent';s.proposedStatus='pending'

  await senderRecords(a)
  await signInLinks(a)
 }finally{await a.close()}
}

// Sender DNS reports the provider's records as facts, read back without a provider request, and follows an
// address the owner chose: its own domain is checked and mail never switches.
async function senderRecords(a){
 const {app,s}=a,since=a.since,expected=status=>domainRecords(status).map(({type,name,value})=>({type,name,value,status}))
 const ws=await app.seedWorkspace('dns'),api=a.kit(ws)
 s.dnsStatus='pending';const checked=await api.check({step:'sender_dns'})
 assert.equal(step(checked,'sender_dns').state,'pending');assert.deepEqual(checked.facts.senderRecords,expected('pending'))
 let start=app.requests.length;assert.deepEqual((await api.get()).facts.senderRecords,expected('pending'));assert.deepEqual(since(start),[])
 s.domainListed=false;const absent=await api.check({step:'sender_dns'})
 assert.equal(step(absent,'sender_dns').state,'pending');assert.deepEqual(absent.facts.senderRecords,[])
 s.domainListed=true;s.dnsStatus='verified';const verified=await api.check({step:'sender_dns'})
 assert.equal(step(verified,'sender_dns').state,'done');assert.deepEqual(verified.facts.senderRecords,expected('verified'))
 assert.deepEqual((await api.get({env:{EMAIL_FROM:'support@other.test'}})).facts.senderRecords,[],'records belong to the configuration they were read under')

 const own=await app.seedWorkspace('dns-own'),chosen=a.kit(own),sentFrom=async()=>(await app.first('SELECT from_address FROM email_settings WHERE project_id=?',own.projectId)).from_address
 await app.db.batch([app.db.prepare('INSERT INTO email_settings VALUES(?,?,?,?,?,?)').bind(own.projectId,'Support','help@mine.test',null,0,1),app.db.prepare('INSERT INTO project_settings VALUES(?,?,?)').bind(own.projectId,JSON.stringify({proposed_sender:'support@acme.test'}),Date.now())])
 s.proposedStatus='verified'
 try{
  // The proposed domain is verified, but the address in use is help@mine.test, whose domain is the one checked.
  s.ownStatus='pending';start=app.requests.length;let data=await chosen.check({step:'sender_dns'})
  assert.equal(step(data,'sender_dns').state,'pending');assert.equal(data.facts.mail.senderDnsDomain,'mine.test')
  assert.ok(since(start).some(url=>url.endsWith('/domains/domain-3'))&&!since(start).some(url=>url.endsWith('/domains/domain-2')),'only the domain of the address in use is read')
  assert.equal(await sentFrom(),'help@mine.test');assert.equal(data.facts.mail.senderSwitch,null,'a verified proposal never replaces a chosen address')
  s.ownStatus='verified';data=await chosen.check({step:'sender_dns'})
  assert.equal(step(data,'sender_dns').state,'done');assert.equal(data.facts.mail.senderDnsDomain,'mine.test')
  assert.deepEqual([await sentFrom(),data.facts.mail.sender,data.facts.mail.proposedSender,data.facts.mail.senderSwitch],['help@mine.test','help@mine.test','support@acme.test',null],'verifying the chosen address never switches the sender')
  assert.equal(step(await chosen.get(),'sender_dns').state,'done')
  // Still on the seeded installation sender, the proposed domain is the one named.
  await app.db.prepare('UPDATE email_settings SET from_address=? WHERE project_id=?').bind(hosted.EMAIL_FROM,own.projectId).run()
  assert.equal((await chosen.get()).facts.mail.senderDnsDomain,'acme.test')
 }finally{s.proposedStatus='pending';s.ownStatus='pending'}
}

// A sign-in link admits one session once, checked at admission, and a used link confirms owner mail in every
// workspace its person owns, never where they are not an owner.
async function signInLinks(a){
 const {app,s}=a,headers={Origin:origin,'CF-Connecting-IP':'127.0.0.10'}
 const request=async email=>{s.recipient=email;const sends=s.sendCount;assert.equal((await app.call('/api/identity/magic-link',{headers,body:{email}})).status,202);await app.until(()=>s.sendCount>sends,{message:'sign-in mail'});return [...s.messages.values()].at(-1).text.match(/token=([a-f0-9]{64})/)[1]}
 const consume=token=>app.call('/api/identity/magic-link/consume',{headers,body:{token}})
 const sessions=async()=>(await app.first('SELECT count(*) n FROM sessions')).n
 const session=cookie=>app.call('/api/identity/session',{headers:{Cookie:cookie.split(';')[0]}})
 // Sign-in links are issued for the person's lowest-id workspace; the link proves their mailbox, wherever it was issued.
 const first=await app.seedWorkspace('two-a'),second=await app.seedWorkspace('two-b')
 await app.db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").bind(second.projectId,'owner-two-a').run()
 // The owner of workspace p-two-0, whose links are issued for it, is only an admin of the second workspace.
 await app.seedWorkspace('two-0');await app.db.prepare("INSERT INTO memberships VALUES(?,?,'admin')").bind(second.projectId,'owner-two-0').run()
 const apis=[a.kit(first),a.kit(second)],ownerMail=()=>Promise.all(apis.map(async api=>step(await api.check({step:'owner_mail'}),'owner_mail')))
 // Two concurrent uses of one link admit exactly one session; the native authority trigger still runs.
 const epoch=async()=>(await app.first('SELECT revision FROM integration_authority_epoch WHERE id=1')).revision
 const nonOwner=await request('owner-two-0@example.test'),before=await sessions(),revision=await epoch()
 const raced=await Promise.all([consume(nonOwner),consume(nonOwner)]);assert.deepEqual(raced.map(response=>response.status).sort(),[200,400])
 assert.equal(await sessions(),before+1,'exactly one authenticated row is inserted');assert.equal(await epoch(),revision+1,'the native authority trigger still runs')
 const cookie=raced.find(response=>response.status===200).headers.get('Set-Cookie');assert.match(cookie,/HttpOnly/)
 assert.equal((await session(cookie)).data.id,'owner-two-0');assert.equal((await consume(nonOwner)).status,400);assert.equal(await sessions(),before+1)
 assert.deepEqual((await ownerMail()).map(row=>row.state),['pending','pending'],"a non-owner's used link does not count")
 // Membership, role, email and deletion are checked at admission, not at issuance.
 const denied=async(token,change,undo)=>{await app.db.prepare(change).run();const prior=await sessions();assert.equal((await consume(token)).status,400,change);assert.equal(await sessions(),prior);if(undo)await app.db.prepare(undo).run()}
 await denied(await request('owner-two-0@example.test'),"UPDATE magic_signins SET expires_at=1 WHERE consumed_at IS NULL")
 await denied(await request('owner-two-0@example.test'),"DELETE FROM memberships WHERE project_id='p-two-0' AND user_id='owner-two-0'","INSERT INTO memberships VALUES('p-two-0','owner-two-0','admin')")
 const demoted=await consume(await request('owner-two-0@example.test'));assert.equal(demoted.status,200);assert.equal((await session(demoted.headers.get('Set-Cookie'))).data.role,'admin')
 await denied(await request('owner-two-0@example.test'),"UPDATE users SET email='changed@example.test' WHERE id='owner-two-0'","UPDATE users SET email='owner-two-0@example.test' WHERE id='owner-two-0'")
 await denied(await request('operator-two-0@example.test'),"INSERT INTO project_settings VALUES('p-two-0','{\"deleted_at\":1}',1) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.deleted_at',1)")
 // The owner's used link confirms owner mail in both workspaces they own, by the same receipt; checks send nothing.
 const sends=s.sendCount+1;assert.equal((await consume(await request('owner-two-a@example.test'))).status,200)
 const rows=await ownerMail()
 assert.deepEqual(rows.map(row=>row.state),['done','done'],'both workspaces the owner owns confirm owner mail')
 assert.equal(rows[0].receiptRef,rows[1].receiptRef,'the same used link confirms both');assert.match(rows[1].receiptRef,/^signin:owner-two-a:/)
 assert.equal(s.sendCount,sends,'checks send nothing')
}

// A welcome email whose provider outcome is unknown stays unknown on Setup and is never resent.
async function lostWelcome(){
 const a=await activationApp({bindings:{...hosted,APP_ORIGIN:origin,H2H_SETUP_TOKEN:'synthetic-first-run-setup-token'}}),{s}=a
 try{
  s.recipient='owner@lost.example';s.sendUncertain=true
  const {ws,welcomeEmail}=await claim(a,{email:s.recipient,website:'https://lost.example',setupToken:'synthetic-first-run-setup-token'})
  assert.equal(welcomeEmail,'uncertain');s.sendUncertain=false;const api=a.kit(ws),sends=s.sendCount
  assert.equal(step(await api.check({step:'owner_mail'}),'owner_mail').state,'unknown')
  for(let i=0;i<3;i++)await api.check({auto:true})
  await api.check({});await api.get()
  assert.equal(s.sendCount,sends,'checks never send or resend')
 }finally{await a.close()}
}
