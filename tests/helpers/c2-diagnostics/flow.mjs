import assert from 'node:assert/strict'
import {mailForm,paragraph,harmless,senders} from './fixture.mjs'

export async function c2Flow(app,{token,projectId:p}){
 const base=`/api/management/projects/${p}`,door=base+'/diagnostics/c2',started=Date.now()
 const call=(path,options={})=>app.call(path,{token,...options})
 const counts=async()=>{
  const response=await call(door+'/counts',{status:200});assert.equal(response.headers.get('cache-control'),'no-store')
  assert.deepEqual(response.data.installationObservation,{kind:'mailgun_token_claims',state:'pending'})
  assert.ok(!('mailgunTokenClaims' in response.data.data))
  for(const value of Object.values(response.data.data))assert.ok(Number.isSafeInteger(value)&&value>=0)
  return response.data.data
 }
 const snapshots={}
 const capture=async label=>snapshots[label]=await counts()
 const receipt=async(scenario,mail,extra={})=>{
  const query=new URLSearchParams({scenario,messageId:mail.id,from:String(started),to:String(Date.now()+1000),...extra})
  const r=await call(door+'/receipts?'+query,{status:200});assert.equal(r.headers.get('cache-control'),'no-store')
  assert.doesNotMatch(JSON.stringify(r.data),/desk-proof|token_hash|intent_hash|content|provider_id|source_json|SELECT|D1_ERROR/)
  return r.data.data
 }
 const submit=mail=>app.call('/api/integrations/email/mailgun/inbound',{method:'POST',raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:mail.body})
 const read=async id=>(await call(`/api/conversations/${id}/messages`,{status:200})).data
 const reply=async(id,label,content)=>{
  const thread=await read(id),localId=`c2scratch4-${label}-${Date.now()}`
  assert.ok(Number.isInteger(thread.revision));assert.ok(thread.lastMessageId)
  const result=await call(`/api/conversations/${id}/messages`,{body:{content,localId,expectedRevision:thread.revision,expectedLastMessageId:thread.lastMessageId},status:200})
  assert.equal(result.data.accepted,true);return localId
 }
 await call(base+'/email-settings',{status:200})
 await call(base+'/email-settings',{method:'PUT',body:{from_name:'Harbour support',from_address:'support@desk-proof.example',inbound_address:'support@desk-proof.example',is_enabled:true},status:200})
 const email=(await call(base+'/email-settings',{status:200})).data
 assert.equal(email.receiving.ready,true);assert.equal(email.sending.mode,'remote');assert.equal(email.sending.provider,'sendgrid')
 const triggers=(await call(base+'/notification-triggers',{status:200})).data.data.filter(t=>['request_received','ticket_solved'].includes(t.event)&&t.channel==='*'&&t.brand_id==='*')
 await call(base+'/notification-triggers',{method:'PUT',body:{triggers:triggers.map(t=>({...t,enabled:false}))},status:200})
 await call(base+'/ai',{status:200});await call(base+'/ai',{method:'PUT',body:{ai_reply_mode:'draft'},status:200})
 await capture('before')
 const control=mailForm('control','My synthetic parcel has not arrived. Please check its tracking.')
 const ctl=await submit(control);assert.equal(ctl.status,200);assert.equal(ctl.data.state,'delivered');const a=ctl.data.conversationId
 await call(`/api/dashboard/projects/${p}/conversations/${a}`,{status:200})
 const ctlLocal=await reply(a,'ctl',harmless)
 await capture('control')
 assert.equal(snapshots.control.conversations-snapshots.before.conversations,1)
 assert.equal(snapshots.control.messages-snapshots.before.messages,2)
 assert.equal(snapshots.control.customerMessages-snapshots.before.customerMessages,1)
 assert.equal(snapshots.control.inboundEmails-snapshots.before.inboundEmails,1)
 assert.equal(snapshots.control.contacts-snapshots.before.contacts,1)
 const preexisting=mailForm('preexisting-overlap',`Hello, I read this somewhere: ${paragraph} Can you explain it?`)
 const pre=await submit(preexisting);assert.equal(pre.status,200);assert.equal(pre.data.state,'delivered');const b=pre.data.conversationId
 await capture('preArticle')
 assert.equal(snapshots.preArticle.messages-snapshots.control.messages,1)
 assert.equal(snapshots.preArticle.replyBlocks,snapshots.control.replyBlocks)
 const articleInput={title:'Tide gauge calibration',slug:'tide-gauge-calibration',summary:'How harbour pilots calibrate the gauge.',content:paragraph,status:'published'}
 const article=(await call(`/api/knowledge/${p}/articles`,{body:articleInput,status:201})).data
 assert.ok((await call(`/api/knowledge/${p}/articles`,{status:200})).data.some(row=>row.id===article.id))
 await capture('published')
 assert.equal(snapshots.published.articles-snapshots.before.articles,1);assert.equal(snapshots.published.published-snapshots.before.published,1)
 const overlap=mailForm('new-overlap',`Hi team, quoting your guide: ${paragraph} Is that still right?`)
 const ovl=await submit(overlap);assert.equal(ovl.status,200);assert.equal(ovl.data.state,'delivered');const c=ovl.data.conversationId
 await capture('overlap')
 assert.equal((await submit(overlap)).status,403,'an identical signed form is refused')
 const replay=await submit(mailForm('new-overlap',`Hi team, quoting your guide: ${paragraph} Is that still right?`,{messageId:overlap.id}))
 assert.equal(replay.status,200);assert.equal(replay.data.duplicate,true)
 await capture('replay');assert.deepEqual(snapshots.replay,snapshots.overlap)
 const normalReads=async()=>{
  for(const id of [a,b,c]){assert.equal((await call(`/api/dashboard/projects/${p}/conversations/${id}`,{status:200})).data.data.id,id);await read(id)}
  const inbox=(await call(`/api/dashboard/projects/${p}/conversations?page=1`,{status:200})).data.data
  for(const id of [a,b,c])assert.ok(inbox.some(row=>row.id===id))
  for(const [sender,id] of [[senders.control,a],[senders['preexisting-overlap'],b],[senders['new-overlap'],c]]){
   const results=(await call(`/api/dashboard/projects/${p}/conversations?q=${encodeURIComponent(sender)}`,{status:200})).data.data
   assert.deepEqual(results.map(row=>row.id),[id])
  }
  assert.equal((await read(b)).messages[0].content,`Hello, I read this somewhere: ${paragraph} Can you explain it?`,'pre-publication history remains literal')
 }
 await normalReads();await capture('reads')
 const ovlLocal=await reply(a,'ovl',`Here is the answer from our guide: ${paragraph}`)
 const harmLocal=await reply(b,'harm',harmless)
 await capture('replies')
 for(const [key,added] of Object.entries({conversations:3,contacts:3,inboundEmails:3,messages:6,customerMessages:3}))assert.equal(snapshots.replies[key]-snapshots.before[key],added,key+' matches the public mutations')
 assert.equal(snapshots.replies.messages-snapshots.overlap.messages,2)
 assert.equal(snapshots.replies.customerMessages-snapshots.overlap.customerMessages,0)
 assert.equal(snapshots.replies.suspended-snapshots.before.suspended,0)
 assert.equal(snapshots.replies.replyBlocks-snapshots.before.replyBlocks,2)
 assert.equal(snapshots.replies.indexDirty,0)
 const indexedWords=[articleInput.title,articleInput.content,articleInput.summary].join(' ').split(/\s+/)
 assert.equal(snapshots.replies.shingles-snapshots.before.shingles,indexedWords.length-11)
 assert.equal(snapshots.replies.deliveries-snapshots.before.deliveries,3)
 assert.equal(snapshots.replies.replyGrants-snapshots.before.replyGrants,2)
 for(const [scenario,mail,id,localId,messages] of [['control',control,a,ctlLocal,3],['preexisting-overlap',preexisting,b,null,2],['new-overlap',overlap,c,null,1],['overlap-reply',control,a,ovlLocal,3],['harmless-reply',preexisting,b,harmLocal,2]]){
  const facts=await receipt(scenario,mail,{conversationId:id,...(localId?{localId}:{})})
  assert.equal(facts.inboundRows,1);assert.equal(facts.customerMessages,1);assert.equal(facts.senderConversations,1);assert.equal(facts.conversationMessages,messages);assert.equal(facts.savedReplies,localId?1:0)
  assert.deepEqual(facts.receipts,[{state:'delivered',errorCategory:'none',hasConversation:true,hasMessage:true,conversationMessages:messages}])
  const until=Date.now()+10000
  while(facts.deliveries.some(d=>d.state==='sending')&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,50));facts.deliveries=(await receipt(scenario,mail,{conversationId:id,...(localId?{localId}:{})})).deliveries}
  assert.ok(facts.deliveries.length>0)
  assert.equal(facts.deliveries.reduce((sum,row)=>sum+row.count,0),3)
  assert.ok(facts.deliveries.every(d=>d.state==='sent'&&d.errorCategory==='none'),'only the fake provider, reached by real delivery, may report sent')
 }
 const first=await receipt('new-overlap',overlap,{conversationId:c})
 await normalReads();assert.deepEqual(await receipt('new-overlap',overlap,{conversationId:c}),first)
 await capture('repeated');assert.deepEqual(snapshots.repeated,snapshots.replies,'ordinary reads and diagnostic reads cause no count delta')
 console.log('C2 project phase counts',JSON.stringify(snapshots))
 return {p,token,door,base,control,preexisting,overlap,a,b,c,article,receipt,counts,started,snapshots}
}
