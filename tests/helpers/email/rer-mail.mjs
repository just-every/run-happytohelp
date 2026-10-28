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
 const edge=managedEdge(),i=await managedInstallation('mail-lifecycle',{edge}),{app,owner,assigned}=i
 const token=owner.token,project=owner.projectId,base=`/api/management/projects/${project}`,status=id=>app.ok(`/api/dashboard/projects/${project}/conversations/${id}/buckets/${id}`,{token})
 try{
  assert.equal((await i.settings()).managed.routeActive,true)
  const raw=mime()
  assert.equal((await i.ingress(raw,{}, {key:'synthetic-foreign-authority'})).status,403)
  assert.equal((await i.ingress(raw,{timestamp:Date.now()-600000})).status,403)
  assert.equal((await i.ingress(raw,{workspaceId:'another-workspace'})).status,403)
  assert.equal((await i.ingress(raw,{}, {body:mime({text:'Tampered content'})})).status,403)
  const received=await i.ingress(raw);assert.equal(received.status,200)
  const id=received.data.conversationId,path=`/api/conversations/${id}/messages`,transcript=()=>app.ok(path,{token})
  assert.equal((await i.ingress(raw)).data.duplicate,true);assert.equal((await transcript()).messages.length,1)
  const changed=await i.ingress(mime({text:'Conflicting redelivery'}));assert.equal(changed.data.state,'held')
  assert.equal((await app.ok(base+'/suspended',{token})).count,1)
  assert.equal((await transcript()).messages.length,1,'a changed identity cannot overwrite accepted customer content')
  const attachment=await app.ok(`/api/conversations/${id}/media`,{token,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'order.txt'},body:'Order tracking bytes'})
  const reply=async(content,mediaIds=[])=>{const current=await transcript();const result=await app.ok(path,{token,body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId,mediaIds}});await app.scheduled();return result.message}
  const outcome=async message=>(await status(id)).data.messages.find(m=>m.id===message.id).email_status.state
  const first=await reply('Here is your replacement tracking.',[attachment.id])
  await app.until(async()=>await outcome(first)==='sent',{message:'managed reply accepted'})
  const wire=edge.sends.find(s=>s.payload.text.includes('replacement tracking'));assert.ok(wire)
  assert.deepEqual(wire.payload.to,['customer@example.test']);assert.equal(wire.payload.attachments[0].content,Buffer.from('Order tracking bytes').toString('base64'))
  assert.ok(wire.payload.inReplyTo.includes('synthetic-message-1'));assert.ok(wire.payload.replyTo.includes('+r.'))
  const back=await i.ingress(mime({id:'followup',text:'Thank you. Can you check the delivery date?'}),{deliveryId:'followup',envelopeTo:wire.payload.replyTo,verdict:'unproven'})
  assert.equal(back.data.conversationId,id);assert.equal(back.data.state,'delivered','possession of the issued reply address speaks only for its recipient')

  // Authentication refusal proves no send was accepted. The same held command survives an
  // old-release restart and only a release with the new credential may resume it.
  const rotated='synthetic-rotated-mail-authority',installation=edge.installations.get(assigned.MAIL_API_KEY)
  edge.installations.delete(assigned.MAIL_API_KEY);edge.installations.set(rotated,installation)
  const held=await reply('Your delivery date is Friday.')
  await app.until(async()=>await outcome(held)==='sending',{message:'rotated credential held'})
  const heldCount=edge.sends.length
  await app.configure({});await app.scheduled();assert.equal(edge.sends.length,heldCount,'authentication refusals never enter the provider send ledger')
  assert.equal(await outcome(held),'sending')
  await app.configure({MAIL_API_KEY:rotated});await app.scheduled()
  await app.until(async()=>await outcome(held)==='sent',{message:'rebuilt release resumes held reply'})
  const resumed=edge.sends.filter(s=>s.payload.text.includes('Your delivery date is Friday.'));assert.equal(resumed.length,1)
  const attempts=edge.sends.length;await app.scheduled();assert.equal(edge.sends.length,attempts)

  // Acceptance with a lost response stays unknown. Operator reconciliation reads the provider's
  // exact receipt and never sends the customer message again, including after restart.
  edge.loseResponse=true
  const unknown=await reply('The tracking link is now active.')
  await app.until(async()=>await outcome(unknown)==='uncertain',{message:'unknown managed outcome'})
  const accepted=edge.sends.length;edge.loseResponse=false
  await app.configure({});await app.scheduled();assert.equal(edge.sends.length,accepted)
  assert.equal((await i.settings()).managed.outbound.state,'uncertain')
  const commandId=`message:${unknown.id}:notification`
  await app.ok(base+'/email-settings/managed/reconcile',{token,body:{deliveryId:commandId}})
  assert.equal(edge.sends.length,accepted);assert.equal((await i.settings()).managed.outbound.state,'accepted')
  const audit=(await app.ok(base+'/audit?limit=200',{token})).data
  assert.ok(audit.some(e=>e.action==='managed_mail.send_held'));assert.ok(audit.some(e=>e.action==='managed_mail.reconciled'&&e.target_id===commandId))
  assert.doesNotMatch(JSON.stringify(audit),new RegExp(assigned.MAIL_API_KEY))
 }finally{await i.close()}
}
