import assert from 'node:assert/strict'
import {evidence} from '../../journeys/kit/browser.mjs'
export async function slaTeamsBrowser({page,runtime,fixture}){
 const {projectId,base,api,tickets}=fixture,shot=await evidence('sla-teams')
 // Assertions stay at desktop width; the same changed screens are captured once
 // at desktop and phone widths for the candidate's browser evidence.
 const capture=async name=>{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000});await page.waitForTimeout(350)
   if(name.startsWith('alert-')){
    if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click()
    await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('.workflow-panel').scrollIntoViewIfNeeded()
   }else await page.getByLabel('Teams escalation destination',{exact:true}).scrollIntoViewIfNeeded()
   await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 // The connection command is the same native, step-up protected door used by
 // Ticket > Escalations > Connections. Connecting alone sends nothing.
 const installed=(await api(`/api/escalations/projects/${projectId}/connections`,{provider:'teams',target:'11111111-1111-4111-8111-111111111111/'+['19:synthetic-channel','thread.tacv2'].join('@'),token:'synthetic-hh-teams'})).data
 const connection=(await api(base+'/sla-teams-destinations')).data.find(row=>row.id===installed.id)
 const calendar=(await api(base+'/workflow-calendars',{name:'Teams support hours',timezone:'UTC',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),holidays:'none',closures:[]})).data
 const me=(await api('/api/management/bootstrap')).currentAgent
 const policy=(await api(base+'/sla-policies',{name:'Teams backup proof',calendar_id:calendar.id,position:0,conditions:{channels:['phone'],priorities:['urgent']},first_response_minutes:30,approaching_minutes:15,backup_user_ids:[me.id]})).data
 await page.goto(`${runtime.origin}/projects/${projectId}/workflow-settings?tab=sla`)
 await page.locator('.workflow-item').filter({has:page.getByRole('heading',{name:/Teams backup proof/})}).getByRole('button',{name:'Edit policy',exact:true}).click()
 await page.getByLabel('Teams escalation destination',{exact:true}).selectOption(`${connection.id}|${connection.updated_at}`)
 await capture('policy-consent')
 await page.getByRole('button',{name:'Save policy',exact:true}).click()
 await page.getByRole('heading',{name:/Teams backup proof/}).waitFor()
 assert.equal((await api(base+'/sla-policies')).data.find(row=>row.id===policy.id).teams_connection_id,connection.id)
 const start=Date.parse('2031-01-06T12:00:00Z'),ids=[]
 await api(base+'/workflow-clock',{now:start})
 for(let n=0;n<4;n++){
  const ticket=await api('/api/conversations',{projectId,contactId:tickets[0].visitor.contactId})
  const response=await fetch(`${runtime.origin}/api/conversations/${ticket.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${tickets[0].visitor.token}`},body:JSON.stringify({localId:`teams-${n}`,content:'Please help with my replacement.',expectedRevision:0})})
  assert.equal(response.status,200)
  const current=(await api(`${base}/conversations/${ticket.id}/ticket`)).data
  await api(`${base}/conversations/${ticket.id}/ticket`,{expected_version:current.ticket_version,channel:'phone',priority:'urgent',status_id:'open',agent_id:me.id},'PATCH');ids.push(ticket.id)
 }
 for(let tick=0;tick<5;tick++)await api(base+'/workflow-clock',{now:start+15*60000})
 const alerts=[]
 for(const id of ids){const sla=(await api(`${base}/conversations/${id}/sla`)).data;alerts.push({id,alert:sla.alerts.find(row=>row.recipient_id===me.id&&row.kind==='approaching')})}
 assert.deepEqual(alerts.map(row=>row.alert.teams_state).sort(),['accepted','failed','pending','uncertain'])
 for(const state of ['accepted','failed','pending','uncertain']){
  const row=alerts.find(row=>row.alert.teams_state===state)
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${row.id}`)
  await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#ticket-section-schedules-heading').click()
  const panel=page.locator('.workflow-panel');await panel.getByText(new RegExp(`Teams: ${state[0].toUpperCase()+state.slice(1)}`)).waitFor()
  await capture('alert-'+state)
  if(state==='pending'){
   await panel.locator('.workflow-alert-list li').filter({hasText:'Teams: Pending'}).getByRole('button',{name:'Acknowledge alert',exact:true}).click()
   await panel.locator('details:not([open]) > summary').filter({hasText:'SLA alerts'}).click()
   await panel.getByText(/Acknowledged/).first().waitFor()
   assert.equal((await api(`${base}/conversations/${row.id}/sla`)).data.alerts.find(a=>a.id===row.alert.id).state,'acknowledged')
   await capture('alert-acknowledged')
  }
 }
 await api(`${base}/sla-policies/${policy.id}`,{active:false},'PATCH')
}
