import assert from 'node:assert/strict'
import {writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {nativeHarness} from './harness.mjs'
import {review,apply,undo,rows,root,json} from './journey-kit.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
import {fidelityCorpus,supportedTypes,at,later} from './zendesk-fidelity-fixture.mjs'

// One real owner flow. Assertions derive expectations from the synthetic export,
// never from fixed wording or expected content counts in the repository.
export async function zendeskFidelityJourney(){
 console.log('ZENDESK_FIDELITY generating')
 const fixture=await fidelityCorpus();console.log('ZENDESK_FIDELITY starting native runtime')
 const h=await nativeHarness(),o=fixture.objects
 console.log('ZENDESK_FIDELITY reviewing')
 const receipt={head:process.env.H2H_CANDIDATE_SHA??null,source:'synthetic only',queries:[],checks:[]}
 const query=async sql=>{const result=await rows(h,sql);receipt.queries.push({sql,rows:result});return result}
 try{
  const before=await h.snapshot(),plan=await review(h,'zendesk',fixture.archive,'synthetic-hh-documented.zip')
  assertBusinessEquality(before,await h.snapshot())
  const tickets=plan.plan.decisions.filter(d=>d.kind==='ticket')
  assert.deepEqual(tickets.map(d=>d.sourceId).sort(),o.ticket.map(t=>String(t.id)).sort())
  assert.ok(tickets.every(d=>!d.rejection&&d.targets.length===1),JSON.stringify(tickets.filter(d=>d.rejection).map(d=>[d.sourceId,d.rejection])))
  for(const t of o.ticket){const target=tickets.find(d=>d.sourceId===String(t.id)).targets[0];assert.deepEqual(target.transcript,{comments:t.comments.filter(c=>c.public).length,notes:t.comments.filter(c=>!c.public).length,status:t.status,tags:t.tags.length,fields:supportedTypes.length})}
  for(const kind of ['identity','organization_membership','group_membership','section','satisfaction_rating'])assert.ok(plan.plan.decisions.filter(d=>d.kind===kind).every(d=>d.targets.length===0&&d.omissions.length),'source-only records never count as native successes')
  assert.equal((await h.raw(`${root}/${plan.id}/apply`,json({fingerprint:'stale'}))).response.status,409)
  console.log('ZENDESK_FIDELITY applying');await apply(h,plan)
  const native=await query("SELECT s.source_id,c.id,c.contact_id,c.created_at,c.updated_at,c.priority,c.status_category,c.assigned_to,c.group_id,s.source_state,s.subject FROM conversations c JOIN move_in_conversations s ON s.conversation_id=c.id ORDER BY CAST(s.source_id AS INTEGER)")
  assert.equal(native.length,o.ticket.length)
  for(const t of o.ticket){const c=native.find(c=>c.source_id===String(t.id));assert.equal(c.created_at,Date.parse(t.created_at));assert.equal(c.updated_at,Date.parse(t.updated_at));assert.equal(c.priority,t.priority);assert.equal(c.source_state,t.status);assert.equal(c.status_category,t.status==='hold'?'on_hold':t.status);assert.equal(c.subject,t.subject);assert.equal(c.assigned_to,null);assert.equal(c.group_id,null)}
  const contacts=await query('SELECT id,name,email,is_verified,metadata_json FROM contacts ORDER BY email')
  assert.equal(contacts.length,o.user.filter(u=>u.role==='end-user').length)
  for(const u of o.user.filter(u=>u.role==='end-user')){const c=contacts.find(c=>c.email===u.email);assert.ok(c);assert.equal(c.name,u.name);assert.equal(c.is_verified,0);assert.equal(JSON.parse(c.metadata_json).phone,u.phone)}
  assert.equal((await query('SELECT * FROM contact_companies')).length,o.user.filter(u=>u.organization_id).length)
  const messages=await query('SELECT m.content,m.created_at,s.source_id,s.author_json FROM messages m JOIN move_in_message_sources s ON s.message_id=m.id ORDER BY m.id'),notes=await query('SELECT content,created_at,author_json FROM move_in_notes ORDER BY id')
  assert.equal(messages.length,o.ticket.flatMap(t=>t.comments).filter(c=>c.public).length);assert.equal(notes.length,o.ticket.flatMap(t=>t.comments).filter(c=>!c.public).length)
  for(const t of o.ticket)for(const c of t.comments){const got=c.public?messages.find(m=>m.source_id===String(c.id)):notes.find(n=>n.content===c.plain_body);assert.ok(got);assert.equal(got.content,c.plain_body);assert.equal(got.created_at,Date.parse(c.created_at));const author=JSON.parse(got.author_json);assert.equal(author.id,String(c.author_id));assert.equal(author.role,c.author_id===-1?'system':c.author_id<=200?'contact':'operator')}
  const fields=await query('SELECT v.conversation_id,v.value_json,f.name,f.type FROM ticket_field_values v JOIN ticket_fields f ON f.id=v.field_id ORDER BY v.conversation_id,f.name')
  assert.equal(fields.length,o.ticket.length*supportedTypes.length)
  for(const t of o.ticket){const conversation=native.find(c=>c.source_id===String(t.id));for(const value of t.custom_fields.slice(0,supportedTypes.length)){const definition=o.ticket_field.find(f=>f.id===value.id),got=fields.find(f=>f.conversation_id===conversation.id&&f.name===definition.title);assert.ok(got);assert.deepEqual(JSON.parse(got.value_json),['integer','decimal'].includes(definition.type)?Number(value.value):value.value)}}
  const media=await query('SELECT m.id,m.conversation_id,m.message_id,m.filename,a.base64 FROM media m JOIN move_in_attachment_bytes a ON a.media_id=m.id ORDER BY m.id')
  assert.equal(media.length,o.ticket.flatMap(t=>t.comments).flatMap(c=>c.attachments).length)
  for(const m of media){const response=await h.download(`/api/conversations/${m.conversation_id}/media/${m.id}`);assert.equal(response.status,200);assert.deepEqual(response.bytes,Buffer.from(m.base64,'base64'));assert.equal((await h.download(`/api/conversations/${m.conversation_id}/media/${m.id}`,'foreign')).status,404)}
  const first=native[0];await h.contactSession('visitor','p',first.contact_id)
  const publicView=await h.call(`/api/conversations/${first.id}/messages`,{actor:'visitor'});assert.doesNotMatch(JSON.stringify(publicView),/private investigation/)
  for(const m of media.filter(m=>m.conversation_id===first.id))assert.equal((await h.download(`/api/conversations/${first.id}/media/${m.id}`,'visitor')).status,m.message_id?200:404)
  const detail=(await h.call(`/api/dashboard/projects/p/conversations/${first.id}`)).data;assert.equal(detail.subject,o.ticket[0].subject)
  const history=await h.call(`/api/conversations/${first.id}/imported-history`);assert.equal(history.history.events.length,o.audit[0].events.length)
  const importedRules=(await query('SELECT * FROM workflow_rules')).filter(r=>!before.workflow_rules.some(old=>old.id===r.id));assert.equal(importedRules.length,o.trigger.length+o.automation.length);assert.ok(importedRules.every(r=>r.state==='draft'))
  for(const table of ['ticket_sla_state','sla_alerts','sla_policies'])assert.equal((await query(`SELECT * FROM ${table}`)).length,0)
  receipt.checks.push('review is inert; all tickets, authors, exact instants, typed values and phones reconcile; source-only kinds have no targets; attachment bytes and privacy; draft rules and no SLA activation')
  console.log('ZENDESK_FIDELITY repeat and undo');const applied=await h.snapshot()
  // Repackage the very same objects into the previously supported NDJSON door.
  const repeat=await review(h,'zendesk',fixture.wrapped+'\n','synthetic-hh-repackaged.ndjson');await apply(h,repeat);assertBusinessEquality(applied,await h.snapshot())
  await undo(h,plan);assertBusinessEquality(before,await h.snapshot());assert.equal(h.outbound,0)
  receipt.checks.push('same export through old NDJSON door adds no business state; whole-import undo restores exact business state; zero outbound requests')
  // A malformed typed value must be refused, never rounded into a new value.
  console.log('ZENDESK_FIDELITY numeric refusal');const invalid=structuredClone(fixture.records);invalid.find(r=>r.ticket).ticket.custom_fields.find(v=>v.id===702).value='9007199254740993'
  const refused=await review(h,'zendesk',invalid.map(JSON.stringify).join('\n'),'synthetic-hh-invalid.ndjson');assert.match(refused.plan.decisions.find(d=>d.kind==='ticket'&&d.sourceId===String(o.ticket[0].id)).rejection,/ticket_numeric_field_not_representable/)
  // The documented API response itself does not contain comments. It remains
  // refused instead of manufacturing a conversation from description alone.
  const missing={...o.ticket[0]};delete missing.comments
  const incomplete=await review(h,'zendesk',JSON.stringify({tickets:[missing],users:o.user}),'synthetic-hh-api-incomplete.json');assert.equal(incomplete.plan.decisions.find(d=>d.kind==='ticket').rejection,'ticket_comments_required')
  const signed=await h.raw(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'synthetic-hh-sensitive-page.json'},body:JSON.stringify({users:[o.user[0]],next_page:'https://synthetic-hh.example.test/users?token=synthetic-hh-949'})});assert.equal(signed.response.status,422);assert.equal(signed.data.diagnostic.code,'signed_download_link_not_accepted')
  receipt.checks.push('unrepresentable numeric string and API ticket without comments refused explicitly')
  receipt.counts={customers:contacts.length,tickets:native.length,publicComments:messages.length,privateNotes:notes.length,typedValues:fields.length,attachmentFiles:media.length,review:plan.plan.counts,afterUndo:'exact business equality',outbound:h.outbound}
  if(process.env.H2H_FIDELITY_RECEIPT){const path=process.env.H2H_FIDELITY_RECEIPT;await mkdir(join(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(receipt,null,2)+'\n');await writeFile(join(path,'..','REVIEW.json'),JSON.stringify(plan,null,2)+'\n')}
  console.log('ZENDESK_FIDELITY passed',JSON.stringify(receipt.counts));return receipt
 }finally{await h.close()}
}
