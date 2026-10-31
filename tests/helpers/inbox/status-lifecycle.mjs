import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {recipients, replyTo} from '../email/app.mjs'

// STATUS-001 complements ticketsJourney/deskWorkflows/timeAutomationFlow.
// Only DNS and the outbound mail provider are fixtures. Customer identity,
// inbox mutations, email admission, portal sessions, SLA and reports use routes.
export async function statusLifecycleJourney() {
 const hour = 3600000, initial = Date.now() + 60000, mail = []
 const app = await startApp({
  captureQueue: true,
  bindings: {APP_ORIGIN: 'https://app.example', H2H_LOCAL: 'true', H2H_WORKFLOW_NOW: String(initial),
   EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'synthetic-status-provider', EMAIL_FROM: 'support@example.test',
   INBOUND_EMAIL_TOKEN: 'synthetic-status-gateway'},
  outbound: async request => {
   if (new URL(request.url).hostname === 'cloudflare-dns.com')
    return Response.json({Status: 0, Answer: [{type: 15, data: '10 mx.example.test.'}]})
   assert.equal(request.url, 'https://api.resend.com/emails', 'only the mail provider may be called')
   mail.push(await request.json())
   return Response.json({id: 'status-mail-' + mail.length})
  },
 })
 try {
  const w = await app.seedWorkspace('status-lifecycle'), p = w.projectId
  const base = '/api/dashboard/projects/' + p, management = '/api/management/projects/' + p
  const owner = {token: w.tokens.owner}
  const door = async (path, body, method, token = w.tokens.owner) => {
   const response = await app.ok(base + path, {token, body, method})
   return response.data ?? response
  }
  const get = id => door('/conversations/' + id + '/ticket')
  const patch = async (id, changes) => door('/conversations/' + id + '/ticket',
   {expected_version: (await get(id)).ticket_version, ...changes}, 'PATCH')
  const clock = async at => {await app.configure({H2H_WORKFLOW_NOW: String(at)}); await app.scheduled()}
  const inbox = () => app.ok(management + '/notification-inbox', owner).then(result => result.data)
  const gateway = async body => {
   const result = await app.ok('/api/integrations/email/inbound',
    {headers: {Authorization: 'Bearer synthetic-status-gateway'}, body})
   await app.scheduled() // inbound mail's durable outbox drives its notifications
   return result
  }
  await app.ok(management + '/email-settings', {...owner, method: 'PUT', body: {
   from_name: 'Returns support', from_address: 'support@example.test', inbound_address: 'help@example.test', is_enabled: true,
  }})
  await app.presenceAwayOff(p)

  const incoming = await gateway({messageId: 'status-request', from: 'dana@example.test', to: 'help@example.test',
   subject: 'Replacement delivery', text: 'Please check the replacement delivery.'})
  const id = incoming.conversationId, original = await get(id)
  assert.equal(original.status_category, 'new')
  const requester = original.requester_id
  const secret = (await app.first('SELECT verification_secret FROM projects WHERE id=?', p)).verification_secret
  const visitor = await app.ok('/api/identity/widget/session', {headers: {Origin: w.allowedOrigin}, body: {
   widgetKey: w.widgetKey, email: 'dana@example.test',
   contact_hash: createHmac('sha256', secret).update('dana@example.test').digest('hex'),
  }})
  assert.equal(visitor.contactId, requester, 'the signed widget returns to the email requester')
  const send = async (content, token = visitor.token, ticket = id) => {
   const current = await get(ticket)
   return app.ok('/api/conversations/' + ticket + '/messages', {token, body: {
    localId: crypto.randomUUID(), content, expectedRevision: current.revision, expectedLastMessageId: current.last_message_id,
   }})
  }
  await send('We are checking your delivery.', w.tokens.owner)
  assert.equal((await get(id)).status_category, 'open', 'an operator reply moves New to Open')

  // Read the owner's actual notification inbox after a Pending customer reply.
  await patch(id, {assigned_to: w.users.owner, status_id: 'pending'})
  const notices = new Set((await inbox()).map(row => row.id))
  await send('Here is the requested delivery address.')
  assert.equal((await get(id)).status_category, 'open')
  assert.equal((await get(id)).assigned_to, w.users.owner)
  const wake = (await inbox()).find(row => !notices.has(row.id) && row.conversation_id === id && row.kind === 'customer_updated')
  assert.ok(wake, 'the assigned owner receives a customer-reply wake')
  assert.equal(wake.read_at, null)
  await app.configure({})
  assert.ok((await inbox()).some(row => row.id === wake.id), 'the wake survives a Worker restart')

  // Redeem the real customer portal mail, rather than minting a portal identity.
  const beforeSignIn = mail.length
  await app.call('/api/portal/' + p + '/access/request', {status: 202,
   headers: {Origin: app.origin}, body: {email: 'dana@example.test'}})
  const signIn = mail.slice(beforeSignIn).find(entry => recipients(entry).includes('dana@example.test'))
  assert.ok(signIn)
  const url = new URL(signIn.text.match(/https:\/\/app\.example\/api\/portal\/\S+/)[0])
  const verified = await app.request(url.pathname + url.search)
  assert.equal(verified.status, 303)
  const portal = {headers: {Cookie: verified.headers.get('set-cookie').split(';')[0], Origin: app.origin}}
  const portalBase = '/api/portal/' + p + '/tickets'
  const customHold = await door('/ticket-statuses', {name: 'Internal warehouse escalation', category: 'on_hold'})
  let address
  for (const status of ['on_hold', customHold.id]) {
   await patch(id, {status_id: status})
   assert.equal((await get(id)).status_category, 'on_hold')
   const widget = await app.ok('/api/conversations/' + id, {token: visitor.token})
   assert.equal(widget.status_id, 'open')
   assert.equal(widget.status_category, 'open')
   const detail = await app.ok(portalBase + '/' + id, portal)
   const listed = (await app.ok(portalBase, portal)).tickets.find(ticket => ticket.id === id)
   assert.equal(detail.ticket.status, 'open')
   assert.equal(listed.status, 'open')
   for (const visible of [widget, detail, listed])
    assert.doesNotMatch(JSON.stringify(visible), /on_hold|on-hold|Internal warehouse escalation/i)
   const beforeMail = mail.length
   await door('/conversations/' + id, {send_transcript_to: 'dana@example.test', idempotencyKey: crypto.randomUUID()}, 'PUT')
   const transcript = await app.until(() => mail.slice(beforeMail).find(entry => recipients(entry).includes('dana@example.test')))
   assert.match(transcript.text, /Here is the requested delivery address/)
   assert.doesNotMatch(transcript.subject + transcript.text + transcript.html, /on_hold|on-hold|Internal warehouse escalation/i)
   address = replyTo(transcript)
   assert.ok(address, 'customer email exposes its real reply door')
  }
  const holdNotices = new Set((await inbox()).map(row => row.id))
  await send('The warehouse has my new address.')
  assert.equal((await get(id)).status_category, 'open', 'a custom On-hold also returns to Open')
  assert.ok((await inbox()).some(row => !holdNotices.has(row.id) && row.conversation_id === id && row.kind === 'customer_updated'))

  // An authenticated inbound reply traverses the customer mail door, including
  // the same Pending/On-hold wake and Solved reopen semantics as the widget.
  for (const [index, status] of ['pending', 'on_hold', 'solved'].entries()) {
   await clock(initial + (index + 1) * 1000)
   await patch(id, {status_id: status})
   const before = new Set((await inbox()).map(row => row.id))
   const reply = await gateway({messageId: 'status-email-' + status, to: address,
    from: 'dana@example.test', text: 'Please check my replacement again: ' + status})
   assert.equal(reply.conversationId, id)
   assert.equal((await get(id)).status_category, 'open', status + ' reopens through email')
   assert.ok((await inbox()).some(row => !before.has(row.id) && row.conversation_id === id && row.kind === 'customer_updated'))
   const event = (await get(id)).history.find(row => row.source === 'email' && row.changes.status_category?.from === status && row.changes.status_category?.to === 'open')
   assert.ok(event, status + ' records its email transition')
   assert.equal(event.actor_id, requester)
   assert.equal(event.actor_type, 'contact')
   assert.ok(Number.isSafeInteger(event.at))
  }

  // Prove only custom Pending's use of existing SLA/report doors. No SLA or
  // reporting fixtures, engine code or other clause tests are changed here.
  const calendar = await door('/workflow-calendars', {name: 'Daily support', timezone: 'UTC',
   weekly: [0, 1, 2, 3, 4, 5, 6].map(day => ({day, start: '00:00', end: '23:59'})), holidays: 'none', closures: []})
  await door('/sla-policies', {name: 'Replacement commitment', calendar_id: calendar.id, conditions: {},
   first_response_minutes: 120, next_response_minutes: 120, resolution_minutes: 480, pause_on_hold: false})
  const customPending = await door('/ticket-statuses', {name: 'Waiting for delivery details', category: 'pending'})
  await clock(initial + hour)
  await patch(id, {status_id: customPending.id})
  const sla = () => door('/conversations/' + id + '/sla')
  const paused = await sla()
  assert.equal(paused.pause_reason, 'pending')
  const active = paused.clocks.filter(row => row.completed_at === null)
  assert.ok(active.some(row => row.metric === 'resolution'))
  assert.ok(active.every(row => row.due_at === null))
  await clock(initial + 2 * hour)
  assert.deepEqual((await sla()).clocks, paused.clocks, 'custom Pending charges no business time')
  const start = new Date(original.created_at - 86400000).toISOString().slice(0, 10)
  const end = new Date(initial + 3 * 86400000).toISOString().slice(0, 10)
  const report = await door('/reports/team?period=custom&start=' + start + '&end=' + end)
  assert.equal(report.denominators.cohort, 1)
  assert.equal(report.backlog.total, 1, 'custom Pending remains an unresolved request')
  assert.equal(report.workload.agent.find(row => row.id === w.users.owner).backlog, 1)
  const attributed = report.breakdowns.channel.find(row => row.id === 'email')
  assert.equal(attributed.tickets, 1)
  assert.equal(attributed.sla.resolution.pending, 1, 'the paused resolution remains attributed to the email ticket')
  assert.equal(attributed.sla.resolution.breached, 0)
  await send('I found the delivery reference.')
  assert.equal((await get(id)).status_id, 'open')
  assert.equal((await sla()).pause_reason, null)
  assert.ok((await sla()).clocks.some(row => row.completed_at === null && row.due_at !== null))

  // Fields, explicit customer CCs and tags are carried through the Closed email
  // reply; the original remains final with its unchanged message frontier.
  const field = await door('/ticket-fields', {name: 'Replacement reference', type: 'text'})
  await patch(id, {fields: {[field.id]: 'RMA-STATUS-001'}})
  const tag = await door('/conversations/' + id + '/tags', {name: 'Replacement lifecycle'})
  for (const email of ['warehouse-cc@example.test', 'dispatch-cc@example.test'])
   await door('/conversations/' + id + '/participants', {email})
  const participants = (await door('/conversations/' + id)).participants.map(row => row.email).sort()
  assert.equal(participants.length, 2)

  // The default four-day close is already asserted by timeAutomationFlow.
  // Here the lead changes it to twelve hours through the existing rule door.
  const template = (await door('/workflow-rules')).templates.find(row => row.time.field === 'solved_at')
  assert.equal(template.time.hours, 96)
  const {rule} = await door('/workflow-rules', {...template, name: 'Replacement 12h close', time: {...template.time, hours: 12}})
  await door('/workflow-rules/' + rule.id + '/publish', {})
  await patch(id, {status_id: 'solved'})
  const solved = await get(id), closeAt = solved.resolved_at + 12 * hour
  await clock(closeAt - hour) // the existing automation scans once per hour
  assert.equal((await get(id)).status_category, 'solved', 'no early close')
  await clock(closeAt)
  assert.equal((await get(id)).status_category, 'closed')
  await app.configure({})
  await app.scheduled()
  const closed = await get(id)
  const closure = closed.history.filter(row => row.changes.status_category?.to === 'closed')
  assert.equal(closure.length, 1, 'restart cannot duplicate the close')
  assert.equal(closure[0].source, 'automation')
  assert.equal(closure[0].actor_id, 'automation ' + rule.name)
  assert.equal(closure[0].at, closeAt)
  const runs = (await door('/workflow-runs?conversation_id=' + id)).runs.filter(row => row.rule_id === rule.id)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].state, 'complete')
  const finality = await app.call(base + '/conversations/' + id + '/ticket', {...owner, method: 'PATCH',
   body: {status_id: 'open', expected_version: closed.ticket_version}})
  assert.equal(finality.status, 409)

  const payload = {messageId: 'status-closed-reply', to: address, from: 'dana@example.test',
   subject: 'Replacement still missing', text: 'Please open a follow-up for this replacement.'}
  const followup = await gateway(payload), nextId = followup.conversationId
  assert.notEqual(nextId, id)
  assert.equal((await gateway(payload)).conversationId, nextId, 'duplicate mail reuses the follow-up')
  const next = await get(nextId)
  assert.equal(next.requester_id, requester)
  assert.equal(next.contact_id, original.contact_id)
  assert.equal(next.fields[field.id], 'RMA-STATUS-001')
  assert.deepEqual(next.tags.map(row => row.id), [tag.id])
  assert.deepEqual((await door('/conversations/' + nextId)).participants.map(row => row.email).sort(), participants)
  assert.equal((await door('/conversations/' + nextId + '/workflows')).followup_of, id)
  assert.deepEqual((await door('/conversations/' + id + '/workflows')).followups.map(row => row.id), [nextId])
  assert.equal((await get(id)).revision, closed.revision)
  assert.equal((await get(id)).last_message_id, closed.last_message_id)
  assert.equal((await get(id)).status_category, 'closed')

  // A real invited collaborator may read but cannot change the status.
  const invited = await app.ok(management + '/agents', {...owner, body: {email: 'status-collaborator@example.test', role: 'collaborator'}})
  const invitation = new URL(invited.data.invitationUrl).searchParams.get('token')
  await app.ok('/api/identity/accept-token', {body: {token: invitation, name: 'Status observer', password: 'synthetic-status-collaborator-password'}})
  const collaborator = await app.ok('/api/identity/login', {body: {email: 'status-collaborator@example.test', password: 'synthetic-status-collaborator-password'}})
  const beforeRefusal = await get(nextId)
  for (const area of ['dashboard', 'management']) {
   const refused = await app.call('/api/' + area + '/projects/' + p + '/conversations/' + nextId + '/ticket',
    {token: collaborator.token, method: 'PATCH', body: {status_id: 'solved', expected_version: beforeRefusal.ticket_version}})
   assert.equal(refused.status, 403)
   assert.equal(refused.data.permission, 'conversations.manage')
  }
  assert.deepEqual(await get(nextId), beforeRefusal, 'forbidden status changes leave ticket and history unchanged')
  const audit = (await app.ok(management + '/audit?limit=200', owner)).data
  assert.ok(audit.some(row => row.outcome === 'refused' && row.actor_id === collaborator.actor.id))
  console.log('STATUS-001: widget/email reopen and owner wakes; hidden holds in widget/portal/mail; custom Pending SLA/report; configured close; requester/CC/tag/field follow-up; forbidden role passed')
 } finally {
  await app.close()
 }
}
