import assert from 'node:assert/strict'
import {sha} from '../../journeys/kit/app.mjs'
import {inboundPath,ingressOptions,mime} from '../email/rer-edge.mjs'

// One mailbox shares the primary customer's erasure. The stored and interrupted
// originals are synthetic prior custody; conflicting copies enter via signed HTTP.
export async function customerMail(app,bindings){
 const db=app.db,files=await app.files,deliveries=[],keys=[]
 await db.batch([
  db.prepare("INSERT INTO email_settings(project_id,from_name,from_address,inbound_address,is_enabled,updated_at) VALUES('p','Support',?,?,1,1)").bind(bindings.MAIL_FROM,bindings.RER_MAIL_ADDRESS),
  db.prepare("INSERT INTO rer_mailboxes(project_id,allocation_key,mailbox_id,address,generation,state,configured,route_active,updated_at) VALUES('p','default',?,?,1,'active',1,1,1)").bind(bindings.RER_MAILBOX_ID,bindings.RER_MAIL_ADDRESS),
 ])
 const ingress=(raw,metadata)=>app.call(inboundPath,ingressOptions(bindings,raw,{workspaceId:'p',...metadata}))
 for(const [suffix,conversationId] of [['admitted','conv1'],['interrupted',null]]){
  const deliveryId='synthetic-erasure-'+suffix
  const original=mime({id:deliveryId,from:'alice@example.com',text:'Alice private original 4471'})
  const metadata={deliveryId,envelopeFrom:'synthetic-bounce@relay.example.test'}
  const key=`rer-mail/p/${sha(deliveryId)}/${sha(original)}.eml`
  await files.put(key,original)
  await db.batch([
   db.prepare("INSERT INTO rer_mail_ingress(delivery_id,project_id,mailbox_id,generation,body_sha256,raw_key,metadata_json,state,result_json,sender_address,created_at,updated_at) VALUES(?,'p',?,1,?,?,?, ?,?,'alice@example.com',1,1)").bind(deliveryId,bindings.RER_MAILBOX_ID,sha(original),key,JSON.stringify(metadata),conversationId?'complete':'failed',conversationId?JSON.stringify({state:'delivered',conversationId}):null),
   db.prepare("INSERT INTO rer_mail_raw_objects VALUES(?,?,'p',?)").bind(deliveryId,sha(original),key),
  ])
  // Even copies that change sender belong to the original customer's custody.
  const changed=mime({id:deliveryId,from:'synthetic-changed@other.example.test',text:'Changed private Alice order 4471'})
  const received=await ingress(changed,metadata)
  assert.equal(received.status,200);assert.equal(received.data.state,'held')
  deliveries.push({deliveryId,original,changed,metadata})
 }
 const held=await app.sql("SELECT * FROM suspended_emails WHERE reason='message_identity_conflict'")
 assert.equal(held.length,deliveries.length)
 assert.ok(held.every(row=>row.from_address==='alice@example.com'))
 for(const row of held)keys.push(...JSON.parse(row.input_json).attachments.map(file=>file.objectKey))
 keys.push(...(await app.sql('SELECT object_key FROM rer_mail_raw_objects')).map(row=>row.object_key))
 assert.ok(keys.length>deliveries.length)
 for(const key of keys)assert.ok(await files.get(key),'customer mail bytes exist before erasure')

 // Another sender's held mail must retain its exact record and bytes.
 const otherKey='rer-mail/p/synthetic-unrelated.eml'
 await files.put(otherKey,'Bob unrelated private original')
 await db.prepare("INSERT INTO suspended_emails(id,project_id,receipt_id,from_address,to_json,subject,text,reason,auth_json,headers_json,input_json,created_at,expires_at) VALUES('synthetic-held-other','p','synthetic-held-other','bob@example.com','[]','Bob question','Bob private mail','sender_unverified','{}','{}',?,1,?)").bind(JSON.stringify({attachments:[{objectKey:otherKey}]}),Date.now()+86400000).run()
 const other=await app.first("SELECT * FROM suspended_emails WHERE id='synthetic-held-other'")
 const verify=async()=>{
  for(const key of keys)assert.equal(await files.get(key),null,'customer MIME and review bytes removed')
  assert.deepEqual(await app.sql("SELECT id FROM suspended_emails WHERE reason='message_identity_conflict'"),[])
  assert.deepEqual(await app.sql('SELECT * FROM rer_mail_raw_objects'),[])
  for(const {deliveryId} of deliveries){
   const receipt=await app.first('SELECT state,sender_address,metadata_json,result_json FROM rer_mail_ingress WHERE delivery_id=?',deliveryId)
   assert.equal(receipt.state,'erased');assert.equal(receipt.sender_address,null)
   assert.deepEqual(JSON.parse(receipt.metadata_json),{});assert.deepEqual(JSON.parse(receipt.result_json),{state:'erased'})
  }
  assert.deepEqual(await app.first("SELECT * FROM suspended_emails WHERE id='synthetic-held-other'"),other)
  assert.equal(await(await files.get(otherKey)).text(),'Bob unrelated private original')
 }
 return {keys,verify,async replay(){
  for(const {original,changed,metadata} of deliveries)for(const raw of [original,changed]){
   const result=await ingress(raw,metadata)
   assert.equal(result.status,200);assert.equal(result.data.state,'erased');assert.equal(result.data.duplicate,true)
  }
  await verify()
 }}
}
