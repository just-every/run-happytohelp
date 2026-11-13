import assert from 'node:assert/strict'

// Extend the existing lead's ticket journey: one operator's consecutive saves
// share their confirmed version; a genuinely intervening save must still win.
export async function ticketStatusEdits({page,fixture,origin}){
 const {base,tickets}=fixture,id=tickets[0].id,path=`${base}/conversations/${id}/ticket`
 const get=async()=>(await fixture.api(path)).data
 const status=page.getByLabel('Status',{exact:true}),priority=page.getByLabel('Priority',{exact:true})
 const header=page.locator('.conversation-header-status').filter({hasNotText:'AI'})
 const choose=async value=>{
  const response=page.waitForResponse(response=>response.url().endsWith(path)&&response.request().method()==='PATCH')
  await status.selectOption(value);assert.equal((await response).status(),200)
  await page.getByText('Status saved.',{exact:true}).waitFor({state:'attached'})
  assert.equal((await get()).status_id,value)
 }
 await priority.selectOption('normal');await page.getByText('Priority saved.',{exact:true}).waitFor({state:'attached'})
 await priority.selectOption('high');await page.getByText('Priority saved.',{exact:true}).waitFor({state:'attached'})
 const beforeTag=await get()
 await page.getByLabel('New tag',{exact:true}).fill('saturday-walk')
 await page.locator('.conversation-tags-form').getByRole('button',{name:'Add',exact:true}).click()
 const tag=page.getByRole('button',{name:'Remove tag saturday-walk',exact:true});await tag.waitFor()
 assert.equal((await get()).priority,'high');assert.ok((await get()).ticket_version>beforeTag.ticket_version)
 await choose('solved')
 await header.filter({hasText:/^Solved$/}).waitFor();await page.locator('.conversation-header-reopen').waitFor()
 await page.reload();await page.getByRole('tab',{name:'Ticket',exact:true}).click()
 await header.filter({hasText:/^Solved$/}).waitFor();assert.equal(await status.inputValue(),'solved')
 for(const [value,label] of [['open','Open'],['pending','Pending'],['on_hold','On-hold'],['new','New']]){
  await choose(value);await header.filter({hasText:new RegExp(`^${label}$`)}).waitFor()
  await page.getByRole('button',{name:'Solve',exact:true}).waitFor()
  assert.equal(await page.locator('.conversation-header-reopen').count(),0)
 }
 await tag.click();await tag.waitFor({state:'detached'})
 await choose('open')
 assert.ok(!(await get()).tags.some(item=>item.name==='saturday-walk'))

 // Hold this tab's already-versioned write while a second tab saves publicly.
 // A stale refusal must preserve that entire intervening ticket, with no retry.
 let arrived,release
 const intercepted=new Promise(resolve=>{arrived=resolve}),resume=new Promise(resolve=>{release=resolve})
 await page.route(origin+path,async route=>{arrived();await resume;await route.continue()},{times:1})
 await status.selectOption('pending');await intercepted
 const current=await get()
 let intervening
 try{intervening=(await fixture.api(path,{priority:'low',expected_version:current.ticket_version},'PATCH')).data}finally{release()}
 await page.locator('.ticket-summary [role="alert"]').waitFor()
 assert.deepEqual(await get(),intervening,'a refused stale write preserves the other tab’s save')
 assert.equal(intervening.status_id,'open');assert.equal(intervening.priority,'low')
 assert.equal(await page.locator('.ticket-summary [role="alert"]').count(),1)
 await page.reload();await page.getByRole('tab',{name:'Ticket',exact:true}).click()
 await status.waitFor();assert.equal(await status.inputValue(),'open')
}
