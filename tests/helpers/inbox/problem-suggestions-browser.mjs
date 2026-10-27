import assert from 'node:assert/strict'
import {evidence} from '../../journeys/kit/browser.mjs'

// Part of the ticket journey: real routes and emitted UI, no provider requests.
export async function problemSuggestionsBrowser(page,fixture,origin){
 const {api,base,projectId,tickets}=fixture,problem=tickets[0],incident=tickets[2],shot=await evidence('incident-suggestions')
 const path=id=>`${base}/conversations/${id}/ticket/problem`
 await api(`${base}/conversations/${problem.id}/ticket`,{subject:'Checkout outage under investigation'},'PATCH')
 await api(`${base}/conversations/${incident.id}/ticket`,{subject:'Checkout outage on my order'},'PATCH')
 await api(path(problem.id),{...(await api(path(problem.id))).data.ticket,is_problem:true},'PATCH')
 await page.goto(`${origin}/projects/${projectId}/conversations/${incident.id}`)
 await page.getByRole('tab',{name:'Ticket',exact:true}).click()
 await page.locator('#ticket-section-problem-heading').click()
 const panel=page.getByRole('region',{name:'Suggested problems',exact:true})
 const find=()=>panel.getByRole('button',{name:'Find suggested problems',exact:true}).click()
 const capture=async name=>{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000})
   // Resizing closes the compact sheet through a media-query change and a React render.
   // Wait for that transition before opening it, so a stale desktop read cannot skip the toggle.
   await page.waitForFunction(hidden=>document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden')===hidden,width===390?'true':'false')
   if(width===390)await page.getByRole('button',{name:'Show conversation panel',exact:true}).click()
   await page.getByRole('tab',{name:'Ticket',exact:true}).click()
   await page.locator('.problem-panel').scrollIntoViewIfNeeded();await page.waitForTimeout(350)
   if(width===390)console.log(JSON.stringify({screen:name,width,targets:await page.locator('.problem-panel button:visible').evaluateAll(buttons=>buttons.map(button=>({name:button.textContent.trim(),height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width})))}))
   await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.waitForFunction(()=>document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden')==='false')
 }
 await find();await panel.getByText('Checkout outage under investigation',{exact:true}).waitFor();await capture('01-found')
 await panel.getByRole('button',{name:'Inspect suggestion',exact:true}).click()
 await panel.getByLabel('Suggested problem preview').waitFor();assert.equal((await api(path(incident.id))).data.parent,null)
 await capture('02-preview')
 await panel.getByRole('button',{name:'Reject suggestion',exact:true}).click()
 await panel.getByText('Suggestion rejected. No tickets changed.',{exact:true}).waitFor();assert.equal((await api(path(incident.id))).data.parent,null)
 await capture('03-rejected')
 await find();await panel.getByRole('button',{name:'Inspect suggestion',exact:true}).click();await panel.getByLabel('Suggested problem preview').waitFor()
 await api(`${base}/conversations/${problem.id}/ticket`,{priority:'low'},'PATCH')
 await panel.getByRole('button',{name:'Confirm incident link',exact:true}).click()
 await panel.getByRole('alert').filter({hasText:'Problem changed'}).waitFor();assert.equal((await api(path(incident.id))).data.parent,null)
 await capture('04-stale')
 await find();await panel.getByRole('button',{name:'Inspect suggestion',exact:true}).click();await panel.getByLabel('Suggested problem preview').waitFor()
 await panel.getByRole('button',{name:'Confirm incident link',exact:true}).click()
 await page.locator('.problem-panel').getByRole('button',{name:'Checkout outage under investigation',exact:true}).waitFor()
 assert.equal((await api(path(incident.id))).data.parent.problem_id,problem.id)
 await capture('05-linked')
 // The existing previewed unlink door recovers the incident independently of solving.
 await api(path(problem.id)+'/incidents/apply',{action:'unlink',tickets:[(await api(path(incident.id))).data.ticket]})
 assert.equal((await api(path(incident.id))).data.parent,null)
}
