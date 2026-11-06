import assert from 'node:assert/strict'
import PostalMime from 'postal-mime'
import {completeMailEdge,customerMime} from './complete-mail-edge.mjs'

// MAIL-001: one inbound ticket's entire lifecycle for every connection kind.
// No ticket creation shortcut: the customer enters at email/TLS/provider HTTP;
// the operator uses the inbox command and reads the same transcript/media routes.
export async function completeMailOutcomes(){
 for(const kind of ['forwarding','imap','gmail','microsoft']){
  const m=await completeMailEdge(kind),{app,edge,ok,box,boxes,token}=m
  try{
   const tickets=async()=>(await ok('/api/conversations')).conversations
   const history=async()=>Promise.all((await tickets()).sort((a,b)=>a.id.localeCompare(b.id)).map(async row=>({id:row.id,messages:(await ok(`/api/conversations/${row.id}/messages`)).messages})))
   const counts=async()=>{const rows=await history();return {tickets:rows.length,messages:rows.reduce((sum,row)=>sum+row.messages.length,0),sends:edge.sent.length,attempts:edge.attempts}}
   assert.deepEqual(await counts(),{tickets:0,messages:0,sends:0,attempts:0})
   const first=customerMime(m,{id:kind+'-first'})
   await m.deliver(first);await app.drainJobs()
   assert.equal((await tickets()).length,1,kind+' new message creates exactly one ticket')
   const id=(await tickets())[0].id,path=`/api/conversations/${id}`,dashboard=`/api/dashboard/projects/${m.projectId}/conversations/${id}`
   const transcript=()=>ok(path+'/messages'),bucket=async()=>(await ok(dashboard+`/buckets/${id}`)).data
   const original=await transcript();assert.equal(original.messages.length,1);assert.match(original.messages[0].content,/damaged café parcel/)
   const commands=new Map()
   const reply=async(localId,content,extra={})=>{
    if(!commands.has(localId)){
     const head=await transcript()
     commands.set(localId,{localId,content,mailboxId:box.id,expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId,...extra})
    }
    return ok(path+'/messages',commands.get(localId))
   }
   const duplicateBefore=await counts();await m.deliver(first,{duplicate:true});await app.drainJobs()
   assert.deepEqual(await counts(),duplicateBefore,kind+' new-message redelivery is inert')
   const upload=await app.ok(path+'/media',{token,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'return-label.txt'},body:'Return label bytes'})
   const beforeReply=edge.sent.length,replyCommand={cc:['finance@customer.example'],bcc:['archive@support.example'],mediaIds:[upload.id]}
   const sent=await reply(kind+'-answer','Your replacement ships today.',replyCommand)
   await app.until(async()=>(await bucket()).messages.find(row=>row.id===sent.message.id)?.email_status?.state==='sent',{message:kind+' inbox reply accepted'})
   const copies=edge.sent.slice(beforeReply);assert.equal(copies.length,1,kind+' one provider send for inbox reply')
   const copy=copies[0],parsed=copy.raw?await PostalMime.parse(copy.raw):null,headers=parsed?Object.fromEntries(parsed.headers.map(h=>[h.key,h.value])):copy.body.headers
   assert.equal(headers['in-reply-to']||headers['In-Reply-To'],`<${kind}-first@customer.example>`)
   assert.equal(headers.references||headers.References,`<${kind}-first@customer.example>`)
   const sentId=parsed?.messageId||copy.body.headers['Message-ID'];assert.ok(sentId)
   assert.match(parsed?.text||copy.body.text,/Parcel Support team/)
   assert.equal(parsed?.from.address||copy.body.from.match(/<([^>]+)>/)[1],m.address)
   assert.equal(parsed?.from.name||copy.body.from.split(' <')[0],'Parcel Support')
   const replyAddress=parsed?.replyTo?.[0]?.address||copy.body.reply_to;assert.ok(replyAddress.startsWith(kind+'+r.'))
   assert.deepEqual(parsed?.cc.map(v=>v.address)||copy.body.cc,['finance@customer.example'])
   assert.deepEqual(kind==='imap'?copy.recipients.filter(v=>v==='archive@support.example'):parsed?.bcc.map(v=>v.address)||copy.body.bcc,['archive@support.example'])
   if(kind==='imap')assert.equal(parsed.bcc,undefined,'BCC stays in the SMTP envelope')
   assert.equal(Buffer.from(parsed?.attachments[0].content||copy.body.attachments[0].content,parsed?'utf8':'base64').toString(),'Return label bytes')
   const repeatBefore=await counts();await reply(kind+'-answer','Your replacement ships today.',replyCommand);await app.drainJobs()
   assert.deepEqual(await counts(),repeatBefore,kind+' inbox command retry cannot send twice')
   // Keep a second open thread with the same sender and subject. Header keys
   // must select the older solved ticket instead of the bare-mailbox fallback.
   await ok(dashboard,{resolved:true},'PUT')
   await m.deliver(customerMime(m,{id:kind+'-independent'}));await app.drainJobs()
   assert.equal((await tickets()).length,2)
   const other=(await tickets()).find(row=>row.id!==id)
   const follow=customerMime(m,{id:kind+'-follow',to:`${m.alias}, ${m.address}`,subject:'Changed subject: replacement photo',headers:`In-Reply-To: ${sentId}\r\nReferences: <${kind}-first@customer.example> ${sentId}\r\n`,attachment:true})
   await m.deliver(follow,{envelopeTo:m.alias});await app.drainJobs()
   const afterFollow=await transcript();assert.equal((await tickets()).length,2);assert.equal(afterFollow.messages.length,3)
   const incoming=afterFollow.messages.at(-1);assert.equal(incoming.actor_role,'contact');assert.equal(incoming.media.length,1)
   const media=await app.request(path+`/media/${incoming.media[0].id}`,{token});assert.equal(media.status,200)
   assert.deepEqual(Buffer.from(await media.arrayBuffer()),Buffer.from([0,1,2,127,128,255]))
   const followBefore=await counts();await m.deliver(follow,{duplicate:true});await app.drainJobs()
   assert.deepEqual(await counts(),followBefore,kind+' attachment redelivery is inert')
   for(const [suffix,header] of [['references',`References: <${kind}-first@customer.example>`],['in-reply-to',`In-Reply-To: ${sentId}`]]){
    await ok(dashboard,{resolved:true},'PUT')
    await m.deliver(customerMime(m,{id:kind+'-'+suffix,to:m.alias,subject:'Another changed subject',headers:header+'\r\n'}),{envelopeTo:m.alias});await app.drainJobs()
    assert.equal((await transcript()).messages.length,suffix==='references'?4:5,kind+' '+suffix+' alone selects the original ticket')
    assert.equal((await ok(`/api/conversations/${other.id}/messages`)).messages.length,1,kind+' same-subject thread remains untouched')
   }
   const cursor=(await m.mailbox()).cursor
   if(kind!=='forwarding')assert.ok(cursor,kind+' saved cursor is publicly visible')
   await m.disconnect();assert.equal((await m.mailbox()).status,'disconnected')
   const stopped=await counts()
   if(kind==='forwarding')assert.ok((await m.deliver(customerMime(m,{id:kind+'-while-disconnected'}))).rejected)
   else assert.equal((await app.call(`${boxes}/${box.id}/poll`,{token,body:{}})).status,409)
   assert.deepEqual(await counts(),stopped,kind+' disconnect stops intake')
   assert.deepEqual((await m.mailbox()).cursor,cursor,kind+' disconnect retains cursor')
   await m.reconnect();assert.deepEqual((await m.mailbox()).cursor,cursor,kind+' reconnect retains cursor')
   const reconnectBefore=await counts()
   await m.deliver(first,{duplicate:true});await m.deliver(follow,{duplicate:true})
   if(kind==='forwarding'){
    // An actual remaining MAIL-001 gap: forwarding has no cursor/backfill door.
    assert.equal((await m.mailbox()).cursor,null)
    assert.equal((await app.call(`${boxes}/${box.id}/backfill`,{token,body:{}})).status,409)
   }else await m.backfill()
   await app.drainJobs()
   assert.deepEqual(await counts(),reconnectBefore,kind+' reconnect and backfill redelivery creates no ticket, message or send')
   assert.equal((await transcript()).messages.length,5)
   await quietMailOutcomes(m,{id,path,dashboard,reply,counts})
   const retainedHistory=await history()
   await m.disconnect()
   const removedBefore=await counts()
   if(kind==='forwarding')assert.ok((await m.deliver(customerMime(m,{id:kind+'-after-removal'}))).rejected)
   else assert.equal((await app.call(`${boxes}/${box.id}/poll`,{token,body:{}})).status,409)
   assert.deepEqual(await counts(),removedBefore,kind+' removal stops all new intake')
   assert.deepEqual(await history(),retainedHistory,kind+' every earlier ticket and message stays readable')
   assert.ok((await ok(path)).id);assert.ok((await transcript()).messages.some(row=>row.id===incoming.id))
   assert.deepEqual(Buffer.from(await (await app.request(path+`/media/${incoming.media[0].id}`,{token})).arrayBuffer()),Buffer.from([0,1,2,127,128,255]),kind+' removal retains history and attachment bytes')
  }finally{await m.close()}
 }
}

