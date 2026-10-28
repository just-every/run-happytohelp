import assert from 'node:assert/strict'
import {managedReadOnlyJourney} from './managed-mail-observation.mjs'
import {activationApp,hosted,step} from './activation-app.mjs'

// One workspace's Setup checklist through its routes: a pure GET, owner/admin-only checks, explicit observations
// that persist until their configuration changes, and receipts only from what was actually observed.
export async function observationJourney(){
 const a=await activationApp(),{app,s}=a
 try{
  const primary=await app.seedWorkspace('activation'),other=await app.seedWorkspace('other');s.recipient='owner-activation@example.test'
  const call=(suffix='',{token=primary.tokens.owner,...options}={})=>a.call(primary.projectId,suffix,{token,...options})
  const snapshot=async options=>(await call('',{...options,status:200})).data.data
  const check=async(id,options={})=>step((await call('/check',{...options,body:id?{step:id}:{},status:200})).data.data,id)
  const sent=()=>app.requests.length

  // A fresh checklist is zero of eight; GET has no provider effects and exposes no secrets.
  const fresh=await snapshot();assert.deepEqual([fresh.done,fresh.total,fresh.steps.length],[0,8,8]);assert.ok(fresh.steps.every(row=>row.state==='not_checked'));assert.equal(sent(),0)
  assert.doesNotMatch(JSON.stringify(fresh),/fixture-|fingerprint/)
  // Unauthenticated, operator and other-tenant callers are refused; a caller cannot supply done or a recipient; only the owner sends test mail.
  for(const token of ['',primary.tokens.operator,other.tokens.owner])for(const [suffix,body] of [['',undefined],['/check',{}],['/test-mail',{}]])assert.ok([401,403].includes((await call(suffix,{token,body})).status))
  assert.equal((await call('/check',{body:{step:'widget_origin',done:true}})).status,400)
  assert.equal((await call('/test-mail',{body:{to:'other@example.test'}})).status,400)
  assert.equal((await call('/test-mail',{token:primary.tokens.admin,body:{}})).status,403)
  assert.equal(sent(),0)

  // Explicit local checks persist; default ceilings disclose their scope; a changed origin invalidates the receipt for good.
  assert.equal((await check('widget_origin')).state,'done')
  const limits=await check('spend_ceilings');assert.equal(limits.state,'done');assert.match(limits.detail,/defaults/);assert.match(limits.detail,/2000 automatic replies\/installation/);assert.match(limits.detail,/00:00 UTC/)
  assert.equal((await snapshot()).done,2)
  assert.equal((await check('spend_ceilings',{env:{AI_DAILY_CEILINGS:'{"spendUsdPerProject":-1}'}})).state,'failed')
  await app.db.prepare('UPDATE projects SET allowed_origin=? WHERE id=?').bind('https://changed.example',primary.projectId).run()
  assert.equal(step(await snapshot(),'widget_origin').state,'unknown')
  await app.db.prepare('UPDATE projects SET allowed_origin=? WHERE id=?').bind('https://activation.example',primary.projectId).run()
  assert.equal(step(await snapshot(),'widget_origin').state,'unknown','reverting config does not revive an invalidated observation')
  assert.equal((await check('widget_origin')).state,'done')

  // The help article step is hidden and never counts, whatever is published.
  const insert=(id,project)=>app.db.prepare('INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,project,id,'Returns','Return instructions','published',Date.now()).run()
  const before=await snapshot(),article=step(before,'published_article')
  assert.deepEqual([article.placement,article.applicable,article.state],['hidden',false,'not_checked'])
  await insert('own',primary.projectId);await insert('foreign',other.projectId)
  const checked=await check('published_article'),after=await snapshot()
  assert.deepEqual([checked.placement,checked.applicable,checked.state],['hidden',false,'not_checked'],'the step is never observed')
  assert.deepEqual([after.done,after.applicableTotal,after.total,after.steps.length],[before.done,before.applicableTotal,8,8],'publishing changes neither count');assert.ok(!('articles' in after.facts))
  await app.db.prepare('DELETE FROM knowledge_articles WHERE project_id=?').bind(primary.projectId).run()

  // A model's presence is not validation: authenticated metadata, a revoked key and a stale receipt are distinguished.
  await a.defaultAssistant(primary,'assistant','gpt-5-mini')
  const missing=await check('model_key',{env:{OPENAI_API_KEY:undefined}});assert.equal(missing.state,'unavailable');assert.match(missing.detail,/CONFIGURATION_REQUIRED: OPENAI_API_KEY/)
  assert.equal((await check('model_key')).state,'done')
  let start=sent();const validated=await snapshot();assert.equal(step(validated,'model_key').state,'done');assert.equal(sent(),start)
  assert.deepEqual([validated.facts.ai.provider,validated.facts.ai.checkable],['openai',true],'an OpenAI key can be checked automatically')
  s.modelStatus=401;assert.equal((await check('model_key')).state,'failed');s.modelStatus=200
  assert.equal((await check('model_key')).state,'done')
  await app.db.prepare("UPDATE activation_receipts SET checked_at=? WHERE project_id=? AND step_id='model_key'").bind(Date.now()-16*60*1000,primary.projectId).run()
  assert.equal(step(await snapshot(),'model_key').state,'unknown')
  assert.equal(step(await snapshot({env:{OPENAI_API_KEY:undefined}}),'model_key').state,'unknown')

  // Sender DNS needs the provider's current domain and every SPF/DKIM record verified.
  for(const status of ['verified','failed','pending']){s.dnsStatus=status;assert.equal((await check('sender_dns')).state,{verified:'done',failed:'failed',pending:'pending'}[status])}
  s.dnsStatus='verified'

  // The test email is idempotent; queued is pending; a delivery to another identity is unknown; delivered needs the provider's status.
  assert.equal((await check('owner_mail')).state,'pending');assert.equal(s.sendCount,0)
  const send=await call('/test-mail',{body:{},status:200});assert.equal(step(send.data.data,'owner_mail').state,'pending');assert.equal(s.sendCount,1)
  await call('/test-mail',{body:{}});assert.equal(s.sendCount,1)
  s.statusMismatch=true;s.event='delivered';assert.equal((await check('owner_mail')).state,'unknown');s.statusMismatch=false
  assert.equal((await check('owner_mail')).state,'done');assert.equal(step(await snapshot(),'owner_mail').state,'done')
  s.event='bounced';assert.equal((await check('owner_mail')).state,'failed')
  const sends=s.sendCount,rotated={EMAIL_API_KEY:'synthetic-rotated-fixture-key'};s.sendUncertain=true
  assert.equal(step((await call('/test-mail',{body:{},env:rotated})).data.data,'owner_mail').state,'unknown')
  await call('/test-mail',{body:{},env:rotated});assert.equal(s.sendCount,sends+1,'an uncertain message is never replayed');s.sendUncertain=false;await a.deploy()

  // Inbound completes only on a receipt delivered under the current enabled mailbox, never on an address alone.
  await app.db.prepare('INSERT INTO email_settings VALUES(?,?,?,?,?,?)').bind(primary.projectId,'Support','support@example.test','inbound@example.test',1,100).run()
  assert.equal((await check('inbound_address')).state,'pending')
  assert.equal((await app.call('/api/integrations/email/inbound',{headers:{Authorization:`Bearer ${hosted.INBOUND_EMAIL_TOKEN}`},body:{messageId:'inbound-1',to:'inbound@example.test',from:'visitor@example.test',text:'Plain text activation receipt',subject:'Test',headers:{'Auto-Submitted':'auto-generated'}}})).status,201)
  assert.equal((await check('inbound_address')).state,'done')
  await app.db.prepare('UPDATE email_settings SET inbound_address=?,updated_at=101 WHERE project_id=?').bind('new@example.test',primary.projectId).run()
  assert.equal(step(await snapshot(),'inbound_address').state,'unknown');assert.equal((await check('inbound_address')).state,'pending')
  // Even a raced snapshot cannot reattribute an immutable old-address ingress intent.
  await app.db.prepare("UPDATE activation_inbound_receipts SET address='new@example.test',settings_updated_at=101 WHERE inbound_id='inbound-1'").run()
  assert.equal((await check('inbound_address')).state,'pending')
  // A generated workers.dev address cannot receive email, even with a gateway token installed.
  await app.db.prepare('UPDATE email_settings SET inbound_address=?,updated_at=102 WHERE project_id=?').bind(['support','in.workspace.account.workers.dev'].join('@'),primary.projectId).run()
  const blocked=await check('inbound_address');assert.equal(blocked.state,'unavailable');assert.ok(!blocked.receiptRef)
  assert.equal((await snapshot()).facts.inbound.customDomainRequired,true)
  await app.db.prepare('UPDATE email_settings SET inbound_address=?,updated_at=103 WHERE project_id=?').bind('support@in.example.test',primary.projectId).run()
  assert.equal((await check('inbound_address')).state,'pending','a custom mailbox waits for a real inbound receipt')

  // Only an authenticated visitor's ping from the workspace's own site counts as the widget seen.
  const visitor=await a.visitor(primary,'contact',{conversation:true}),ping=(action,site='https://activation.example',token=visitor.token)=>a.ping(visitor.conversationId,{action,site,token})
  assert.equal((await ping('instruction')).status,200);assert.equal((await check('widget_seen')).state,'pending')
  // Another site is refused at the door; the owner's own site preview is let in but is not a visitor's install.
  assert.equal((await ping('pingActive','https://wrong.example')).status,403)
  await app.call(`/api/site-preview/projects/${primary.projectId}/preview`,{token:primary.tokens.owner,body:{url:'https://activation.example'},status:201})
  assert.equal((await ping('pingActive',hosted.PREVIEW_ORIGIN)).status,200)
  assert.equal((await check('widget_seen')).state,'pending')
  assert.equal((await ping('pingActive','https://activation.example',primary.tokens.owner)).status,403)
  assert.equal((await ping('pingActive')).status,200);assert.equal((await check('widget_seen')).state,'done')
  await app.db.prepare('UPDATE projects SET allowed_origin=? WHERE id=?').bind('https://new.example',primary.projectId).run()
  assert.equal(step(await snapshot(),'widget_seen').state,'unknown');assert.equal((await check('widget_seen')).state,'pending')

  // A deleted workspace denies Setup even to a retained membership.
  await app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.deleted_at',1) WHERE project_id=?").bind(primary.projectId).run()
  assert.ok([401,403].includes((await call()).status))
 }finally{await a.close()}
 await managedReadOnlyJourney()
}
