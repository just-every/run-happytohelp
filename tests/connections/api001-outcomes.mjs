import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {harness,body,sha} from './harness.mjs'
import {zapierApp,requestTemplate} from '../../src/modules/api-integrations/zapier-app.mjs'
const root='/api/management/projects/p/connections'
const rpc=(method,params={})=>body({jsonrpc:'2.0',id:1,method,params})
export async function api001Outcomes(){
 const h=await harness()
 try{
  const full=await h.issue(),token=full.token,read=await h.issue(['contacts:read','articles:read','conversations:read']),foreign=await h.issue(undefined,'q')
  const post=(path,value)=>h.call('/api/v1'+path,{token,...body(value)})
  const contact=(await post('/contacts',{name:'Connector customer',email:'connector@example.test'})).data
  await h.call('/api/v1/contacts/'+contact.id,{token,...body({name:'Edited customer'}),method:'PUT'})
  const article=(await post('/articles',{title:'Connector article',content:'Knowledge draft'})).data
  await h.call('/api/v1/articles/'+article.id,{token,...body({title:'Published connector article',content:'Native knowledge',status:'published'}),method:'PUT'})
  await post('/contacts',{name:'Second customer',email:'second@example.test'});await post('/articles',{title:'Second draft',content:'Draft'})
  // O1: export both resource sets to exhaustion, including tied sort keys.
  for(const resource of ['contacts','articles']){
   const table=resource==='contacts'?'contacts':'knowledge_articles',column=resource==='contacts'?'created_at':'updated_at'
   await h.db.prepare(`UPDATE ${table} SET ${column}=100 WHERE project_id='p'`).run()
   const ids=[];let cursor
   do{const page=await h.call('/api/v1/'+resource+'?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token});ids.push(...page.data.map(r=>r.id));cursor=page.next_cursor}while(cursor)
   const expected=(await h.db.prepare(`SELECT id FROM ${table} WHERE project_id='p' ORDER BY id`).all()).results.map(r=>r.id)
   assert.deepEqual(ids.sort(),expected);assert.equal(new Set(ids).size,expected.length)
   const before=(await h.db.prepare(`SELECT * FROM ${table} WHERE project_id='p' ORDER BY id`).all()).results
   assert.equal((await h.raw('/api/v1/'+resource,{token:read.token,...body(resource==='contacts'?{name:'Refused'}:{title:'Refused',content:'No'})})).status,403)
   assert.equal((await h.raw('/api/v1/'+resource+'/'+ids[0],{token:read.token,...body({name:'Refused',title:'Refused',status:'published'}),method:'PUT'})).status,403)
   assert.deepEqual((await h.db.prepare(`SELECT * FROM ${table} WHERE project_id='p' ORDER BY id`).all()).results,before)
   for(const limit of ['0','101','1.5','NaN'])assert.equal((await h.raw('/api/v1/'+resource+'?limit='+limit,{token})).status,400)
  }
  const cursor=(await h.call('/api/v1/contacts?limit=1',{token})).next_cursor
  for(const path of ['/articles?cursor=','/contacts?email=other@example.test&cursor='])assert.equal((await h.raw('/api/v1'+path+encodeURIComponent(cursor),{token})).status,400)
  assert.equal((await h.call('/api/v1/contacts?email=connector@example.test',{token})).data[0].id,contact.id)
  await h.contact('api001-ticket');const ticket=(await h.conversation('api001-ticket')).conversation
  const id=ticket?.id??(await h.db.prepare("SELECT id FROM conversations WHERE contact_id='api001-ticket'").first()).id
  const future=await h.call('/api/v1/conversations?updated_since=2999-01-01T00:00:00Z',{token});assert.deepEqual(future.data,[])
  assert.deepEqual((await h.call('/api/v1/conversations?tag=absent',{token})).data,[])
  const tagged=await h.call('/api/dashboard/projects/p/conversations/'+id+'/tags',body({name:'API001 tag'}))
  const timestamp=(await h.db.prepare('SELECT updated_at FROM conversations WHERE id=?').bind(id).first()).updated_at
  assert.deepEqual((await h.call('/api/v1/conversations?tag='+encodeURIComponent(tagged.data.id)+'&updated_since='+encodeURIComponent(new Date(timestamp).toISOString()),{token})).data.map(r=>r.id),[id])
  await h.contact('cursor-peer');await h.conversation('cursor-peer')
  const first=await h.call('/api/v1/conversations?limit=1',{token});assert.ok(first.next_cursor)
  assert.equal((await h.raw('/api/v1/conversations?status=open&cursor='+encodeURIComponent(first.next_cursor),{token})).status,400)
  // O3: definition-owned REST-hook templates, signed event once, unsubscribe and revocation.
  const subscribe=async(credential=token,event='contact.updated')=>{const request=requestTemplate(zapierApp.triggers.support_event.subscribe,{event,url:'https://receiver.example.com/zapier'});return h.raw(request.path,{token:credential,...request})}
  const hook=await (await subscribe()).json();assert.ok(hook.id&&hook.secret)
  assert.equal((await subscribe(read.token,'article.published')).status,201)
  const noScope=await h.issue(['articles:read']);assert.equal((await subscribe(noScope.token)).status,403)
  assert.equal((await h.call('/api/v1/zapier/sample?event=contact.updated',{token})).data.length,4)
  await h.call('/api/v1/contacts/'+contact.id,{token,...body({name:'Webhook change'}),method:'PUT'});await h.dispatch()
  const eventDest=await h.call(root+'/webhooks',body({name:'Domain events',url:'https://receiver.example.com/domain',events:['contact.created','article.published']}))
  await post('/contacts',{name:'Domain event sentinel'});const draft=(await post('/articles',{title:'Domain event article',content:'Draft body'})).data
  await h.call('/api/v1/articles/'+draft.id,{token,...body({title:'Published event',content:'Published body',status:'published'}),method:'PUT'});await h.dispatch()
  const eventReceipts=h.received.filter(r=>r.headers['webhook-destination']===eventDest.id);assert.deepEqual(eventReceipts.map(r=>r.headers['webhook-event']).sort(),['article.published','contact.created']);assert.ok(eventReceipts.every(r=>!r.body.toString().includes('sentinel')))
  await h.call(root+'/webhooks/'+eventDest.id,{method:'DELETE'})
  const receipts=h.received.filter(r=>r.headers['webhook-destination']===hook.id);assert.equal(receipts.length,1)
  const receipt=receipts[0],headers=receipt.headers
  const signature=(tenant,destination,bytes)=>'v1='+createHmac('sha256',Buffer.from(hook.secret,'hex')).update(JSON.stringify(['integrations.webhook.v1',tenant,destination,headers['webhook-event'],headers['webhook-id'],headers['webhook-timestamp'],bytes])).digest('hex')
  assert.equal(headers['webhook-signature'],signature('p',hook.id,receipt.body.toString()))
  assert.notEqual(headers['webhook-signature'],signature('p','another-destination',receipt.body.toString()))
  assert.notEqual(headers['webhook-signature'],signature('p',hook.id,'forged bytes'))
  assert.ok(!receipt.body.toString().includes('Webhook change'))
  await h.dispatch();assert.equal(h.received.filter(r=>r.headers['webhook-destination']===hook.id).length,1)
  const unsubscribe=requestTemplate(zapierApp.triggers.support_event.unsubscribe,{id:hook.id})
  assert.equal((await h.raw(unsubscribe.path,{token:foreign.token,...unsubscribe})).status,404)
  await h.call(unsubscribe.path,{token,...unsubscribe});await h.call('/api/v1/contacts/'+contact.id,{token,...body({name:'After unsubscribe'}),method:'PUT'});await h.dispatch()
  assert.equal(h.received.filter(r=>r.headers['webhook-destination']===hook.id).length,1)
  const revocable=await h.issue(['contacts:read']),revokedHook=await (await subscribe(revocable.token)).json()
  await h.call('/api/v1/contacts/'+contact.id,{token,...body({name:'Queued before revoke'}),method:'PUT'})
  h.responses.push({status:429,headers:{'Retry-After':'0'}});await h.dispatch()
  assert.equal(h.received.filter(r=>r.headers['webhook-destination']===revokedHook.id).length,1)
  const boundNative=await h.call(root+'/webhooks',body({name:'Bound native hook',url:'https://receiver.example.com/bound',events:['conversation.created'],credential_id:revocable.data.id}))
  await h.call(root+'/tokens/'+revocable.data.id,{method:'DELETE'});await h.db.prepare('UPDATE integration_deliveries SET next_at=0').run();const sent=h.received.filter(r=>r.headers['webhook-destination']===revokedHook.id).length;await h.dispatch();assert.equal(h.received.filter(r=>r.headers['webhook-destination']===revokedHook.id).length,sent)
  for(const hookId of [revokedHook.id,boundNative.id])assert.equal((await h.db.prepare('SELECT enabled FROM native_integration_destinations WHERE id=?').bind(hookId).first()).enabled,0)
  assert.equal((await h.raw('/api/v1/zapier/sample?event=contact.updated',{token:revocable.token})).status,401)
  // O4: the shipped action request itself retains native idempotency and fences.
  const revision=(await h.db.prepare('SELECT revision FROM conversations WHERE id=?').bind(id).first()).revision
  const action=requestTemplate(zapierApp.actions.reply,{id,localId:'zapier-reply',content:'Action through app definition',expectedRevision:revision})
  const replied=await h.call(action.path,{token,...action});assert.ok(replied.data.id);assert.equal((await h.call(action.path,{token,...action})).duplicate,true)
  assert.equal((await h.raw(action.path,{token:read.token,...action})).status,403);assert.equal((await h.raw(action.path,{token:foreign.token,...action})).status,404)
  // O5: listed authority equals native scopes, denied writes are inert, private notes absent.
  const initialized=await h.call('/api/v1/mcp',{token:read.token,...rpc('initialize')});assert.equal(initialized.result.serverInfo.name,'HappyToHelp')
  const list=await h.call('/api/v1/mcp',{token:read.token,...rpc('tools/list')});assert.ok(list.result.tools.some(t=>t.name==='list_conversations'));assert.ok(!list.result.tools.some(t=>t.name==='reply'))
  const call=(name,args={},credential=read.token)=>h.call('/api/v1/mcp',{token:credential,...rpc('tools/call',{name,arguments:args})})
  const own=await call('list_conversations');assert.ok(own.result.content[0].text.includes(id));assert.equal(own.result.isError,false)
  const before=(await h.db.prepare('SELECT * FROM contacts WHERE id=?').bind(contact.id).first());assert.equal((await call('update_contact',{id:contact.id,name:'Forbidden'})).result.isError,true)
  assert.deepEqual(await h.db.prepare('SELECT * FROM contacts WHERE id=?').bind(contact.id).first(),before)
  const missing=await call('get_conversation',{id},foreign.token);assert.match(missing.result.content[0].text,/not_found/)
  await h.db.prepare("INSERT INTO api_notes(id,conversation_id,user_id,name,content,created_at) VALUES('private-mcp',?,?,'API actor',?,?)").bind(id,full.data.id,'MCP private note sentinel',Date.now()).run()
  assert.ok(!(await call('list_messages',{id})).result.content[0].text.includes('MCP private note sentinel'))
  await h.call(root+'/tokens/'+read.data.id,{method:'DELETE'});assert.equal((await h.raw('/api/v1/mcp',{token:read.token,...rpc('tools/list')})).status,401)
  const response=await h.raw('/api/v1/mcp',{token,...rpc('tools/list'),headers:{'Content-Type':'application/json',Origin:'https://foreign.example'}});assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
  await h.call('/api/management/projects/p/contacts/api001-ticket/erase',body({}));assert.equal((await h.raw(action.path,{token,...action})).status,404)
  // O8: visible failure and one observed-attempt approval, metadata only.
  const dest=await h.call(root+'/webhooks',body({name:'Catalog failure',url:'https://receiver.example.com/catalog',events:['contact.updated']}))
  h.responses.push({status:400});await h.call(root+'/webhooks/'+dest.id+'/test',body({}))
  h.responses.push({status:500});const uncertain=await h.call(root+'/webhooks/'+dest.id+'/test',body({}))
  const catalog=(await h.call(root+'/connectors')).data,webhooks=catalog.find(r=>r.id==='webhooks')
  assert.deepEqual(catalog.map(r=>r.id).sort(),['api','mcp','webhooks','slack','zapier','helpscout'].sort());assert.equal(catalog.find(r=>r.id==='api').health,'degraded');assert.equal(catalog.find(r=>r.id==='mcp').shared_authority,true);assert.equal(webhooks.health,'failing');assert.ok(webhooks.attempts.some(a=>a.status===400))
  const reconcile=webhooks.reconciliation.find(a=>a.path.includes(uncertain.id));assert.equal(reconcile.body.attempt,1)
  await h.call(root+reconcile.path,body(reconcile.body));assert.equal((await h.raw(root+reconcile.path,body(reconcile.body))).status,409)
  await h.contact('catalog-agent');assert.equal((await h.raw(root+'/connectors',{actor:'catalog-agent'})).status,403)
  const safe=JSON.stringify(catalog);for(const secret of [token,hook.secret,'MCP private note sentinel','Connector customer'])assert.ok(!safe.includes(secret))
  const rate=await h.issue(['contacts:read']),minute=Math.floor(Date.now()/60000)*60000
  await h.db.prepare('INSERT INTO abuse_counters(key,window_start,used,expires_at) VALUES(?,?,120,?)').bind('rate:apiRequestsPerTokenMinute:'+sha(rate.data.id),minute,minute+60000).run()
  const limited=await h.raw('/api/v1/mcp',{token:rate.token,...rpc('tools/call',{name:'list_contacts',arguments:{}})});assert.equal(limited.status,429);assert.ok(limited.headers.get('Retry-After'))
  assert.ok((await h.db.prepare('SELECT count(*) n FROM integration_token_usage WHERE token_id=? AND allowed=0').bind(rate.data.id).first()).n>0)
  await h.call('/api/management/projects/p/contacts/'+contact.id+'/erase',body({}))
  const restore=requestTemplate(zapierApp.actions.create_contact,{name:'Cannot restore',email:'connector@example.test'});assert.equal((await h.raw(restore.path,{token,...restore})).status,409)
  assert.equal(h.external,0)
 }finally{await h.close()}
}
