import assert from 'node:assert/strict'
import {managedInstallation} from './rer-mail.mjs'
import {mime} from './rer-edge.mjs'

// Signed ingress and the authorized contact-erasure route share the real D1/R2.
export async function rerMailErasureJourney(){
 for(const interrupted of [false,true])await erasureOrder(interrupted)
}
async function erasureOrder(interrupted){
 const i=await managedInstallation(interrupted?'erasure-interrupted':'erasure'),{app,owner}=i
 try{
  const sender='synthetic-erasure-customer@customer.example.test',deliveryId='synthetic-erasure-delivery'
  const raw=mime({id:'synthetic-erasure-message',from:sender,text:'Private account SYNTHETIC-ERASURE-7781'})
  // The envelope may be a forwarding address rather than the contact's identity.
  const metadata={deliveryId,envelopeFrom:'synthetic-bounce@relay.example.test'}
  let received=await i.ingress(raw,metadata,interrupted?{headers:{'x-test-fault':'db-interrupt','x-test-statement':"SET state='processing'"}}:{})
  if(interrupted)assert.ok(received.status>=500,'interrupt the original before admission')
  else{assert.equal(received.status,200);assert.equal(received.data.state,'delivered')}
  const original=await app.first('SELECT body_sha256,raw_key FROM rer_mail_ingress WHERE delivery_id=?',deliveryId)
  const changed=mime({id:'synthetic-erasure-message',from:sender,text:'Changed private account SYNTHETIC-ERASURE-9932'})
  const changedSender=mime({id:'synthetic-erasure-message',from:'synthetic-changed-sender@other.example.test',text:'Changed sender carrying SYNTHETIC-ERASURE-9932'})
  if(interrupted){
   const heldFirst=await i.ingress(changed,metadata)
   assert.equal(heldFirst.status,200);assert.equal(heldFirst.data.state,'held')
   const pending=await app.first("SELECT from_address,candidate_conversation_id,input_json FROM suspended_emails WHERE reason='message_identity_conflict'")
   assert.equal(pending.from_address,sender);assert.equal(pending.candidate_conversation_id,null)
   assert.deepEqual(JSON.parse(pending.input_json).custody,{deliveryId,headerFrom:sender,envelopeFrom:metadata.envelopeFrom})
   await app.db.prepare('UPDATE rer_mail_ingress SET updated_at=? WHERE delivery_id=?').bind(Date.now()-130000,deliveryId).run()
   received=await i.ingress(raw,metadata)
   assert.equal(received.status,200);assert.equal(received.data.state,'delivered')
  }
  const conversationId=received.data.conversationId
  for(const [body,extra] of [[changed,{}],[changed,{timestamp:Date.now()+1000}],[changedSender,{envelopeFrom:'synthetic-changed-envelope@other.example.test'}]]){
   const result=await i.ingress(body,{...metadata,...extra})
   assert.equal(result.status,200);assert.equal(result.data.state,'held')
  }
  assert.deepEqual(await app.first('SELECT body_sha256,raw_key FROM rer_mail_ingress WHERE delivery_id=?',deliveryId),original,'held copies cannot replace the admitted source')
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversationId)).n,1,'changed copies never enter the transcript')
  const held=await app.sql("SELECT * FROM suspended_emails WHERE reason='message_identity_conflict'")
  assert.ok(held.length>=2)
  for(const row of held){
   assert.equal(row.from_address,sender,'custody uses the original sender, including when the new copy changes it')
   assert.ok(row.candidate_conversation_id===conversationId||interrupted&&row.candidate_conversation_id===null)
   assert.equal(JSON.parse(row.input_json).custody.deliveryId,deliveryId)
   assert.equal(JSON.parse(row.auth_json).verified,false,'custody never authenticates conflicting bytes')
  }
  const files=await app.files,heldKeys=held.flatMap(row=>JSON.parse(row.input_json).attachments.map(file=>file.objectKey))
  const heldText=(await Promise.all(heldKeys.map(async key=>(await files.get(key)).text()))).join('\n')
  assert.ok(heldText.includes(sender));assert.ok(heldText.includes('SYNTHETIC-ERASURE-9932'))
  const rawKeys=(await app.sql('SELECT object_key FROM rer_mail_raw_objects WHERE delivery_id=?',deliveryId)).map(row=>row.object_key)
  assert.ok(rawKeys.length>=3,'each different MIME has its own private original')
  const stranger='synthetic-unrelated@other.example.test'
  assert.equal((await i.ingress(mime({id:'synthetic-erasure-unrelated',from:stranger,text:'Unrelated private email'}),{deliveryId:'synthetic-erasure-unrelated',envelopeFrom:stranger,verdict:'unproven'})).data.state,'suspended')
  const unrelated=await app.sql('SELECT * FROM suspended_emails WHERE from_address=?',stranger)
  assert.equal(unrelated.length,1)
  const unrelatedKeys=unrelated.flatMap(row=>JSON.parse(row.input_json).attachments.map(file=>file.objectKey))
  unrelatedKeys.push(...(await app.sql('SELECT object_key FROM rer_mail_raw_objects WHERE delivery_id=?','synthetic-erasure-unrelated')).map(row=>row.object_key))
  const unrelatedBytes=await Promise.all(unrelatedKeys.map(async key=>Buffer.from(await(await files.get(key)).arrayBuffer())))
  const {contact_id:contactId}=await app.first('SELECT contact_id FROM conversations WHERE id=?',conversationId)
  const erased=await app.call(`/api/management/projects/${owner.projectId}/contacts/${contactId}/erase`,{token:owner.token,body:{}})
  assert.equal(erased.status,200,JSON.stringify(erased.data))
  assert.deepEqual(await app.sql("SELECT id FROM suspended_emails WHERE reason='message_identity_conflict'"),[],'normal erasure removes every held changed copy')
  for(const key of [...heldKeys,...rawKeys])assert.equal(await files.get(key),null,'normal erasure deletes private MIME object '+key)
  assert.deepEqual(await app.sql('SELECT * FROM rer_mail_raw_objects WHERE delivery_id=?',deliveryId),[])
  const tombstone=await app.first('SELECT state,sender_address,metadata_json,result_json FROM rer_mail_ingress WHERE delivery_id=?',deliveryId)
  assert.deepEqual(tombstone,{state:'erased',sender_address:null,metadata_json:'{}',result_json:'{"state":"erased"}'})
  assert.deepEqual(await app.sql('SELECT * FROM suspended_emails WHERE from_address=?',stranger),unrelated,'other senders keep their held email')
  assert.deepEqual(await Promise.all(unrelatedKeys.map(async key=>Buffer.from(await(await files.get(key)).arrayBuffer()))),unrelatedBytes)
  // Old signed deliveries, including their changed copies, cannot recreate private data.
  for(const body of [raw,changed,changedSender]){
   const replay=await i.ingress(body,metadata)
   assert.equal(replay.status,200);assert.equal(replay.data.state,'erased');assert.equal(replay.data.duplicate,true)
  }
  assert.deepEqual(await app.sql('SELECT * FROM rer_mail_raw_objects WHERE delivery_id=?',deliveryId),[])
  assert.deepEqual(await app.sql("SELECT id FROM suspended_emails WHERE reason='message_identity_conflict'"),[])
  assert.deepEqual(await app.sql('SELECT content FROM messages WHERE conversation_id=?',conversationId),[{content:''}])
 }finally{await i.close()}
}
