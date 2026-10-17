import assert from 'node:assert/strict'
import {workflowFixture} from './fixture.mjs'
import {slaFlow} from './sla.mjs'
import {rulesFlow} from './rules.mjs'
import {routingFlow} from './routing.mjs'
import {schedulesFlow} from './schedules.mjs'
export async function workflowsJourney(){
 const f=await workflowFixture()
 try{
  await slaFlow(f);await rulesFlow(f);await routingFlow(f);await schedulesFlow(f)
  const result=await f.app.call(`/api/management/projects/${f.w.projectId}/contacts/${f.customer.contactId}/erase`,{token:f.w.tokens.owner,body:{}})
  assert.equal(result.status,200,JSON.stringify(result.data))
  for(const table of ['workflow_events','ticket_followups','ticket_sla_state','sla_alerts','workflow_runs','workflow_action_receipts','workflow_notifications','workflow_time_state','routing_decisions','workflow_schedules'])assert.equal((await f.app.first(`SELECT count(*) n FROM ${table} WHERE project_id=?`,f.w.projectId)).n,0,table)
  assert.ok((await f.app.first('SELECT ticket_records FROM contact_erasures WHERE project_id=? AND contact_id=?',f.w.projectId,f.customer.contactId)).ticket_records>0)
 }finally{await f.app.close()}
}
