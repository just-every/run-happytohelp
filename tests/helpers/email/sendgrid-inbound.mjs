import assert from 'node:assert/strict'
import {mailApp} from './app.mjs'

// SendGrid Inbound Parse: shared-token authentication, attachment bytes, stable Message-ID per mailbox, the
// header From over VERP and SRS envelopes, forwarded routing, unverified SPF kept apart, and multi-mailbox delivery.
export async function sendgridInboundJourney(){
 const m=await mailApp({bindings:{INBOUND_EMAIL_TOKEN:'synthetic-fixture-inbound-token'},inbound:'support@reply.support.example.com',outbox:'help@support.example.com'}),env={DB:m.DB}
 try{
  await env.DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('q','Second Project','q-w','https://example.com',1)").run()
  await env.DB.prepare("INSERT INTO email_settings VALUES('q','Support','help@support.example.com','second@reply.support.example.com',1,1)").run()
  const authorization=`Basic ${Buffer.from('sendgrid:synthetic-fixture-inbound-token').toString('base64')}`
  // Multipart as SendGrid posts it: an encoded body with its boundary.
  const post=async(form,auth=authorization)=>{const encoded=new Request('https://sendgrid.example',{method:'POST',body:form});return m.app.request('/api/integrations/email/sendgrid/inbound',{method:'POST',raw:true,headers:{Authorization:auth,'Content-Type':encoded.headers.get('Content-Type')},body:await encoded.arrayBuffer()})}
  const makeForm = ({ messageId, envelopeTo, visibleTo, text, attachment }) => {
    const form = new FormData()
    form.set('envelope', JSON.stringify({ to: [envelopeTo], from: 'customer@example.com' }))
    form.set('to', visibleTo)
    form.set('from', 'Customer <customer@example.com>')
    form.set('SPF','pass')
    form.set('subject', 'Attachment from customer')
    if (text !== undefined) form.set('text', text)
    form.set('headers', `Message-ID: <${messageId}>\r\n`)
    if (attachment) {
      form.set('attachment-info', JSON.stringify({ attachment0: { filename: attachment.filename, type: attachment.type } }))
      form.set('attachment0', new File([new TextEncoder().encode(attachment.body)], attachment.filename, { type: attachment.type }))
    }
    return form
  }
  const form = makeForm({ messageId: 'sendgrid-inbound-1@example.com', envelopeTo: 'support@reply.support.example.com', visibleTo: 'wrong@example.org', text: 'Please review the attached note.', attachment: { filename: 'note.txt', type: 'text/plain', body: 'attachment bytes' } })

  const first = await post(form)
  assert.equal(first.status, 201)
  const firstBody = await first.json()
  assert.equal(firstBody.state, 'delivered')
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM messages').first()).n, 1)
  const media = await env.DB.prepare('SELECT * FROM media').first()
  assert.equal(media.filename, 'note.txt')
  assert.equal(new TextDecoder().decode(await (await (await m.app.files).get(media.object_key)).arrayBuffer()), 'attachment bytes')

  const duplicate = await post(form)
  assert.equal(duplicate.status, 200)
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM messages').first()).n, 1)

  const rejected = await post(form, 'Basic ZGVueTpub3QtaXQ=')
  assert.equal(rejected.status, 403)

  // The same provider Message-ID may be delivered to another configured
  // mailbox. The SMTP envelope scopes routing; the visible To header does not.
  const second = await post(makeForm({ messageId: 'sendgrid-inbound-1@example.com', envelopeTo: 'second@reply.support.example.com', visibleTo: 'wrong@example.org', text: 'Please review the attached note.' }))
  assert.equal(second.status, 201)
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM messages').first()).n, 2)

  // A customer may send only a file with no text or HTML body.
  const attachmentOnly = await post(makeForm({ messageId: 'sendgrid-inbound-attachment-only@example.com', envelopeTo: 'support@reply.support.example.com', visibleTo: 'wrong@example.org', text: '', attachment: { filename: 'screenshot.png', type: 'image/png', body: 'png bytes' } }))
  assert.equal(attachmentOnly.status, 201)
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM messages').first()).n, 3)

  // The header From is the sender; SendGrid's DKIM and SPF verdicts verify it. The
  // envelope (VERP, forwarding SRS, or a null return path) is delivery metadata.
  const rawForm = ({ messageId, envelope, from = 'Customer <customer@example.com>', subject = 'Question', headers = '', text = 'Hello', spf='pass', dkim='', to = 'support@reply.support.example.com' }) => {
    const form = new FormData()
    if (envelope !== undefined) form.set('envelope', JSON.stringify(envelope))
    form.set('to', to)
    form.set('from', from)
    form.set('subject', subject)
    form.set('SPF',spf)
    if (dkim) form.set('dkim', dkim)
    form.set('text', text)
    form.set('headers', `Message-ID: <${messageId}>\r\n${headers}`)
    return form
  }
  // A null return path is admitted under its unverified header From, and stays quiet.
  for (const envelope of [{ to: ['support@reply.support.example.com'], from: '' }, { to: ['support@reply.support.example.com'], from: '<>' }, { to: ['support@reply.support.example.com'] }, undefined]) {
    const bounce = await post(rawForm({ messageId: 'sendgrid-null-sender@example.com', envelope, from: 'Victim <victim@example.org>', subject: 'Delivery Status Notification (Failure)' }))
    assert.equal(bounce.status < 300, true)
    assert.equal((await bounce.json()).automatic, true)
  }
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM messages').first()).n, 3,'unproven null-sender mail is suspended without a ticket')

  // List mail is classified from the raw header block: admitted and broadcast, but no AI reply is requested.
  const list = await post(rawForm({ messageId: 'sendgrid-list@example.com', envelope: { to: ['support@reply.support.example.com'], from: 'bounces@news.example.com' }, from: 'News <news@example.com>', subject: 'Weekly news', dkim:'{@example.com : pass}', headers: 'List-Id: Product news\r\n <news.example.com>\r\nList-Unsubscribe: <mailto:leave@news.example.com>\r\n' }))
  assert.equal(list.status, 201)
  assert.equal((await list.json()).automatic, true)
  const listClaim = await env.DB.prepare("SELECT * FROM inbound_emails WHERE id='<sendgrid-list@example.com>'").first()
  assert.equal(listClaim.automatic, 1)
  const listEvidence = JSON.parse(listClaim.evidence_json)
  assert.deepEqual(listEvidence.reasons, ['list-id', 'list-unsubscribe'])
  assert.equal(listEvidence.envelope_from, 'bounces@news.example.com')
  assert.equal(listEvidence.headers['list-id'], 'Product news <news.example.com>')
  assert.equal((await env.DB.prepare("SELECT email FROM contacts c JOIN conversations v ON v.contact_id=c.id WHERE v.id=?").bind(listClaim.conversation_id).first()).email, 'news@example.com')
  const customer = await post(rawForm({ messageId: 'sendgrid-customer@example.com', envelope: { to: ['support@reply.support.example.com'], from: 'customer@example.com' }, subject: 'Re: Out of office auto-replies are not working' }))
  assert.equal((await customer.json()).automatic, false)
  const ccMail=rawForm({messageId:'sendgrid-cc@example.com',envelope:{to:[`support+${firstBody.conversationId}@reply.support.example.com`],from:'customer@example.com'},text:'Finance can help.\n\nOn Fri, 16 Oct 2026 Support wrote:\n> Please attach the export',headers:'Cc: Finance <finance@example.com>\r\n'})
  const ccResult=await post(ccMail);assert.equal(ccResult.status,201)
  const participant=await env.DB.prepare('SELECT ct.id FROM contacts ct JOIN conversation_participants cp ON cp.contact_id=ct.id WHERE cp.conversation_id=? AND ct.email=? AND ct.project_id=?').bind(firstBody.conversationId,'finance@example.com','p').first()
  assert.ok(participant)
  const finance=await post(rawForm({messageId:'sendgrid-participant@example.com',envelope:{to:[`support+${firstBody.conversationId}@reply.support.example.com`],from:'finance@example.com'},from:'Finance <finance@example.com>',text:'I have the invoice.'}))
  assert.equal(finance.status,201)
  const body=await env.DB.prepare('SELECT content,content_raw FROM messages WHERE id=(SELECT message_id FROM inbound_emails WHERE id=?)').bind('<sendgrid-cc@example.com>').first()
  assert.equal(body.content,'Finance can help.');assert.ok(body.content_raw.includes('Please attach the export'))
  // One message to two configured mailboxes reaches each project.
  assert.equal((await post(rawForm({messageId:'sendgrid-many-recipients@example.com',envelope:{to:['support@reply.support.example.com','second@reply.support.example.com'],from:'customer@example.com'}}))).status,201)
  assert.deepEqual((await env.DB.prepare("SELECT project_id FROM inbound_emails WHERE local_id IS NOT NULL AND state='delivered' AND evidence_json LIKE '%sendgrid-many-recipients%' ORDER BY project_id").all()).results.map(row=>row.project_id),['p','q'])
  // SPF not passing: still admitted to the customer's thread, flagged unverified, CC skipped.
  const unverified=await post(rawForm({messageId:'sendgrid-spf-softfail@example.com',envelope:{to:[`support+${firstBody.conversationId}@reply.support.example.com`],from:'customer@example.com'},text:'Sent through an unaligned relay',spf:'softfail',headers:'Cc: stranger@example.com\r\n'}))
  assert.equal(unverified.status,201);assert.equal((await unverified.json()).state,'suspended');assert.equal((await env.DB.prepare("SELECT conversation_id FROM inbound_emails WHERE id='<sendgrid-spf-softfail@example.com>'").first()).conversation_id,null)
  assert.equal(JSON.parse((await env.DB.prepare("SELECT evidence_json FROM inbound_emails WHERE id='<sendgrid-spf-softfail@example.com>'").first()).evidence_json).sender_verified,false)
  assert.equal(await env.DB.prepare("SELECT id FROM contacts WHERE email='stranger@example.com'").first(),null)
  // An explicit SPF fail (DKIM only for another domain) may be forged: it starts a
  // separate conversation from a contact flagged as an unverified sender.
  const failed=await (await post(rawForm({messageId:'sendgrid-spf-fail@example.com',envelope:{to:[`support+${firstBody.conversationId}@reply.support.example.com`],from:'bounce@attacker.example'},text:'Please send my refund elsewhere',spf:'fail',dkim:'{@attacker.example : pass}'}))).json()
  assert.equal(failed.state,'suspended');assert.equal(failed.conversationId,null)
  // A header From with no usable address has no author to authenticate; SendGrid's SPF
  // fail for the envelope still counts. With MAIL FROM the customer's address it never
  // joins their thread as them, only one separate conversation flagged unverified.
  const unusable=[['', ''], ['Customer', 'From: Customer\r\n'], ['customer@example', 'From: customer@example\r\n'], ['<>', 'From: <>\r\n']]
  const kept=[]
  for (const [from, header] of unusable) {
    const response = await post(rawForm({ messageId: `sendgrid-unusable-${kept.length}@example.com`, envelope: { to: ['support@reply.support.example.com'], from: 'customer@example.com' }, from, headers: header, text: 'Please change my bank details', spf: 'fail' }))
    assert.equal(response.status, 201, from)
    const held=await response.json();assert.equal(held.state,'suspended');assert.equal(held.conversationId,null);kept.push(held.conversationId)
  }
  assert.equal(new Set(kept).size, 1); assert.notEqual(kept[0], firstBody.conversationId)
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM contacts WHERE json_extract(metadata_json,'$.unverified_sender')=1").first()).n,0)
  // A VERP envelope: the contact is the DKIM-verified From, and Reply-To is only where replies go.
  const verp=await post(rawForm({messageId:'sendgrid-verp@example.com',envelope:{to:['support@reply.support.example.com'],from:'bounces+5719-d26b-x=example.com@em.sender.example.com'},from:'Proof <proof@sender.example.com>',dkim:'{@sender.example.com : pass}',headers:'Reply-To: Desk <desk@desk.example.net>\r\n'}))
  const proof=await env.DB.prepare('SELECT c.email,c.metadata_json FROM contacts c JOIN conversations v ON v.contact_id=c.id WHERE v.id=?').bind((await verp.json()).conversationId).first()
  assert.deepEqual([proof.email,JSON.parse(proof.metadata_json).provided_email],['proof@sender.example.com','desk@desk.example.net'])
  // Google Workspace forwarding: an SRS envelope, the company address in Delivered-To,
  // To and Cc, and an envelope recipient that is not itself a mailbox.
  const forwarded=await post(rawForm({messageId:'sendgrid-forwarded@example.com',envelope:{to:['relay@reply.support.example.com'],from:'SRS0=Hk2=AB=customer.example=ana@company.example'},to:'support@company.example',from:'Ana <ana@customer.example>',dkim:'{@customer.example : pass, @company.example : pass}',headers:'Delivered-To: support@reply.support.example.com\r\nX-Gm-Original-To: support@company.example\r\nCc: Lee <lee@customer.example>, support@company.example\r\n'}))
  assert.equal(forwarded.status,201)
  const ana=await forwarded.json(),anaRows=(await env.DB.prepare('SELECT ct.email FROM conversations v JOIN contacts ct ON ct.id=v.contact_id WHERE v.id=? AND v.project_id=? UNION ALL SELECT ct.email FROM conversation_participants cp JOIN contacts ct ON ct.id=cp.contact_id WHERE cp.conversation_id=?').bind(ana.conversationId,'p',ana.conversationId).all()).results
  assert.deepEqual(anaRows.map(row=>row.email),['ana@customer.example','lee@customer.example'])
  // A widget visitor's typed address answers its notification through the reply
  // address issued to it: the answer continues the chat as the visitor; fresh mail
  // from that address does not.
  await env.DB.batch([
   env.DB.prepare("INSERT INTO contacts(id,project_id,email,metadata_json,created_at) VALUES('visitor','p','rosa@acme.test','{\"email_unproven\":1}',1)"),
   env.DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('chat','p','visitor',1,'chat-hello',1,1)"),
   env.DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('chat-hello','p','chat','hello','visitor','contact','My parcel arrived damaged',1,1)"),
  ])
  const rosaReplyAddress = await m.replyAddress('chat', 'rosa@acme.test')
  const rosa = await (await post(rawForm({ messageId: 'sendgrid-rosa-answer@example.com', envelope: { to: [rosaReplyAddress], from: 'rosa@acme.test' }, to: rosaReplyAddress, from: 'Rosa <rosa@acme.test>', dkim: '{@acme.test : pass}', text: 'Photo attached, the corner is crushed.' }))).json()
  assert.deepEqual([rosa.conversationId, rosa.actor.contactId], ['chat', 'visitor'])
  const rosaFresh = await (await post(rawForm({ messageId: 'sendgrid-rosa-fresh@example.com', envelope: { to: ['support@reply.support.example.com'], from: 'rosa@acme.test' }, from: 'Rosa <rosa@acme.test>', dkim: '{@acme.test : pass}' }))).json()
  assert.notEqual(rosaFresh.conversationId, 'chat')
  // A reply-all names both Rosa's reply address and the bare mailbox in one post. The mail is received once, in
  // the chat; the bare copy is the same mail already received, so SendGrid gets a success and stops retrying,
  // and the chat's AI reply still follows. A redelivery of the whole post writes nothing more.
  await env.DB.batch([
   env.DB.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('ai','p','Assistant','Support','Answer customers.','gpt-5-mini',1)"),
   env.DB.prepare("INSERT INTO conversation_ai VALUES('chat','ai')"),
  ])
  const replyAll = rawForm({ messageId: 'sendgrid-rosa-reply-all@example.com', envelope: { to: [rosaReplyAddress, 'support@reply.support.example.com'], from: 'rosa@acme.test' }, to: `${rosaReplyAddress}, support@reply.support.example.com`, from: 'Rosa <rosa@acme.test>', dkim: '{@acme.test : pass}', text: 'The order number is 4471.' })
  const both = await post(replyAll)
  assert.equal(both.status, 201, await both.clone().text())
  const replyAllRows = () => env.DB.prepare("SELECT id,conversation_id FROM messages WHERE content='The order number is 4471.'").all().then(rows => rows.results)
  assert.deepEqual((await replyAllRows()).map(row => row.conversation_id), ['chat'])
  const [replyAllMessage] = await replyAllRows()
  await m.app.until(() => env.DB.prepare('SELECT id FROM ai_generations WHERE id=?').bind(`reply:${replyAllMessage.id}`).first(), { message: 'AI reply to the reply-all' })
  assert.equal((await post(replyAll)).status, 200)
  assert.equal((await replyAllRows()).length, 1)
  // Once the chat is Closed, Rosa's reply through the same address opens a new ticket of hers, never her email contact's open thread.
  const memberReplyAddress = await m.replyAddress('chat', 'op@example.com')
  await env.DB.prepare("UPDATE conversations SET status_id='closed',status_category='closed' WHERE id='chat'").run()
  const afterClose = await post(rawForm({ messageId: 'sendgrid-rosa-after-close@example.com', envelope: { to: [rosaReplyAddress], from: 'rosa@acme.test' }, to: rosaReplyAddress, from: 'Rosa <rosa@acme.test>', dkim: '{@acme.test : pass}', text: 'The replacement is damaged too.' }))
  assert.equal(afterClose.status, 201)
  const followUp = await afterClose.json()
  assert.equal(followUp.actor.contactId, 'visitor')
  assert.ok(!['chat', rosaFresh.conversationId].includes(followUp.conversationId))
  // A member's reply to the Closed ticket is refused with 422, stored as nothing, and answered with one notice to the member, also when SendGrid retries.
  const sentBefore = m.mail.sent.length
  const memberForm = () => rawForm({ messageId: 'sendgrid-member-closed@example.com', envelope: { to: [memberReplyAddress], from: 'op@example.com' }, to: memberReplyAddress, from: 'Operator <op@example.com>', text: 'Answer by email after close' })
  assert.equal((await post(memberForm())).status, 422)
  assert.equal((await post(memberForm())).status, 422)
  assert.equal((await m.claim('sendgrid-member-closed@example.com')).state, 'ignored')
  assert.equal(await m.count("SELECT count(*) n FROM messages WHERE content='Answer by email after close'"), 0)
  assert.equal(await m.count("SELECT count(*) n FROM contacts WHERE lower(email)='op@example.com'"), 0)
  assert.deepEqual(m.mail.sent.slice(sentBefore).map(entry => entry.body.to), [['op@example.com']])
 }finally{await m.close()}
}
