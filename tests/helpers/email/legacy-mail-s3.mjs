import assert from 'node:assert/strict'
import {createHash,createHmac,randomBytes} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {replyTo} from './app.mjs'

// The reader of mail that Amazon SES stores in S3, through the real Worker: its cron lists the two prefixes, its queued
// jobs read each object and admit it or hold it. Only the network is faked, by a small S3 that also checks every request
// is a correctly signed, read-only SigV4 GET. Synthetic names, addresses and keys only.
const BUCKET='synthetic-mail-bucket',REGION='us-east-1',KEY_ID='SYNTHETICKEYID',SECRET='synthetic-secret-access-key'
const SES='ses/acme/',REPLAY='replay/acme/',MAILBOX='help@mail.example.com'
const inputs={LEGACY_MAIL_S3_BUCKET:BUCKET,LEGACY_MAIL_S3_PREFIX:SES,LEGACY_MAIL_S3_REPLAY_PREFIX:REPLAY,LEGACY_MAIL_S3_MAILBOX:MAILBOX,LEGACY_AWS_REGION:REGION,LEGACY_AWS_ACCESS_KEY_ID:KEY_ID,LEGACY_AWS_SECRET_ACCESS_KEY:SECRET}

const sha256=value=>createHash('sha256').update(value).digest('hex')
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest()
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())
const escapeXml=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

