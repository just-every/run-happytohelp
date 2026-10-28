import assert from 'node:assert/strict'
import {recipients,replyTo,message} from './app.mjs'

// The same customer's real reply is sent through each supported HTTPS transport.
export async function transportsJourney(m,id){
 const {app,mail,operator}=m
 for(const provider of ['sendgrid','resend','cloudflare']){
  await app.configure({EMAIL_PROVIDER:provider,EMAIL_API_KEY:'fixture-key',EMAIL_ACCOUNT_ID:'a'.repeat(32)})
  const upload=await app.ok(`/api/conversations/${id}/media`,{raw:true,headers:{...operator,'Content-Type':'text/plain','X-Filename':provider+'-label.txt'},body:'Retained return label'})
  const head=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',id),before=mail.sent.length
  const sent=await app.ok(`/api/conversations/${id}/messages`,{headers:operator,body:{localId:'protocol-'+provider,content:'Replacement transport '+provider,mediaIds:[upload.id],expectedRevision:head.revision,expectedLastMessageId:head.last_message_id}})
  const deliveries=()=>app.sql('SELECT state FROM email_deliveries WHERE id LIKE ?',`message:${sent.message.id}:%`)
  await app.until(async()=>{const rows=await deliveries();return rows.length&&rows.every(row=>row.state==='sent')},{message:provider+' acceptance'})
  const wires=mail.sent.slice(before).filter(entry=>JSON.stringify(entry.body).includes('Replacement transport '+provider))
  assert.ok(wires.length>0)
  for(const wire of wires){assert.equal(wire.body.attachments[0].content,Buffer.from('Retained return label').toString('base64'));assert.ok(replyTo(wire.body));assert.ok(recipients(wire.body).length)}
  const customer=wires.find(wire=>recipients(wire.body).includes('requester@example.com')),address=replyTo(customer.body)
  await m.email(message({id:'back-'+provider,to:address,from:'requester@example.com',text:'Thanks for the '+provider+' update.'}),{from:'requester@example.com',to:address})
  assert.equal((await m.admitted('back-'+provider)).conversation_id,id)
  // The incoming customer reply can legitimately enqueue a separate notice.
  // Redelivering this admitted operator message must never send its answer twice.
  await m.replay(sent.message)
  assert.equal(mail.sent.slice(before).filter(entry=>JSON.stringify(entry.body).includes('Replacement transport '+provider)).length,wires.length)
 }
 await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-resend'})
}
