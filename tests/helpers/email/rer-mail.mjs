import {createDecipheriv} from 'node:crypto'
import {canonical} from './rer-edge.mjs'
import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {managedEdge,ingressOptions,inboundPath,mime} from './rer-edge.mjs'
export async function managedInstallation(name='a',{edge=managedEdge(),bindings={},listen=false}={}){
 const assigned=edge.add(name),app=await startApp({captureQueue:true,listen,bindings:{...assigned,RATE_LIMITS:JSON.stringify({projectsPerAccountDay:100,projectsPerIpDay:100,registrationsPerIpDay:100}),...bindings},outbound:(...args)=>edge.outbound(...args)})
 const owner=(await app.call('/api/identity/bootstrap',{body:{email:`owner-${name}@example.test`,password:'synthetic-owner-password-123',name:'Northstar Outfitters',allowedOrigin:'https://northstar.example.test',setupToken:assigned.H2H_SETUP_TOKEN},status:201})).data
 const settings=()=>app.ok(`/api/management/projects/${owner.projectId}/email-settings`,{token:owner.token})
 return {app,edge,assigned,owner,settings,close:()=>app.close(),ingress:(raw,metadata={},overrides={})=>app.call(inboundPath,ingressOptions(assigned,raw,{workspaceId:owner.projectId,...metadata},overrides))}
}
export async function rerMailJourney(){
 const i=await managedInstallation(),{app,edge,owner,assigned}=i
 try{
  const state=await i.settings();assert.equal(state.managed.routeActive,true);assert.equal(state.managed.observed,false)
  assert.equal((await i.ingress(mime(),{}, {key:'synthetic-foreign-signing-authority'})).status,403)
  assert.equal((await i.ingress(mime(),{timestamp:Date.now()-600000})).status,403)
  assert.equal((await i.ingress(mime(),{workspaceId:'foreign-workspace'})).status,403)
  assert.equal((await i.ingress(mime(),{generation:2})).status,403)
  assert.equal((await i.ingress(mime(),{envelopeTo:'hth-other@mail.example.test'})).status,403)
  assert.equal((await i.ingress(mime(),{}, {body:mime({text:'Tampered'})})).status,403)
  const signed=ingressOptions(assigned,mime(),{workspaceId:owner.projectId})
  for(const [field,value] of Object.entries({version:2,deliveryId:'synthetic-tampered',mailboxId:'synthetic-foreign',workspaceId:'foreign',generation:2,envelopeFrom:'forged@example.test',envelopeTo:'hth-foreign@mail.example.test',verdict:'failed',timestamp:Date.now()+1000,bodySha256:'0'.repeat(64)})){
   const metadata=JSON.parse(Buffer.from(signed.headers['X-RER-Mail-Metadata'],'base64url'));metadata[field]=value
   const tampered={...signed,headers:{...signed.headers,'X-RER-Mail-Metadata':Buffer.from(canonical(metadata)).toString('base64url')}}
   assert.equal((await app.call(inboundPath,tampered)).status,403,field+' must be authenticated')
  }
  assert.equal((await app.call(inboundPath+'?token=synthetic-not-a-query-credential',signed)).status,403)
  assert.equal((await app.first('SELECT count(*) n FROM rer_mail_ingress')).n,0)
  const received=await i.ingress(mime());assert.equal(received.status,200,JSON.stringify(received.data));assert.ok(received.data.conversationId)
  const receipt=await app.first('SELECT * FROM rer_mail_ingress');const rawBytes=Buffer.from(await (await (await app.files).get(receipt.raw_key)).arrayBuffer());const m=JSON.parse(receipt.metadata_json),decipher=createDecipheriv('aes-256-gcm',Buffer.from(assigned.INTEGRATION_ENCRYPTION_KEY,'base64'),rawBytes.subarray(0,12));decipher.setAAD(Buffer.from(canonical([m.workspaceId,m.mailboxId,m.deliveryId,m.bodySha256])));decipher.setAuthTag(rawBytes.subarray(-16));assert.equal(Buffer.concat([decipher.update(rawBytes.subarray(12,-16)),decipher.final()]).toString(),mime(),'exact raw bytes persist privately before acknowledgment')
  const duplicate=await i.ingress(mime());assert.equal(duplicate.data.duplicate,true);assert.equal((await app.first('SELECT count(*) n FROM conversations')).n,1)
  const changed=await i.ingress(mime({text:'Changed under the same identity'}));assert.equal(changed.data.state,'held');assert.equal((await app.first('SELECT body_sha256 FROM rer_mail_ingress WHERE delivery_id=?',receipt.delivery_id)).body_sha256,receipt.body_sha256);assert.ok((await (await app.files).get(receipt.raw_key)).size>0);assert.equal((await app.first('SELECT count(*) n FROM conversations')).n,1)
  assert.equal((await app.first("SELECT count(*) n FROM suspended_emails WHERE reason='message_identity_conflict'")).n,1)
  const forgedMime=mime({id:'synthetic-unproven',headers:'Authentication-Results: forged.example; dkim=pass; dmarc=pass\r\n'})
  assert.equal((await i.ingress(forgedMime,{deliveryId:'synthetic-unproven',verdict:'unproven'})).data.state,'suspended')
  assert.equal((await i.ingress(mime({id:'synthetic-failed'}),{deliveryId:'synthetic-failed',verdict:'failed'})).data.state,'suspended')
  assert.equal((await app.first('SELECT count(*) n FROM conversations')).n,1)
  const conversationId=received.data.conversationId
  const upload=await app.ok(`/api/conversations/${conversationId}/media`,{token:owner.token,raw:true,body:Buffer.from('synthetic attachment'),headers:{'Content-Type':'text/plain','X-Filename':'order.txt'}})
  const reply=async(localId,text='Here is your order update.',mediaIds=localId==='synthetic-managed-reply'?[upload.id]:[])=>{
   const head=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',conversationId)
   const result=await app.ok(`/api/conversations/${conversationId}/messages`,{token:owner.token,body:{localId,content:text,expectedRevision:head.revision,expectedLastMessageId:head.last_message_id,...(localId==='synthetic-managed-reply'?{cc:['copy@example.test'],bcc:['private-copy@example.test']} : {}),mediaIds}})
   await app.scheduled();await app.until(async()=>{const row=await app.first('SELECT state FROM email_deliveries WHERE id=?',`message:${result.message.id}:notification`);return row&&row.state!=='sending'},{message:'managed send outcome'});return result.message
  }
  const first=await reply('synthetic-managed-reply')
  const outgoing=edge.sends.find(row=>row.payload.text.includes('Here is your order update.'));assert.ok(outgoing)
  assert.deepEqual(outgoing.payload.to,['customer@example.test']);assert.deepEqual(outgoing.payload.cc,['copy@example.test']);assert.deepEqual(outgoing.payload.bcc,['private-copy@example.test']);assert.match(outgoing.payload.replyTo,/\+r\.[a-f0-9]{32}@mail\.example\.test$/)
  assert.equal(outgoing.payload.attachments[0].content,Buffer.from('synthetic attachment').toString('base64'))
  assert.ok(outgoing.payload.inReplyTo.includes('synthetic-message-1'))
  const delivery=await app.first('SELECT * FROM email_deliveries WHERE id=?',`message:${first.id}:notification`);assert.equal(delivery.state,'sent');assert.match(delivery.provider_id,/@mail\.example\.test>$/)
  assert.ok(await app.first('SELECT 1 FROM email_threading_keys WHERE key_value=? AND conversation_id=?',delivery.provider_id,conversationId));assert.equal((await app.first("SELECT count(*) n FROM email_threading_keys WHERE key_value LIKE '%happytohelp.invalid%'")).n,0)
  const back=await i.ingress(mime({id:'synthetic-threaded-followup',text:'Thank you!',headers:`In-Reply-To: ${delivery.provider_id}\r\n`}),{deliveryId:'synthetic-followup',envelopeTo:outgoing.payload.replyTo,verdict:'unproven'});assert.equal(back.data.conversationId,conversationId);assert.equal(back.data.state,'delivered')
  const uploadLarge=async(filename,size)=>app.ok(`/api/conversations/${conversationId}/media`,{token:owner.token,raw:true,body:Buffer.alloc(size,65),headers:{'Content-Type':'application/octet-stream','X-Filename':filename}})
  const large=await uploadLarge('oversized.bin',9*1024*1024),included=[]
  for(const filename of ['included-one.bin','included-two.bin','over-total.bin'])included.push(await uploadLarge(filename,7*1024*1024))
  await reply('synthetic-bounded-files','Here are your retained order files.',[large.id,...included.map(file=>file.id)])
  const fileSend=edge.sends.find(row=>row.payload.text.includes('Here are your retained order files.'));assert.ok(fileSend,JSON.stringify(await app.sql('SELECT state,error FROM email_deliveries ORDER BY created_at DESC LIMIT 2')));const bounded=fileSend.payload
  assert.deepEqual(bounded.attachments.map(file=>file.filename),['included-one.bin','included-two.bin'])
  assert.match(bounded.text,/Not attached: oversized.bin/);assert.match(bounded.text,/Not attached: over-total.bin/)
  const links=[...bounded.text.matchAll(/https:\/\/[^\s]+\/api\/integrations\/email\/files\/[^\s]+/g)].map(match=>new URL(match[0]).pathname)
  assert.equal(links.length,2)
  const linked=await app.request(links[0]);assert.equal(linked.status,200);assert.equal((await linked.arrayBuffer()).byteLength,9*1024*1024)
  assert.equal((await app.request(links[0].replace(/[^/]+$/,'invalid'))).status,404)
  console.log(JSON.stringify({proof:'managed-attachment-limits',includedFiles:bounded.attachments.map(file=>file.filename),omittedFiles:['oversized.bin','over-total.bin'],authorizedLinks:links.length,serializedBytes:Buffer.byteLength(JSON.stringify(bounded))}))
  edge.loseResponse=true
  const lost=await reply('synthetic-managed-lost','This response will be lost.')
  assert.equal((await app.first('SELECT state FROM email_deliveries WHERE id=?',`message:${lost.id}:notification`)).state,'uncertain')
  const count=edge.sends.length;await app.db.prepare('UPDATE conversation_outbox SET delivered_at=NULL WHERE message_id=?').bind(lost.id).run();await app.scheduled();assert.equal(edge.sends.length,count,'uncertain commands never redispatch')
  const observed=await i.settings();assert.equal(observed.managed.observed,true);assert.ok(observed.managed.lastInboundAt);assert.ok(observed.managed.lastOutboundAcceptanceAt);assert.equal(observed.managed.outbound.state,'uncertain')
  await app.ok(`/api/management/projects/${owner.projectId}/email-settings/managed/reconcile`,{token:owner.token,body:{deliveryId:`message:${lost.id}:notification`}});assert.equal(edge.sends.length,count);assert.equal((await i.settings()).managed.outbound.state,'accepted')
  const auditOwner=await app.first('SELECT id FROM users WHERE email=?','owner-a@example.test')
  const audit=await app.sql("SELECT action,actor_type,actor_id,target_id,detail_json FROM audit_events WHERE project_id=? AND action LIKE 'managed_mail.%'",owner.projectId)
  for(const action of ['managed_mail.send_started','managed_mail.send_accepted','managed_mail.send_uncertain','managed_mail.reconciled'])assert.ok(audit.some(row=>row.action===action),action)
  assert.ok(audit.some(row=>row.action==='managed_mail.reconciled'&&row.actor_type==='user'&&row.actor_id===auditOwner.id&&row.target_id===`message:${lost.id}:notification`))
  assert.ok(!JSON.stringify(audit).includes(assigned.MAIL_API_KEY));assert.ok(!JSON.stringify(audit).includes('customer@example.test'))
 }finally{await i.close()}
}