async function quietMailOutcomes(m,{id,path,dashboard,reply,counts}){
 const {app,edge,ok,kind,box,boxes,token}=m
 // A configured/assigned assistant makes absence of AI work meaningful. This is
 // fixture setup, never replacement of admission, classification or AI execution.
 await app.configure({OPENAI_API_KEY:'synthetic-never-called'})
 await app.db.batch([
  app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES(?,?,'Mail assistant','support','Answer customers','gpt-5-mini',1)").bind('ai-'+kind,m.projectId),
  app.db.prepare('INSERT INTO conversation_ai VALUES(?,?)').bind(id,'ai-'+kind),
 ])
 const generationCount=async()=>(await app.first('SELECT count(*) n FROM ai_generations WHERE project_id=?',m.projectId)).n
 const beforeMachine=await counts(),aiBefore=await generationCount()
 for(const [suffix,header] of [['bounce','Return-Path: <>\r\n'],['auto','Auto-Submitted: auto-replied\r\n'],['machine','Precedence: bulk\r\n']]){
  const raw=customerMime(m,{id:kind+'-'+suffix,headers:`In-Reply-To: <${kind}-first@customer.example>\r\n${header}`})
  await m.deliver(raw);await app.drainJobs()
  const current=await counts();assert.equal(current.tickets,beforeMachine.tickets);assert.equal(current.sends,beforeMachine.sends);assert.equal(current.attempts,beforeMachine.attempts)
  assert.equal(await generationCount(),aiBefore,kind+' '+suffix+' creates no AI generation or draft')
  const duplicateBefore=await counts();await m.deliver(raw,{duplicate:true});await app.drainJobs();assert.deepEqual(await counts(),duplicateBefore)
 }
 const heldBefore=await counts()
 for(const [suffix,options,reason] of [['spam',{headers:'X-Spam-Score: 8\r\n'},'spam'],['failed',{failed:true},'authentication_failed']]){
  await m.deliver(customerMime(m,{id:kind+'-'+suffix,...options}));await app.drainJobs()
  const suspended=(await ok(m.base+'/suspended')).data.find(row=>row.reason===reason)
  assert.ok(suspended,kind+' '+suffix+' is visible at the MAIL-002 Suspended door')
  assert.equal((await ok(m.base+'/suspended/'+suspended.id)).data.receipt_id,`<${kind}-${suffix}@customer.example>`)
  assert.deepEqual(await counts(),heldBefore,kind+' held mail creates no ticket, message or send');assert.equal(await generationCount(),aiBefore)
 }
 // Definitive provider refusal is visible on the ticket; incoming permission
 // loss is visible on the mailbox, with the last successful cursor retained.
 edge.rejectSend=true
 const failed=await reply(kind+'-refused','A later update that cannot be sent')
 await app.until(async()=>(await ok(dashboard+`/buckets/${id}`)).data.messages.find(row=>row.id===failed.message.id)?.email_status?.state==='failed',{message:kind+' definitive refusal is failed in the inbox'})
 const visibleError=(await m.mailbox()).error_code
 assert.match(visibleError||'',/rejected|refused/i,kind+' delivery failure is plainly visible on its mailbox')
 const failBefore=await counts();await reply(kind+'-refused','A later update that cannot be sent');await app.drainJobs()
 assert.deepEqual(await counts(),failBefore,kind+' refused send is never automatically repeated')
 edge.rejectSend=false
 edge.loseSend=true
 const lost=await reply(kind+'-lost','Do not repeat this uncertain answer')
 await app.until(async()=>(await ok(dashboard+`/buckets/${id}`)).data.messages.find(row=>row.id===lost.message.id)?.email_status?.state==='uncertain',{message:kind+' lost provider response remains uncertain'})
 assert.match((await m.mailbox()).error_code,/unknown.*reconcile/i)
 const lostBefore=await counts();await reply(kind+'-lost','Do not repeat this uncertain answer');await app.drainJobs()
 assert.deepEqual(await counts(),lostBefore,kind+' uncertain delivery cannot be replayed')
 edge.loseSend=false
 const resumed=await reply(kind+'-resumed','A separately composed later answer')
 await app.until(async()=>(await ok(dashboard+`/buckets/${id}`)).data.messages.find(row=>row.id===resumed.message.id)?.email_status?.state==='sent')
 assert.equal((await m.mailbox()).error_code,null,kind+' a later successful reply clears the displayed delivery failure')
 if(kind!=='forwarding'){
  const cursor=(await m.mailbox()).cursor;edge.permission=true
  const result=await app.call(`${boxes}/${box.id}/poll`,{token,body:{}});assert.equal(result.status,502);assert.match(JSON.stringify(result.data),/reconnect|synchronization failed/i)
  const boxError=await m.mailbox();assert.ok(boxError.error_code);assert.deepEqual(boxError.cursor,cursor)
  edge.permission=false
 }
}
