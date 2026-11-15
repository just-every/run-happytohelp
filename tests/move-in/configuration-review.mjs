import assert from 'node:assert/strict'
import {json,rows} from './journey-kit.mjs'

// Inspect exactly the configuration imported with the source tickets. Previewing
// a translated rule is pure; publication remains a separate owner decision.
export async function configurationReview(h,plan){
 const dashboard='/api/dashboard/projects/p',forms=(await h.call('/api/forms/projects/p/forms')).data,definitions=(await h.call(dashboard+'/ticket-fields')).data
 assert.equal(forms.length,2);assert.ok(forms.every(form=>form.enabled===false))
 assert.equal(definitions.length,6)
 assert.equal(definitions.find(field=>field.name==='Order number').required,false)
 assert.ok(plan.decisions.find(row=>row.kind==='ticket_field'&&row.sourceId==='301').omissions.some(item=>item.reason==='field_solve_requirement_requires_native_review'))
 const imported=(await rows(h,"SELECT conversation_id FROM move_in_conversations WHERE source_id='10001'"))[0]
 const ticket=(await h.call(`${dashboard}/conversations/${imported.conversation_id}/ticket`)).data
 assert.deepEqual(Object.fromEntries(definitions.map(field=>[field.name,ticket.fields[field.id]])),{'Order number':'ORDER-187',Items:2,'Replacement requested':false,Reason:'shipping','Internal triage':'synthetic-hh-305 internal triage','Portal reference':'synthetic-hh-306 portal reference'})
 const decision=(kind,id)=>plan.decisions.find(row=>row.kind===kind&&row.sourceId===id)
 assert.ok(decision('ticket_field','306').omissions.some(item=>item.reason==='field_portal_read_only_not_carried'))
 for(const [kind,id] of [['ticket_field','307'],['ticket_form','404'],['ticket_form','405']])assert.equal(decision(kind,id).rejection,'field_permissions_require_native_review')
 const ticketOmissions=decision('ticket','10001').omissions.map(item=>item.reason)
 assert.ok(ticketOmissions.includes('ticket_custom_field_unsupported:307'))
 assert.ok(!ticketOmissions.some(reason=>/^ticket_custom_field_unsupported:30[56]$/.test(reason)))
 assert.ok(definitions.every(field=>field.updated_at===Date.parse('2024-01-02T00:00:00Z')),'field source timestamps survive')
 assert.equal((await h.raw(`${dashboard}/conversations/${imported.conversation_id}/ticket`,{actor:'foreign'})).response.status,404)
 assert.deepEqual((await h.call('/api/forms/p')).data,[],'import publishes no customer form')
 for(const form of forms)assert.equal((await h.raw('/api/forms/p/'+form.id)).response.status,404)
 const rules=(await h.call(dashboard+'/workflow-rules')).rules.filter(rule=>['Escalate normal work','Pending after one hour'].includes(rule.name))
 assert.equal(rules.length,2);assert.ok(rules.every(rule=>rule.state==='draft'&&rule.version===0))
 const event=rules.find(rule=>rule.kind==='event'),preview=await h.call(`${dashboard}/workflow-rules/${event.id}/preview`,json({}))
 assert.equal(preview.side_effects,false);assert.ok(preview.matched>=1)
 assert.ok((await rows(h,'SELECT priority FROM conversations')).every(row=>row.priority==='normal'))
 assert.equal((await rows(h,'SELECT COUNT(*) n FROM workflow_runs'))[0].n,0)
 assert.deepEqual((await rows(h,'SELECT name FROM ticket_groups ORDER BY name')).map(row=>row.name),['Billing','Technical'])
 assert.equal((await rows(h,'SELECT COUNT(*) n FROM ticket_group_members'))[0].n,0)
 const calendar=(await rows(h,'SELECT * FROM workflow_calendars'))[0]
 assert.equal(calendar.active,0);assert.equal(calendar.timezone,'America/New_York')
 assert.deepEqual(JSON.parse(calendar.weekly_json),[{day:1,start:'09:00',end:'17:00'}])
 assert.deepEqual(JSON.parse(calendar.closures_json),['2024-12-25','2024-12-26'])
 const views=(await h.call(dashboard+'/ticket-views')).data
 assert.equal(views.length,1);assert.equal(views[0].visibility,'personal')
 assert.deepEqual(views[0].filters,[{field:'status_id',operator:'eq',value:'open'}])
 assert.equal((await h.call(dashboard+'/ticket-views',{actor:'operator'})).data.length,0)
 assert.ok(plan.decisions.find(row=>row.kind==='automation').omissions.some(item=>item.reason==='automation_native_hour_boundary_once_per_eligibility_episode'))
 assert.equal(plan.decisions.find(row=>row.kind==='trigger'&&row.sourceId==='78').rejection,'configuration_action_unsupported:notification_user')
 assert.ok(plan.decisions.find(row=>row.kind==='ticket_form'&&row.sourceId==='403').rejection)
}

// Customer admission changes authority state and deliberately fences whole-import
// undo. Probe it after the same journey has already proved exact repeat/undo.
export async function configurationConfidentiality(h){
 const [{conversation_id:id}]=await rows(h,"SELECT conversation_id FROM move_in_conversations WHERE source_id='10001'")
 const [{contact_id:contact}]=await rows(h,'SELECT contact_id FROM conversations WHERE id=?',id)
 await h.contactSession('field-customer','p',contact)
 assert.equal((await h.raw(`/api/dashboard/projects/p/conversations/${id}/ticket`,{actor:'field-customer'})).response.status,403)
 assert.doesNotMatch(JSON.stringify(await h.call(`/api/conversations/${id}/messages`,{actor:'field-customer'})),/synthetic-hh-30[567]/,'internal values never reach the customer transcript')
 assert.deepEqual((await h.call('/api/forms/p',{actor:'field-customer'})).data,[],'no imported field is published to a customer form')
}