// An S3 holding objects in memory. It lists in pages of two, so a bucket of any size needs the continuation token, and it
// verifies each request's signature the way S3 does: from the request as received, with its own implementation.
function fakeS3(){
 const objects=new Map(),requests=[],violations=[]
 const verify=request=>{
  const url=new URL(request.url),match=(request.headers.get('authorization')||'').match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/)
  if(!match)return 'authorization header'
  const [,id,day,region,signed,signature]=match,names=signed.split(';'),date=request.headers.get('x-amz-date')||''
  if(id!==KEY_ID||region!==REGION)return 'credential scope'
  if(request.method!=='GET')return 'method '+request.method
  if(url.host!==`${BUCKET}.s3.${REGION}.amazonaws.com`||url.protocol!=='https:')return 'host '+url.host
  if(names.join(';')!==[...names].sort().join(';')||!['host','x-amz-content-sha256','x-amz-date'].every(name=>names.includes(name)))return 'signed headers'
  for(const name of request.headers.keys())if(name.startsWith('x-amz-')&&!names.includes(name))return 'unsigned '+name
  if(request.headers.get('x-amz-content-sha256')!==sha256('')||!date.startsWith(day)||Math.abs(Date.now()-Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z')))>300000)return 'payload hash or date'
  const path=url.pathname.split('/').map(part=>encode(decodeURIComponent(part))).join('/')
  const query=[...url.searchParams].map(([name,value])=>[encode(name),encode(value)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(([name,value])=>`${name}=${value}`).join('&')
  const headerValue=name=>name==='host'?url.host:request.headers.get(name)
  const canonical=['GET',path,query,...names.map(name=>`${name}:${headerValue(name)}`),'',signed,sha256('')].join('\n')
  const scope=`${day}/${region}/s3/aws4_request`
  let key=hmac('AWS4'+SECRET,day);for(const part of [region,'s3','aws4_request'])key=hmac(key,part)
  return createHmac('sha256',key).update(['AWS4-HMAC-SHA256',date,scope,sha256(canonical)].join('\n')).digest('hex')===signature?null:'signature'
 }
 const handle=request=>{
  const problem=verify(request),url=new URL(request.url)
  if(problem){violations.push(problem);return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>',{status:403})}
  if(url.pathname==='/'){
   const prefix=url.searchParams.get('prefix'),token=url.searchParams.get('continuation-token')
   if(url.searchParams.get('list-type')!=='2'||![SES,REPLAY].includes(prefix)){violations.push('list query');return new Response('',{status:400})}
   requests.push({list:prefix,token})
   const keys=[...objects.keys()].filter(key=>key.startsWith(prefix)).sort(),start=token?Number(token.slice(token.lastIndexOf('=')+1)):0,page=keys.slice(start,start+2),more=start+2<keys.length
   return new Response(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${BUCKET}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${more}</IsTruncated>${more?`<NextContinuationToken>tok+/=${start+2}</NextContinuationToken>`:''}${page.map(key=>`<Contents><Key>${escapeXml(key)}</Key><Size>${objects.get(key).length}</Size></Contents>`).join('')}</ListBucketResult>`,{headers:{'Content-Type':'application/xml'}})
  }
  const key=decodeURIComponent(url.pathname.slice(1));requests.push({get:key})
  return objects.has(key)?new Response(objects.get(key)):new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404})
 }
 return {handle,requests,violations,put:(key,body)=>objects.set(key,Buffer.from(body)),gets:()=>requests.filter(entry=>entry.get).map(entry=>entry.get)}
}

// A message as SES stores it: its own headers on top (folded as SES folds them), then the sender's. `recipient` null
// writes a Received line with no `for` clause.
const sesObject=({id,from='Customer <someone@customer.example>',to=MAILBOX,recipient=MAILBOX,subject='Question about my order',text='Hello, where is my order?'})=>{
 const domain=from.match(/@([a-z0-9.-]+)/i)[1]
 return [
  `Return-Path: <bounce@${domain}>`,
  `Received: from mail-out.${domain} (mail-out.${domain} [192.0.2.10])`,` by inbound-smtp.${REGION}.amazonaws.com with SMTP id ${id}${recipient?` for ${recipient}`:''};`,' Sun, 08 Nov 2026 10:00:00 +0000 (UTC)',
  `Received-SPF: pass (spfCheck: domain of ${domain} designates 192.0.2.10 as permitted sender) client-ip=192.0.2.10; envelope-from=bounce@${domain}; helo=mail-out.${domain};`,
  'Authentication-Results: amazonses.com;',` spf=pass (spfCheck: domain of ${domain} designates 192.0.2.10 as permitted sender) client-ip=192.0.2.10; envelope-from=bounce@${domain}; helo=mail-out.${domain};`,` dkim=pass header.i=@${domain};`,` dmarc=pass header.from=${domain};`,
  'X-SES-RECEIPT: AEFBQUFBQUFBQUFH',
  `From: ${from}`,`To: ${to}`,`Subject: ${subject}`,`Message-ID: <${id}@${domain}>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=utf-8','',text,'',
 ].join('\r\n')
}

export async function legacyMailS3Journey(){
 const s3=fakeS3(),sent=[]
 const app=await startApp({captureQueue:true,origin:'https://app.example',bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-resend',EMAIL_FROM:MAILBOX,INBOUND_EMAIL_TOKEN:'fixture-gateway',INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),...inputs},outbound:async request=>{
  const host=new URL(request.url).hostname
  if(host.endsWith('.amazonaws.com'))return s3.handle(request)
  if(host==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.com.'}]})
  sent.push(await request.json());return Response.json({id:`resend-${sent.length}`})
 }})
 try{
  const a=await app.seedWorkspace('a'),b=await app.seedWorkspace('b'),count=async sql=>(await app.first(sql)).n
  await app.presenceAwayOff(a.projectId)
  const settings=(workspace,address)=>app.ok(`/api/management/projects/${workspace.projectId}/email-settings`,{method:'PUT',token:workspace.tokens.owner,body:{email_from_name:'Support',email_from_address:address,inbound_address:address,is_enabled:true}})
  const status=async workspace=>(await app.ok(`/api/management/projects/${workspace.projectId}/email-settings`,{token:workspace.tokens.owner})).legacyMailS3
  // Until every cron tick and queued job has settled: each tick lists, queues what is due and runs the jobs.
  const settle=async()=>{
   for(let round=0;round<40;round++){
    await app.scheduled();const ran=await app.drainJobs()
    if(!ran&&!await count("SELECT count(*) n FROM legacy_mail_s3_receipts WHERE state IN ('pending','processing','retry')"))return
   }
   throw new Error('the reader did not settle: '+JSON.stringify(await app.sql('SELECT state,reason,error,attempts FROM legacy_mail_s3_receipts WHERE state NOT IN (\'complete\',\'held\',\'setup_notice\',\'duplicate\')')))
  }
  const tables=()=>Promise.all(['messages','conversations','contacts','suspended_emails','legacy_mail_s3_receipts'].map(table=>count(`SELECT count(*) n FROM ${table}`)))
  const held=reason=>count(`SELECT count(*) n FROM suspended_emails WHERE project_id='${a.projectId}' AND reason='${reason}'`)

  // Without every required input the reader does nothing at all: no request, no receipt, no status.
  await app.configure({LEGACY_AWS_SECRET_ACCESS_KEY:'  '})
  s3.put(SES+'AMAZON_SES_SETUP_NOTIFICATION','Amazon SES Setup Notification')
  s3.put(SES+'plainmessage0001',sesObject({id:'plainmessage0001'}))
  await app.scheduled();await app.drainJobs()
  assert.equal(app.requests.filter(request=>request.url.includes('amazonaws.com')).length,0)
  assert.equal(await count('SELECT count(*) n FROM legacy_mail_s3_receipts'),0)
  await app.configure({LEGACY_AWS_SECRET_ACCESS_KEY:SECRET})

  // Nothing receives on the mailbox yet: the objects wait, neither admitted nor held, and the workspace that will
  // receive on it sees no reader until it does.
  s3.put(SES+'plainmessage0002',sesObject({id:'plainmessage0002',from:'Dana <dana@customer.example>',text:'Another question.'}))
  await settle()
  assert.deepEqual(await app.sql("SELECT state,count(*) n FROM legacy_mail_s3_receipts GROUP BY state ORDER BY state"),[{state:'pending_mailbox',n:2},{state:'setup_notice',n:1}])
  assert.deepEqual(await tables(),[0,0,0,0,3])
  assert.equal(await status(a),null)

  // An admin sets that address on a workspace: the waiting mail is admitted within a tick.
  await settings(a,MAILBOX);await settings(b,'other@mail.example.com')
  await settle()
  assert.equal(await count("SELECT count(*) n FROM legacy_mail_s3_receipts WHERE state='complete'"),2)
  assert.equal(await count(`SELECT count(*) n FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id='${a.projectId}'`),2)
  assert.equal(await status(b),null)
  // Rerunning admits nothing new: the same keys are listed again and none is read again.
  const before=await tables(),gets=s3.gets().length
  await settle()
  assert.deepEqual(await tables(),before);assert.equal(s3.gets().length,gets)
  assert.ok(!s3.gets().some(key=>key.endsWith('AMAZON_SES_SETUP_NOTIFICATION')),'the setup notice is not mail')

  // A customer's reply to `mailbox+<conversation id>` threads onto that conversation, though its To: names something
  // else; a stranger writing to it does not.
  await app.db.batch([
   app.db.prepare("INSERT INTO contacts(id,project_id,email,metadata_json,created_at) VALUES('visitor',?,'rosa@acme.test','{}',1)").bind(a.projectId),
   app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('chat',?,'visitor',1,'chat-hello',1,1)").bind(a.projectId),
   app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('chat-hello',?,'chat','hello','visitor','contact','My parcel arrived damaged',1,1)").bind(a.projectId),
  ])
  s3.put(SES+'threadedreply0003',sesObject({id:'threadedreply0003',from:'Rosa <rosa@acme.test>',to:'someone-else@mail.example.com',recipient:'help+chat@mail.example.com',text:'The corner is crushed.'}))
  // So does the same customer's reply to the address of a conversation the reader itself created.
  const created=(await app.first("SELECT conversation_id FROM legacy_mail_s3_receipts WHERE object_key=?",SES+'plainmessage0001')).conversation_id
  s3.put(SES+'followupreply0008',sesObject({id:'followupreply0008',recipient:`help+${created}@mail.example.com`,text:'Any news?'}))
  // Mail whose SES record does not show this mailbox is held whole in the workspace that receives on it: no `for`, or
  // another address, whatever its To: says; and it makes no contact and no conversation.
  s3.put(SES+'noforclause0004',sesObject({id:'noforclause0004',from:'Eve <eve@customer.example>',recipient:null}))
  s3.put(SES+'otherrecipient0005',sesObject({id:'otherrecipient0005',from:'Fay <fay@customer.example>',recipient:'someone-else@mail.example.com'}))
  const contactsBefore=await count('SELECT count(*) n FROM contacts')
  await settle()
  assert.equal(await count("SELECT count(*) n FROM messages WHERE conversation_id='chat'"),2)
  assert.equal(await count(`SELECT count(*) n FROM messages WHERE conversation_id='${created}'`),2)
  assert.equal(await held('envelope_recipient_unproven'),2)
  assert.equal(await count('SELECT count(*) n FROM contacts'),contactsBefore)
  assert.equal(await count("SELECT count(*) n FROM contacts WHERE email IN ('eve@customer.example','fay@customer.example')"),0)
  const heldRow=await app.first("SELECT input_json FROM suspended_emails WHERE reason='envelope_recipient_unproven'")
  assert.equal(JSON.parse(heldRow.input_json).attachments[0].filename,'original.eml')

  // Operators write the replay prefix, so nothing there is authenticated: forged SES-shaped headers from a member, and from
  // the customer a live reply grant was issued to, land in Suspended with no message, no conversation and no outbound mail.
  const transcript=await app.ok(`/api/dashboard/projects/${a.projectId}/conversations/chat`,{method:'PUT',token:a.tokens.operator,body:{send_transcript_to:'rosa@acme.test',idempotencyKey:'grant'}}).then(()=>app.until(()=>sent.find(entry=>JSON.stringify(entry).includes('rosa@acme.test')),{message:'transcript mail'}))
  const grant=replyTo(transcript)
  assert.match(grant,/\+r\.[0-9a-f]{32}@/)
  // Mail the earlier admissions queued (digests, acknowledgements) goes out first, so only this tick's is counted.
  await app.scheduled();await app.scheduled(undefined,{after:61000});await app.drainJobs()
  s3.put(REPLAY+'forgedmember0006',sesObject({id:'forgedmember0006',from:'Admin <admin-a@example.test>',recipient:'help+chat@mail.example.com',text:'Please wire the funds.'}))
  s3.put(REPLAY+'forgedgrant0007',sesObject({id:'forgedgrant0007',from:'Rosa <rosa@acme.test>',recipient:grant,text:'Replying to the grant address.'}))
  // The same message copied under the replay prefix holds the id its first receipt holds: nothing new is admitted or held.
  s3.put(REPLAY+'plainmessage0001',sesObject({id:'plainmessage0001'}))
  const [messages,conversations,,suspended]=await tables(),mailBefore=sent.length
  await settle()
  const [messagesAfter,conversationsAfter,,suspendedAfter]=await tables()
  assert.equal(await held('sender_unproven'),2)
  assert.deepEqual([messagesAfter,conversationsAfter,suspendedAfter],[messages,conversations,suspended+2])
  assert.equal(sent.length,mailBefore)
  assert.equal(await count("SELECT count(*) n FROM legacy_mail_s3_receipts WHERE state='duplicate' AND source='replay'"),1)

  // The status read shows this workspace's reader and every receipt by state; every request was a signed read.
  const read=await status(a)
  assert.equal(read.mailbox,MAILBOX);assert.equal(read.lastListError,null);assert.ok(Number.isFinite(Date.parse(read.lastListedAt)))
  assert.deepEqual(read.counts,{pending:0,pendingMailbox:0,complete:4,held:{envelope_recipient_unproven:2,sender_unproven:2},failed:0,setupNotice:1,duplicate:1,replay:3})
  assert.deepEqual(s3.violations,[])
  assert.ok(s3.requests.some(entry=>entry.token),'a list followed its continuation token')
  assert.ok(app.requests.filter(request=>request.url.includes('amazonaws.com')).every(request=>request.method==='GET'))
  // The private copy is a transport buffer: none remains once every receipt is final.
  assert.equal((await (await app.files).list({prefix:'legacy-mail-s3/'})).objects.length,0)
  assert.equal(await count('SELECT count(*) n FROM legacy_mail_s3_receipts WHERE raw_key IS NOT NULL'),0)
 }finally{await app.close()}
}
