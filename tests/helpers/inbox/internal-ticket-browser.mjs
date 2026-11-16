import assert from 'node:assert/strict'
import {strangerFixture} from '../stranger11-browser.mjs'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'

export async function internalTicketInboxBrowser(){
 const f=await strangerFixture(),{page,origin,projectId,base,request}=f,shot=await evidence('internal-ticket-inbox')
 let success=false
 try{
  const ownerId=(await request('/api/management/bootstrap')).currentAgent.id
  await page.goto(`${origin}/projects/${projectId}/conversations?view=mine`)
  const before=(await request(base+'/conversations/counts')).data.mine
  await page.getByRole('button',{name:'New ticket',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'New ticket',exact:true})
  await dialog.getByLabel('First comment',{exact:true}).selectOption('internal')
  await dialog.getByLabel('Requester email',{exact:true}).fill('casey.morgan@example.com')
  await dialog.getByLabel('Requester name',{exact:true}).fill('Casey Morgan')
  await dialog.getByLabel('Subject',{exact:true}).fill('Check replacement buckle stock for CT-10508')
  const note='Check replacement buckle stock and call Casey back with availability.'
  await dialog.getByLabel('Internal note',{exact:true}).fill(note)
  await dialog.getByLabel('Assignee',{exact:true}).selectOption(ownerId)
  const created=page.waitForResponse(response=>response.url().endsWith(base+'/tickets')&&response.request().method()==='POST')
  await dialog.getByRole('button',{name:'Create ticket',exact:true}).click()
  const response=await created;assert.equal(response.status(),201)
  const result=await response.json(),id=result.conversation.id
  assert.equal(result.conversation.assigned_to,ownerId)
  await page.waitForURL('**/conversations/'+id)
  await page.locator('.transcript-note-content').getByText(note,{exact:true}).waitFor()
  // Leave the open ticket and reconstruct the selected queue from the server.
  await page.goto(`${origin}/projects/${projectId}/activation`)
  await page.goto(`${origin}/projects/${projectId}/conversations?view=mine`)
  await page.reload()
  const row=page.locator('.conversation-item').filter({hasText:'Check replacement buckle stock for CT-10508'})
  await row.waitFor()
  assert.equal(await row.count(),1,'the saved internal-only ticket remains discoverable after Inbox reload')
  for(const list of [base+'/conversations?view=mine','/api/dashboard/conversations?view=mine']){
   const reloaded=await request(list)
   assert.equal(reloaded.data.filter(ticket=>ticket.id===id).length,1,'workspace and global Yours retain the ticket')
   assert.equal(reloaded.meta.pagination.total,reloaded.data.length,'the first page contains every counted fixture ticket')
  }
  assert.equal((await request(base+'/conversations/counts')).data.mine,before+1)
  assert.deepEqual((await request('/api/conversations/'+id+'/messages')).messages,[],'the internal ticket has no public message')
  for(const viewport of [viewports.desktop,viewports.mobile]){
   await page.setViewportSize(viewport);await page.waitForTimeout(300)
   await page.screenshot({path:shot(viewport.width+'-yours-after-reload.png'),fullPage:true})
  }
  await page.setViewportSize(viewports.desktop)
  await row.click();await page.locator('.transcript-note-content').getByText(note,{exact:true}).waitFor()
  await page.reload();await page.locator('.transcript-note-content').getByText(note,{exact:true}).waitFor()
  success=true
 }finally{await f.close(success)}
}
