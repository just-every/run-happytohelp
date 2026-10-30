import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {activationBrowserJourney} from './activation-browser.mjs'

const row=(data,id)=>data.steps.find(item=>item.id===id)
const modelKey='synthetic-activation-model',mailKey='synthetic-activation-mail'
const local={H2H_LOCAL:'true',APP_ORIGIN:'http://127.0.0.1:8787',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@installation.test'}
const hosted={H2H_LOCAL:undefined,APP_ORIGIN:'https://app.example',OPENAI_API_KEY:modelKey,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:mailKey}
const bootstrap={email:'owner@activation.test',password:'synthetic-activation-password',name:'Activation support',allowedOrigin:'https://activation.test',setupToken:'synthetic-activation-claim'}

// Only provider metadata, mail and DNS are faked. Clock aging changes stored
// observation times, never the state or result that the public routes produced.
export async function activationJourney(){
 const state={model:200,domain:200,event:'queued',uncertain:false},mail=[]
 const app=await startApp({captureQueue:true,origin:'http://127.0.0.1:8787',bindings:{...local,H2H_SETUP_TOKEN:bootstrap.setupToken},outbound:async request=>{
  const url=new URL(request.url)
  if(url.hostname==='api.openai.com'){assert.equal(request.method,'GET','checks never generate');return Response.json(state.model===200?{id:decodeURIComponent(url.pathname.split('/').at(-1))}:{error:'Rejected credential'},{status:state.model})}
  if(url.hostname==='api.sendgrid.com'){const body=await request.json();mail.push({subject:body.subject,text:body.content.find(c=>c.type==='text/plain').value});return new Response(null,{status:202,headers:{'x-message-id':'activation-grid'}})}
  if(url.hostname==='api.resend.com'){
   if(request.method==='POST'){mail.push(await request.json());if(state.uncertain)throw Error('Lost response after acceptance');return Response.json({id:'activation-mail-'+mail.length})}
   if(url.pathname==='/domains')return Response.json(state.domain===200?{data:[{id:'activation-domain',name:'activation.test'}],has_more:false}:{error:'Read permission missing'},{status:state.domain})
   if(url.pathname==='/domains/activation-domain')return Response.json({id:'activation-domain',name:'activation.test',status:'verified',records:['SPF','DKIM'].map(record=>({record,type:'TXT',name:record==='SPF'?'activation.test':'resend._domainkey.activation.test',value:record==='SPF'?'v=spf1 -all':'p=synthetic-public-key',status:'verified'}))})
   const sent=mail[Number(url.pathname.split('-').at(-1))-1];assert.ok(sent)
   return Response.json({id:url.pathname.split('/').at(-1),to:sent.to,from:sent.from,last_event:state.event})
  }
  if(url.hostname==='cloudflare-dns.com'){
   const name=url.searchParams.get('name'),value=name.startsWith('_dmarc.')?'v=DMARC1; p=none':name.startsWith('resend._domainkey.')?'v=DKIM1; p=synthetic-public-key':'v=spf1 -all'
   return Response.json({Status:0,Answer:[{type:16,data:JSON.stringify(value)}]})
  }
  throw Error('Unexpected activation network edge '+url.hostname)
 }})
 const responses=[],fingerprints=new Set()
 try{
  const owner=(await app.call('/api/identity/bootstrap',{body:bootstrap,status:201})).data
  const path=`/api/management/projects/${owner.projectId}/activation`
  const setup=async(suffix='',body)=>{const response=await app.call(path+suffix,{token:owner.token,body,status:200});responses.push(response.data);for(const receipt of await app.sql('SELECT fingerprint FROM activation_receipts'))fingerprints.add(receipt.fingerprint);return response.data.data}
  const tables=(await app.sql("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map(r=>r.name).filter(n=>!n.startsWith('_cf_')&&!n.startsWith('sqlite_'))
  const snapshot=()=>Promise.all(tables.map(async n=>(await app.sql('SELECT * FROM "'+n.replaceAll('"','""')+'"')).map(r=>JSON.stringify(r)).sort()))
  const pureRead=async()=>{const before=await snapshot(),calls=app.requests.length,data=await setup();assert.deepEqual(await snapshot(),before,'Setup GET writes no table');assert.equal(app.requests.length,calls,'Setup GET calls no provider');return data}
  const empty=await pureRead()
  assert.equal(empty.total,8);assert.equal(empty.done,0);assert.equal(empty.applicableTotal,5)
  assert.ok(empty.steps.every(s=>s.state==='not_checked'&&s.checkedAt===null))
  assert.equal(row(empty,'published_article').placement,'hidden');assert.equal(row(empty,'published_article').applicable,false)
  assert.equal(empty.facts.ceilings.source,'defaults')
  assert.equal(row(await setup('/test-mail',{}),'owner_mail').state,'pending')
  assert.equal(mail.length,0);assert.equal((await app.first('SELECT count(*) n FROM email_deliveries')).n,0,'suppression stores no delivery')
  assert.match(row(await setup(),'owner_mail').detail,/suppressed/)
  await app.configure(hosted)
  const configured=await pureRead();assert.equal(configured.done,0,'installed keys, defaults and starter preset are not observations')
  assert.equal(configured.facts.ai.keyInstalled,true)
  const roles=await app.seedWorkspace('activation-roles'),rolePath=`/api/management/projects/${roles.projectId}/activation`
  for(const token of [undefined,roles.tokens.operator,owner.token]){
   const denied=await app.call(rolePath+'/skip',{token,body:{step:'widget_seen',skipped:true}})
   assert.equal(denied.status,token?403:401)
  }
  const beforeSkip=app.requests.length
  const initial=(await app.call(rolePath,{token:roles.tokens.owner,status:200})).data.data
  const skipped=(await app.call(rolePath+'/skip',{token:roles.tokens.admin,body:{step:'widget_seen',skipped:true},status:200})).data.data
  assert.equal(app.requests.length,beforeSkip,'skip has no provider effects')
  assert.equal(row(skipped,'widget_seen').placement,'skipped');assert.equal(row(skipped,'widget_seen').applicable,false)
  assert.notEqual(row(skipped,'widget_seen').state,'done');assert.equal(skipped.done,initial.done);assert.equal(skipped.applicableTotal,initial.applicableTotal-1)
  await app.configure({})
  assert.deepEqual((await app.call(rolePath,{token:roles.tokens.owner,status:200})).data.data,skipped,'skip persists across restart and a different owner session')
  assert.equal(row(await setup(),'widget_seen').placement,'needs_you','skip is workspace-scoped')
  const undone=(await app.call(rolePath+'/skip',{token:roles.tokens.owner,body:{step:'widget_seen',skipped:false},status:200})).data.data
  assert.equal(row(undone,'widget_seen').placement,'needs_you');assert.equal(undone.applicableTotal,initial.applicableTotal)
  assert.deepEqual((await app.call(rolePath,{token:roles.tokens.admin,status:200})).data.data,undone,'undo persists on reload')
  const defaults=await setup('/check',{step:'spend_ceilings'})
  assert.equal(row(defaults,'spend_ceilings').state,'done')
  assert.deepEqual(defaults.facts.ceilings,{repliesPerProject:200,repliesPerInstallation:2000,spendUsdPerProject:10,contextRunsPerProject:500,resetUtc:'00:00',source:'defaults'})
  await app.configure({AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:7,spendUsdPerProject:2})})
  assert.equal(row(await setup(),'spend_ceilings').state,'unknown','changed runtime configuration invalidates its observation')
  const limits=await setup('/check',{step:'spend_ceilings'})
  assert.equal(row(limits,'spend_ceilings').state,'done');assert.deepEqual(limits.facts.ceilings,{...defaults.facts.ceilings,repliesPerProject:7,spendUsdPerProject:2,source:'installation'})
  for(const step of ['model_key','sender_dns']){
   const left=await setup('/skip',{step,skipped:true});assert.equal(row(left,step).placement,'skipped')
   const observed=await setup('/check',{step}),receipt=row(observed,step)
   assert.equal(receipt.state,'done');assert.equal(receipt.placement,'set');assert.equal(receipt.applicable,true)
   assert.ok(Date.now()-Date.parse(receipt.checkedAt)<60000,'fresh observation includes its time')
   assert.equal(observed.done,left.done+1);assert.equal(observed.applicableTotal,left.applicableTotal+1,'observation beats skip')
  }
  const widgetLeft=await setup('/skip',{step:'widget_seen',skipped:true})
  const widget=(await app.call('/api/identity/widget/session',{body:{widgetKey:empty.facts.widget.key},headers:{Origin:bootstrap.allowedOrigin},status:201})).data
  const conversation=(await app.call('/api/conversations',{token:widget.token,body:{projectId:owner.projectId},status:201})).data
  await app.call(`/api/conversations/${conversation.id}/widget-events`,{token:widget.token,headers:{Origin:bootstrap.allowedOrigin},body:{action:'pingActive',data:{opened:true}},status:200})
  const widgetSeen=await setup('/check',{step:'widget_seen'})
  assert.equal(row(widgetSeen,'widget_seen').state,'done');assert.equal(row(widgetSeen,'widget_seen').placement,'set');assert.equal(widgetSeen.done,widgetLeft.done+1);assert.equal(widgetSeen.applicableTotal,widgetLeft.applicableTotal+1)
  state.model=401
  for(const skipped of [false,true]){
   await setup('/skip',{step:'model_key',skipped})
   const failed=row(await setup('/check',{step:'model_key'}),'model_key')
   assert.equal(failed.state,'failed');assert.equal(failed.placement,'needs_you');assert.equal(failed.applicable,true)
  }
  state.model=200;await setup('/check',{step:'model_key'})
  const aged=Date.now()-16*60*1000
  await app.db.prepare("UPDATE activation_receipts SET checked_at=? WHERE project_id=? AND step_id IN ('model_key','sender_dns')").bind(aged,owner.projectId).run()
  const expired=await pureRead()
  for(const step of ['model_key','sender_dns']){assert.equal(row(expired,step).state,'unknown');assert.equal(row(expired,step).checkedAt,new Date(aged).toISOString());assert.match(row(expired,step).detail,/15 minutes/)}
  await setup('/check',{auto:true});const calls=app.requests.length;await setup('/check',{auto:true})
  assert.equal(app.requests.length,calls,'fresh auto observations do not repeat provider work');assert.equal(mail.length,0,'checks never send')
  state.domain=403;assert.equal(row(await setup('/check',{step:'sender_dns'}),'sender_dns').state,'unavailable');state.domain=200
  await app.configure({OPENAI_API_KEY:modelKey+'-rotated'})
  assert.equal(row(await pureRead(),'model_key').state,'unknown','key rotation invalidates observation')
  const accepted=await setup('/test-mail',{})
  assert.equal(row(accepted,'owner_mail').state,'pending');assert.equal(mail.length,1);assert.deepEqual(mail[0].to,[bootstrap.email])
  for(const event of ['sent','queued','delivered','bounced']){
   state.event=event
   assert.equal(row(await setup('/check',{step:'owner_mail'}),'owner_mail').state,event==='delivered'?'done':event==='bounced'?'failed':'pending')
  }
  state.uncertain=true;await app.configure({EMAIL_API_KEY:mailKey+'-uncertain'})
  assert.equal(row(await setup('/test-mail',{}),'owner_mail').state,'unknown')
  const sends=mail.length,delivery=await app.first("SELECT * FROM email_deliveries WHERE state='uncertain'")
  assert.ok(delivery);assert.equal(sends,2)
  for(const restart of [false,true]){
   if(restart)await app.configure({})
   await pureRead();await setup('/test-mail',{});await setup('/check',{step:'owner_mail'});await app.scheduled();await app.drainJobs()
   assert.equal(mail.length,sends,'same test request, reload, retry and restart never replay uncertain mail')
   assert.deepEqual(await app.first('SELECT * FROM email_deliveries WHERE id=?',delivery.id),delivery)
  }
  state.uncertain=false;await app.configure({EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:mailKey+'-unsupported'})
  const unsupported=await setup('/test-mail',{})
  assert.equal(row(unsupported,'owner_mail').state,'pending');assert.match(row(unsupported,'owner_mail').detail,/no delivery status/)
  assert.equal(row(await setup('/check',{step:'sender_dns'}),'sender_dns').state,'unavailable')
  await app.call('/api/identity/magic-link',{body:{email:bootstrap.email},status:202})
  await app.until(()=>mail.find(m=>m.subject==='Sign in to HappyToHelp'))
  await app.until(async()=>await app.first("SELECT 1 FROM email_deliveries WHERE id LIKE 'magic-signin:%' AND state='sent'"))
  const link=new URL(mail.find(m=>m.subject==='Sign in to HappyToHelp').text.match(/https:\/\/\S+/)[0])
  assert.equal(row(await setup('/check',{step:'owner_mail'}),'owner_mail').state,'pending','unused emailed link is no proof')
  await app.call('/api/identity/magic-link/consume',{body:{token:new URLSearchParams(link.hash.slice(1)).get('token')},status:200})
  assert.equal(row(await setup('/check',{step:'owner_mail'}),'owner_mail').state,'done','used emailed link confirms receipt even without a status API')
  const encoded=JSON.stringify(responses)
  for(const secret of [modelKey,mailKey,...fingerprints])assert.ok(!encoded.includes(secret),'activation responses exclude every key and stored fingerprint')
  assert.doesNotMatch(encoded,/"fingerprint"|"fingerprints"/)
 }finally{await app.close()}
 await activationBrowserJourney()
}
