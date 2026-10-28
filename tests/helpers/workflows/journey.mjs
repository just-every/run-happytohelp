import assert from 'node:assert/strict'
import {workflowFixture} from './fixture.mjs'
import {slaSlackFlow} from './sla-slack.mjs'
import {slaFlow} from './sla.mjs'
import {rulesFlow} from './rules.mjs'
import {routingFlow} from './routing.mjs'
import {schedulesFlow} from './schedules.mjs'
export async function workflowsJourney(shared){
 const f=await workflowFixture(shared)
  await slaFlow(f);await rulesFlow(f);await routingFlow(f);await schedulesFlow(f)
  f.finishErasure=async eraseCustomer=>{
  const tables=['workflow_events','ticket_followups','ticket_sla_state','sla_alerts','workflow_runs','workflow_action_receipts','workflow_notifications','workflow_time_state','routing_decisions','workflow_schedules']
  const rows=async contact=>{const r={};for(const table of tables)r[table]=(await f.app.first(`SELECT count(*) n FROM ${table} WHERE project_id=?1 AND ${table==='ticket_followups'?'original_id':'conversation_id'} IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)`,f.w.projectId,contact)).n;return r}
  const configuration=async()=>Promise.all(['workflow_rules','workflow_rule_versions','sla_policies','workflow_calendars','routing_operators'].map(table=>f.app.sql(`SELECT * FROM ${table} WHERE project_id=? ORDER BY 1,2`,f.w.projectId)))
  // Erasing a customer whose short name occurs in rule, policy and calendar names and in hex ids removes only that customer's rows.
  const ed=await f.app.ok('/api/identity/widget/session',{body:{widgetKey:f.w.widgetKey,name:'Ed',email:'ed@example.test'},headers:{Origin:f.w.allowedOrigin}})
  const edTicket=await f.app.ok('/api/conversations',{token:ed.token,body:{projectId:f.w.projectId}});await f.app.ok(`/api/conversations/${edTicket.id}/messages`,{token:ed.token,body:{localId:'ed-first',content:'My order arrived damaged.',expectedRevision:0}})
  const [customerRows,settings]=[await rows(f.customer.contactId),await configuration()]
  assert.ok(Object.values(customerRows).some(n=>n>0),'the same ticket customer has retained workflow history before erasure')
  assert.ok(Object.values(await rows(ed.contactId)).some(n=>n>0))
  assert.equal((await f.app.call(`/api/management/projects/${f.w.projectId}/contacts/${ed.contactId}/erase`,{token:f.w.tokens.owner,body:{}})).status,200)
  assert.deepEqual(await rows(ed.contactId),Object.fromEntries(tables.map(table=>[table,0])))
  assert.deepEqual(await rows(f.customer.contactId),customerRows);assert.deepEqual(await configuration(),settings)
  await eraseCustomer()
  assert.deepEqual(await rows(f.customer.contactId),Object.fromEntries(tables.map(table=>[table,0])))
  assert.ok((await f.app.first('SELECT ticket_records FROM contact_erasures WHERE project_id=? AND contact_id=?',f.w.projectId,f.customer.contactId)).ticket_records>0)

  }
  // Escalate the same customer's commitments through the configured Slack edge.
  for(const policy of await f.ok('/sla-policies'))await f.ok(`/sla-policies/${policy.id}`,{active:false},'PATCH')
  await f.ok(`/sla-policies/${f.policy.id}`,{active:true},'PATCH')
  await slaSlackFlow(f,f.policy,f.calendar)
  return f
}
