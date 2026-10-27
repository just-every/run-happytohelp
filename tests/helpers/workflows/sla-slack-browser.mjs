import assert from 'node:assert/strict'
import {evidence} from '../../journeys/kit/browser.mjs'
export async function slaSlackBrowser({page,runtime,fixture,policy}){
 const {projectId,base,api,tickets}=fixture
 const shot=await evidence('sla-slack')
 const capture=async name=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}: desktop overflow`)
  for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.waitForTimeout(350);if(['pending','failed','uncertain','acknowledged'].some(state=>name.endsWith(state))){if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('.workflow-panel').scrollIntoViewIfNeeded()}await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true})}
  await page.setViewportSize({width:1440,height:1000})
 }
 await page.goto(`${runtime.origin}/projects/${projectId}/slack-settings`)
 await page.getByLabel('Connection name',{exact:true}).fill('SLA backup channel')
 await page.getByLabel('Slack incoming webhook URL',{exact:true}).fill('https://hooks.slack.com/services/synthetic-hh-1/synthetic-hh-2/synthetic-hh-3')
 await page.getByLabel('Notify on new conversations',{exact:true}).uncheck()
 await capture('sla-slack-destination')
 await page.getByRole('button',{name:'Save connection',exact:true}).click()
 await page.getByRole('heading',{name:'SLA backup channel',exact:true}).waitFor()
 const target=(await api(`/api/management/projects/${projectId}/connections/slack`)).data.find(row=>row.name==='SLA backup channel')
 assert.deepEqual(target.events,[])
 await page.goto(`${runtime.origin}/projects/${projectId}/workflow-settings?tab=sla`)
 await page.getByRole('button',{name:'Edit policy',exact:true}).click()
 await page.getByLabel('Slack escalation destination',{exact:true}).selectOption(target.id)
 await capture('sla-slack-consent')
 await page.getByRole('button',{name:'Save policy',exact:true}).click()
 await page.getByRole('heading',{name:/Business account response/}).waitFor()
 assert.equal((await api(base+'/sla-policies')).data.find(row=>row.id===policy.id).slack_destination_id,target.id)
 // A separate phone policy keeps every pre-existing browser fixture ticket out.
 const calendar=(await api(base+'/workflow-calendars',{name:'Slack proof hours',timezone:'UTC',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),holidays:'none',closures:[]})).data
 const me=(await api('/api/management/bootstrap')).currentAgent
 const proof=(await api(base+'/sla-policies',{name:'Slack backup proof',calendar_id:calendar.id,position:0,conditions:{channels:['phone']},first_response_minutes:30,approaching_minutes:15,backup_user_ids:[me.id],slack_destination_id:target.id})).data
 const start=Date.parse('2030-01-07T12:00:00Z')
 await api(base+'/workflow-clock',{now:start})
 await api(`/api/management/projects/${projectId}/availability`,{is_presence_away_enabled:false},'PUT')
 const ids=[]
 for(let n=0;n<3;n++){
  const ticket=await api('/api/conversations',{projectId,contactId:tickets[0].visitor.contactId})
  const admitted=await fetch(`${runtime.origin}/api/conversations/${ticket.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${tickets[0].visitor.token}`},body:JSON.stringify({localId:`synthetic-hh-${n}`,content:'A replacement is needed.',expectedRevision:0})})
  assert.equal(admitted.status,200)
  const current=(await api(`${base}/conversations/${ticket.id}/ticket`)).data
  await api(`${base}/conversations/${ticket.id}/ticket`,{expected_version:current.ticket_version,channel:'phone',status_id:'open',agent_id:me.id},'PATCH')
  ids.push(ticket.id)
 }
 for(let tick=0;tick<4;tick++)await api(base+'/workflow-clock',{now:start+15*60000})
 const alerts=[]
 for(const id of ids){const state=(await api(`${base}/conversations/${id}/sla`)).data;alerts.push({id,alert:state.alerts.find(row=>row.recipient_id===me.id&&row.kind==='approaching')})}
 assert.deepEqual(alerts.map(row=>row.alert.slack_state).sort(),['failed','pending','uncertain'])
 for(const state of ['pending','failed','uncertain']){
  const row=alerts.find(row=>row.alert.slack_state===state)
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${row.id}`)
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  await page.locator('#ticket-section-schedules-heading').click()
  const panel=page.locator('.workflow-panel')
  await panel.getByText(new RegExp(`Slack: ${state[0].toUpperCase()+state.slice(1)}`)).waitFor()
  await panel.scrollIntoViewIfNeeded()
  await capture(`sla-slack-${state}`)
  if(state==='uncertain'){
   await panel.locator('.workflow-alert-list li').filter({hasText:'Slack: Uncertain'}).getByRole('button',{name:'Acknowledge alert',exact:true}).click()
   await panel.getByText(/Acknowledged/).first().waitFor()
   assert.equal((await api(`${base}/conversations/${row.id}/sla`)).data.alerts.find(a=>a.id===row.alert.id).state,'acknowledged')
   await capture('sla-slack-acknowledged')
  }
 }
 await api(`${base}/sla-policies/${proof.id}`,{active:false},'PATCH')
}
