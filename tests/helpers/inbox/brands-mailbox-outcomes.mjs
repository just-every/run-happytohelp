import assert from 'node:assert/strict'
import PostalMime from 'postal-mime'
import {startApp} from '../../journeys/kit/app.mjs'

// Two real OAuth/credential stores; only Google's HTTP boundary is synthetic.
// Protocol behavior belongs to MAIL-001's mailboxProviderJourney. This proves
// that a brand cannot select, expose, reconnect or change the other's authority.
export async function brandMailboxOutcomes(){
 const accounts=new Map(['Alpha','Beta'].map(label=>[label,{label,address:`oauth@${label.toLowerCase()}.example.test`,access:`brand-${label}-access`,refresh:`brand-${label}-refresh`}]))
 const sent=[],effects=[]
 const app=await startApp({captureQueue:true,bindings:{H2H_SETUP_TOKEN:'synthetic-brand-owner-claim',APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'brand-installation-key',EMAIL_FROM:'support@installation.example.test',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,11).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'brand-client',GOOGLE_MAIL_CLIENT_SECRET:'brand-client-secret'},outbound:async request=>{
  const url=new URL(request.url)
  if(url.hostname==='api.resend.com')return Response.json({id:'brand-owner-welcome'})
  if(url.hostname==='oauth2.googleapis.com'){
   assert.equal(url.pathname,'/token')
   const form=new URLSearchParams(await request.text()),account=accounts.get(form.get('code'))
   assert.ok(account);assert.ok(form.get('code_verifier'))
   effects.push('authorize:'+account.label)
   return Response.json({access_token:account.access,refresh_token:account.refresh,expires_in:3600,token_type:'Bearer'})
  }
  assert.equal(url.hostname,'gmail.googleapis.com','unexpected network access is forbidden')
  const account=[...accounts.values()].find(row=>request.headers.get('Authorization')==='Bearer '+row.access)
  assert.ok(account,'the provider receives only one brand’s installed credential')
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:account.address,historyId:'1'})
  if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:account.address,isPrimary:true,isDefault:true,verificationStatus:'accepted'}]})
  assert.ok(url.pathname.endsWith('/messages/send'))
  sent.push({label:account.label,mail:await PostalMime.parse(Buffer.from((await request.json()).raw,'base64url'))})
  effects.push('send:'+account.label)
  return Response.json({id:'brand-sent-'+sent.length})
 }})
 try{
  // Both configured workspaces are provisioned through public identity/management doors.
  const email='brands-mailboxes@example.test',password='synthetic-brand-mailbox-password'
  const initial=await app.ok('/api/identity/bootstrap',{body:{email,password,name:'OAuth Alpha',allowedOrigin:'https://alpha.example.test',setupToken:'synthetic-brand-owner-claim'}})
  const owner=(await app.ok('/api/identity/login',{body:{email,password}})).token
  const beta=await app.ok('/api/management/projects',{token:owner,body:{name:'OAuth Beta',allowed_origin:'https://beta.example.test'}})
  const brands=[]
  for(const [projectId,label] of [[initial.projectId,'Alpha'],[beta.id,'Beta']]){
   const token=(await app.ok('/api/identity/switch-project',{token:owner,body:{projectId}})).token
   const manage=`/api/management/projects/${projectId}`
   const connect=await app.ok(manage+'/mailboxes/connect',{token,body:{provider:'gmail',displayName:label+' Care'}})
   const state=new URL(connect.url).searchParams.get('state')
   assert.equal((await app.call(`/api/management/mailboxes/oauth/gmail/callback?state=${state}&code=${label}`,{token})).status,302)
   const boxes=(await app.ok(manage+'/mailboxes',{token})).data
   const box=boxes.find(row=>row.provider==='gmail')
   assert.ok(box);assert.equal(box.address,accounts.get(label).address)
   await app.ok(manage+`/mailboxes/${box.id}/signatures/default`,{token,method:'PUT',body:{text:label+' OAuth signature'}})
   const project=await app.ok('/api/identity/projects/'+projectId,{token})
   const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:project.widget_key,name:'Mailbox customer',email:'mailbox-customer@example.test'}})
   const ticket=await app.ok('/api/conversations',{token:visitor.token,body:{projectId}})
   brands.push({projectId,label,token,manage,box,ticket})
  }
  const selected=brands.map(row=>row.projectId).join(',')
  const manifest=await app.ok(brands[0].manage+'/brands?projects='+selected,{token:owner})
  for(const account of accounts.values())for(const secret of [account.access,account.refresh,'brand-client-secret']){
   assert.ok(!JSON.stringify(manifest).includes(secret),'combined configuration never exposes mailbox credentials')
   for(const brand of brands)assert.ok(!JSON.stringify(await app.ok(brand.manage+'/mailboxes',{token:brand.token})).includes(secret),'individual lists never expose credentials')
  }
  for(const [own,foreign] of [[brands[0],brands[1]],[brands[1],brands[0]]]){
   const beforeEffects=effects.length
   for(const [method,tail,body] of [
    ['PATCH','',{displayName:'Wrong brand',senderAddress:foreign.box.address}],
    ['PUT','/signatures/default',{text:'Wrong brand signature'}],
    ['POST','/reconnect',{}],['DELETE','',undefined],
   ])assert.equal((await app.call(own.manage+`/mailboxes/${foreign.box.id}`+tail,{token:own.token,method,body})).status,404)
   const before=await app.ok(`/api/conversations/${own.ticket.id}/messages`,{token:own.token})
   const denied=await app.call(`/api/conversations/${own.ticket.id}/messages`,{token:own.token,body:{localId:'foreign-mailbox',content:'Never send with foreign authority',mailboxId:foreign.box.id,expectedRevision:before.revision}})
   assert.equal(denied.status,409)
   assert.match(denied.data.error,/mailbox|connect/i)
   assert.equal((await app.ok(`/api/conversations/${own.ticket.id}/messages`,{token:own.token})).revision,before.revision)
   assert.equal(effects.length,beforeEffects,'wrong-brand operations never contact a provider')
   const answer=await app.ok(`/api/conversations/${own.ticket.id}/messages`,{token:own.token,body:{localId:'own-mailbox',content:own.label+' authorized answer',mailboxId:own.box.id,expectedRevision:before.revision}})
   assert.equal(answer.accepted,true)
   await app.drainJobs()
   await app.until(()=>sent.some(copy=>copy.label===own.label),{message:'own credential sends own brand answer'})
   const copy=sent.find(row=>row.label===own.label)
   assert.equal(copy.mail.from.address,accounts.get(own.label).address)
   assert.ok(copy.mail.text.includes(own.label+' OAuth signature'))
   assert.ok(copy.mail.text.includes(own.label+' authorized answer'))
   assert.notEqual(copy.mail.from.address,accounts.get(foreign.label).address)
   assert.ok(!copy.mail.text.includes(foreign.label+' OAuth signature'))
   const retained=(await app.ok(foreign.manage+'/mailboxes',{token:foreign.token})).data.find(row=>row.id===foreign.box.id)
   assert.equal(retained.status,'connected')
   assert.equal(retained.display_name,foreign.label+' Care')
   assert.ok(retained.signatures.some(signature=>signature.text===foreign.label+' OAuth signature'))
  }
  assert.deepEqual(effects,['authorize:Alpha','authorize:Beta','send:Alpha','send:Beta'])
 }finally{await app.close()}
}
