import assert from 'node:assert/strict'
import {generate} from '../../move-in/generator.mjs'
import {completeMailEdge,customerMime} from './complete-mail-edge.mjs'
import {validateRuntimeEnvironment,runtimeVariables,runtimeSecrets} from '../../../scripts/deployment/environment.mjs'

// Official-schema HTTP-edge proof only. No account API, real key or live send:
// https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages
// https://documentation.mailgun.com/docs/mailgun/user-manual/api-key-mgmt/rbac-mgmt
export async function mailgunJourney(){
 const configured={EMAIL_PROVIDER:'mailgun',EMAIL_API_KEY_NAME:'MAILGUN_SENDING_KEY',MAILGUN_SENDING_KEY:'synthetic-hh-sending-secret',MAILGUN_DOMAIN:'mg.support.example',MAILGUN_REGION:'us',EMAIL_FROM:'support@support.example'}
 const wires=[]
 let responseMode='accepted'
 const m=await completeMailEdge('forwarding',{outbound:async request=>{
  const url=new URL(request.url)
  if(!['api.mailgun.net','api.eu.mailgun.net'].includes(url.hostname))return
  assert.equal(request.method,'POST')
  assert.equal(url.pathname,'/v3/'+configured.MAILGUN_DOMAIN+'/messages')
  assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from('api:'+configured.MAILGUN_SENDING_KEY).toString('base64'))
  assert.match(request.headers.get('content-type'),/^multipart\/form-data; boundary=/)
  const body=await request.formData(),id='<synthetic-hh-'+(wires.length+1)+'@mg.support.example>'
  wires.push({url,body,id})
  if(responseMode==='rejected')return Response.json({message:'Provider refused synthetic-hh-sending-secret'},{status:403})
  if(responseMode==='rate-limited')return Response.json({message:'Rate limited'},{status:429})
  if(responseMode==='server-error')return Response.json({message:'Unknown result'},{status:503})
  if(responseMode==='lost')throw new Error('Synthetic response lost after acceptance')
  if(responseMode==='missing-id')return Response.json({message:'Queued. Thank you.'})
  if(responseMode==='redirect')return new Response(null,{status:307,headers:{Location:'https://untrusted.example/messages'}})
  return Response.json({id,message:'Queued. Thank you.'})
 }})
 console.log('PROBE Mailgun: native workspace and forwarding mailbox ready')
 const {app,token,projectId,ok}=m,foreign=await app.seedWorkspace('synthetic-mailgun-foreign'),settings=m.base+'/email-settings'
 try{
  // Runtime/deployment consume the same named secret, without copying it into
  // EMAIL_API_KEY or treating a name or an unrelated Routes key as a credential.
  validateRuntimeEnvironment(configured)
  assert.equal(runtimeVariables(configured).EMAIL_API_KEY_NAME,'MAILGUN_SENDING_KEY')
  assert.equal(runtimeSecrets(configured).MAILGUN_SENDING_KEY,configured.MAILGUN_SENDING_KEY)
  assert.equal(runtimeSecrets(configured).EMAIL_API_KEY,undefined)
  await app.configure({...configured,EMAIL_API_KEY:'synthetic-hh-unrelated-key',MAILGUN_ROUTES_KEY:'synthetic-hh-unrelated-routes'})
  assert.equal((await ok(settings)).sending.provider,'mailgun')
  assert.equal(wires.length,0,'configuration alone never sends')
  const verify=idempotencyKey=>app.call(settings+'/test',{token,body:{idempotencyKey}})
  const invalid=[
   {EMAIL_API_KEY_NAME:undefined},{EMAIL_API_KEY_NAME:'UNKNOWN_SENDING_KEY'},{EMAIL_API_KEY_NAME:'EMAIL_API_KEY'},{EMAIL_API_KEY_NAME:'MAILGUN_ROUTES_KEY'},
   {MAILGUN_SENDING_KEY:undefined},{MAILGUN_SENDING_KEY:''},{MAILGUN_SENDING_KEY:42},
   {MAILGUN_DOMAIN:undefined},{MAILGUN_DOMAIN:''},{MAILGUN_DOMAIN:'https://mg.support.example'},{MAILGUN_DOMAIN:'mg.support.example/other'},{MAILGUN_DOMAIN:'-invalid.example'},
   {MAILGUN_REGION:'other'},
  ]
  for(const [index,patch]of invalid.entries()){
   assert.throws(()=>validateRuntimeEnvironment({...configured,...patch}))
   await app.configure({...configured,...patch})
   assert.equal((await ok(settings)).configured,false)
   const before=wires.length,refused=await verify('synthetic-hh-invalid-'+index)
   assert.equal(refused.status,503)
   assert.equal(wires.length,before,'unavailable configuration cannot call any provider')
  }
  console.log('PROBE POINT2: missing/unknown key names, unavailable key, domain and region errors refused before sending')
  await app.configure({...configured,MAILGUN_REGION:undefined})
  const first=await verify('synthetic-hh-owner-verification')
  assert.equal(first.status,200);assert.equal(first.data.state,'sent');assert.equal(first.data.id,wires.at(-1).id)
  assert.equal(wires.at(-1).url.hostname,'api.mailgun.net','unspecified region uses US')
  const beforeDuplicate=wires.length
  assert.equal((await verify('synthetic-hh-owner-verification')).data.id,first.data.id)
  assert.equal(wires.length,beforeDuplicate,'durable send identity prevents duplicate provider effects')
  assert.equal((await app.call(settings+'/test',{body:{idempotencyKey:'synthetic-hh-anonymous'}})).status,401)
  assert.equal((await app.call(settings+'/test',{token:foreign.tokens.owner,body:{idempotencyKey:'synthetic-hh-cross-tenant'}})).status,403)
  assert.equal(wires.length,beforeDuplicate)
  await app.configure({...configured,MAILGUN_REGION:'eu'})
  await m.deliver(customerMime(m,{id:'synthetic-mailgun-first'}));await app.drainJobs()
  const id=(await ok('/api/conversations')).conversations[0].id,path='/api/conversations/'+id,dashboard='/api/dashboard/projects/'+projectId+'/conversations/'+id
  const commands=new Map()
  const reply=async(localId,content,extra={})=>{
   if(!commands.has(localId)){
    const head=await ok(path+'/messages')
    commands.set(localId,{localId,content,mailboxId:m.box.id,expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId,...extra})
   }
   return ok(path+'/messages',commands.get(localId))
  }
  const bucket=async()=>(await ok(dashboard+'/buckets/'+id)).data
  const status=async(messageId)=>(await bucket()).messages.find(row=>row.id===messageId)?.email_status?.state
  const file=await app.ok(path+'/media',{token,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'return-label.txt'},body:'Synthetic return label bytes'})
  const before=wires.length,sent=await reply('synthetic-mailgun-owner-reply','Your replacement ships today.',{cc:['finance@customer.example'],bcc:['archive@support.example'],mediaIds:[file.id]})
  await app.until(async()=>await status(sent.message.id)==='sent',{message:'Mailgun inbox acceptance'})
  assert.equal(wires.length,before+1)
  const wire=wires.at(-1),form=wire.body
  assert.equal(wire.url.hostname,'api.eu.mailgun.net')
  assert.equal(form.get('from'),'Parcel Support <forwarding@support.example>')
  assert.deepEqual(form.getAll('to'),['customer@customer.example'])
  assert.deepEqual(form.getAll('cc'),['finance@customer.example'])
  assert.deepEqual(form.getAll('bcc'),['archive@support.example'])
  assert.match(form.get('subject'),/A damaged parcel/)
  assert.match(form.get('text'),/Your replacement ships today\./)
  assert.match(form.get('text'),/Parcel Support team/)
  assert.match(form.get('html'),/Your replacement ships today\./)
  assert.equal(form.get('h:In-Reply-To'),'<synthetic-mailgun-first@customer.example>')
  assert.equal(form.get('h:References'),'<synthetic-mailgun-first@customer.example>')
  assert.ok(form.get('h:Message-ID'))
  assert.ok(form.get('h:Reply-To').startsWith('forwarding+r.'))
  const attachment=form.get('attachment')
  assert.equal(attachment.name,'return-label.txt');assert.equal(attachment.type,'text/plain')
  assert.equal(await attachment.text(),'Synthetic return label bytes')
  assert.equal((await app.first('SELECT provider_id FROM email_deliveries WHERE id=?','message:'+sent.message.id+':notification')).provider_id,wire.id)
  console.log('PROBE POINT1: owner inbox reply reaches Mailgun EU multipart HTTP edge with named key, support From, recipients, thread headers and attachment')
  const attempts=wires.length
  await reply('synthetic-mailgun-owner-reply','Your replacement ships today.');await app.drainJobs()
  assert.equal(wires.length,attempts)
  const denied=await app.call(path+'/messages',{token:foreign.tokens.owner,body:{...commands.get('synthetic-mailgun-owner-reply'),localId:'synthetic-mailgun-denied'}})
  assert.equal(denied.status,404,'the native ticket door hides another tenant’s conversation');assert.equal(wires.length,attempts)
  await m.deliver(customerMime(m,{id:'synthetic-mailgun-follow',to:form.get('h:Reply-To'),subject:'Changed subject',headers:'In-Reply-To: '+form.get('h:Message-ID')+'\r\n'}),{envelopeTo:form.get('h:Reply-To')})
  await app.drainJobs()
  assert.equal((await ok('/api/conversations')).conversations.length,1)
  assert.equal((await ok(path+'/messages')).messages.at(-1).actor_role,'contact')
  // Public inbox status and its stored outcome agree; none of these terminal
  // commands can be replayed by retrying the owner door or the ordinary queue.
  for(const [mode,expected]of [['rejected','failed'],['rate-limited','failed'],['server-error','uncertain'],['lost','uncertain'],['missing-id','uncertain'],['redirect','uncertain']]){
   responseMode=mode
   const prior=wires.length,failed=await reply('synthetic-mailgun-'+mode,'A distinct later answer '+mode)
   await app.until(async()=>await status(failed.message.id)===expected,{message:'Mailgun '+mode+' is '+expected})
   assert.equal(wires.length,prior+1)
   const identity=wires.at(-1).body.get('h:Message-ID'),commandAttempts=()=>wires.filter(wire=>wire.body.get('h:Message-ID')===identity).length
   assert.ok(identity);assert.equal(commandAttempts(),1)
   const rows=await app.sql('SELECT state,provider_id,error FROM email_deliveries WHERE id=?','message:'+failed.message.id+':notification')
   assert.equal(rows[0].state,expected);assert.equal(rows[0].provider_id,null)
   assert.ok(!JSON.stringify(rows).includes(configured.MAILGUN_SENDING_KEY))
   responseMode='accepted'
   await reply('synthetic-mailgun-'+mode,'A distinct later answer '+mode);await app.drainJobs()
   await app.db.prepare('UPDATE conversation_outbox SET delivered_at=NULL WHERE message_id=?').bind(failed.message.id).run()
   await app.scheduled()
   assert.equal(commandAttempts(),1,mode+' never automatically replays this reply; separate queued notices keep their own identities')
   assert.deepEqual(await app.sql('SELECT state,provider_id,error FROM email_deliveries WHERE id=?','message:'+failed.message.id+':notification'),rows)
  }
  const beforeImport=wires.length,imports='/api/move-in/projects/'+projectId+'/imports'
  const uploaded=(await app.ok(imports+'?vendor=zendesk',{token,raw:true,body:generate('zendesk',1),headers:{'X-Import-Filename':'synthetic-history.jsonl','X-Import-Schema':'2.16','Content-Type':'application/octet-stream'}})).data
  await app.drainJobs()
  const reviewed=(await ok(imports+'/'+uploaded.id)).data
  assert.equal(reviewed.state,'ready');assert.equal(reviewed.plan.counts.rejected,0)
  await ok(imports+'/'+uploaded.id+'/apply',{fingerprint:reviewed.plan.fingerprint});await app.drainJobs()
  assert.equal((await ok(imports+'/'+uploaded.id)).data.state,'completed')
  await app.scheduled()
  assert.equal(wires.length,beforeImport,'imported history sends no email or notices through a configured Mailgun provider')
  console.log('PROBE POINT3: reviewed Zendesk history imported through the native door with no sends or notices')
  console.log('PROBE POINT2: rejected, rate-limited, server-error, lost-response, missing-receipt and redirect outcomes visible; retries never replay')
  console.log('PROBE POINT3: anonymous and foreign-tenant sends refused; native reply threading and duplicate protection retained')
  assert.equal(m.edge.attempts,0,'Mailgun never falls back to the previous Resend transport')
 }finally{await m.close()}
}
