import assert from 'node:assert/strict'

const latch=()=>{let release;const ready=new Promise(resolve=>{release=resolve});return {ready,release}}
const deliver=async(route,response)=>{
 try{await route.fulfill({response})}catch(error){
  // Aborting an obsolete choices read retires its Playwright route too.
  if(!route.request().failure()&&!error.message.includes('Route is already handled'))throw error
 }
}

export async function ticketOrderingBrands({call,token,origin}){
 const create=async(name,address)=>{
  const brand=await call('/api/management/projects',{name,allowedOrigin:origin},token)
  const session=await call('/api/identity/switch-project',{projectId:brand.id},token)
  brand.mailbox=(await call(`/api/management/projects/${brand.id}/mailboxes`,{provider:'forwarding',address,displayName:''},session.token)).data
  return brand
 }
 const source=await create('Synthetic dispatch support','support@example.test'),others=[]
 const addresses=['synthetic-happytohelp-notice-1440@support.example','synthetic-happytohelp-ticket-390@support.example','synthetic-happytohelp-notice-390@support.example']
 for(const [index,address] of addresses.entries())others.push(await create(`Synthetic collection support ${index+1}`,address))
 return {projectId:source.id,mailbox:source.mailbox,others}
}

/** Delay real responses, without replacing the workspace choices or ticket route. */
export async function newTicketBrandOrderings({page,origin,dialog,projectId,others,mailbox,capture}){
 for(const [index,ordering] of ['old-during-switch','old-after-switch','new-before-old','no-switch'].entries()){
  // Navigation activates the initial workspace before delaying a dialog switch.
  await page.goto(`${origin}/projects/${projectId}/conversations`)
  const newTicket=page.getByRole('button',{name:'New ticket',exact:true});await newTicket.waitFor()
  const switching=ordering!=='no-switch',other=others[index],target=switching?other:{id:projectId,mailbox}
  const old=latch(),oldReady=latch(),oldDone=latch(),switched=latch(),switchReady=latch(),fresh=latch(),freshReady=latch()
  const oldPath=`/api/dashboard/projects/${projectId}/tickets/options`,newPath=switching?`/api/dashboard/projects/${other.id}/tickets/options`:''
  const oldChoices=async route=>{
   const response=await route.fetch();oldReady.release();await old.ready
   try{await deliver(route,response)}finally{oldDone.release()}
  }
  const newChoices=async route=>{
   const response=await route.fetch();freshReady.release();await fresh.ready;await deliver(route,response)
  }
  if(switching){
   await page.route('**'+oldPath,oldChoices)
   await page.route('**/api/identity/switch-project',async route=>{
    const response=await route.fetch();switchReady.release();await switched.ready;await route.fulfill({response})
   },{times:1})
   await page.route('**'+newPath,newChoices)
  }
  try{
   await newTicket.click();await dialog.waitFor()
   if(switching){
    await oldReady.ready
    await dialog.getByLabel('Brand workspace',{exact:true}).selectOption(other.id);await switchReady.ready
    if(ordering==='old-during-switch'){
     old.release();await oldDone.ready
     // Let the delivered old choices settle while the switch response is held.
     await page.waitForTimeout(100)
     assert.equal(await dialog.getByLabel('Send from mailbox',{exact:true}).locator(`option[value="${mailbox.id}"]`).count(),0,'old choices stay hidden during the switch')
    }
    switched.release();await freshReady.ready
    if(ordering==='old-after-switch'){
     old.release();await oldDone.ready;await page.waitForTimeout(100)
    }
    fresh.release()
    await dialog.getByLabel('Send from mailbox',{exact:true}).locator(`option[value="${other.mailbox.id}"]`).waitFor({state:'attached'})
    if(ordering==='new-before-old'){
     old.release();await oldDone.ready;await page.waitForTimeout(100)
    }
   }else await dialog.getByLabel('Send from mailbox',{exact:true}).locator(`option[value="${mailbox.id}"]`).waitFor({state:'attached'})
   await dialog.getByLabel('Requester email',{exact:true}).fill('synthetic-hh-ordering@customer.example')
   await dialog.getByLabel('Subject',{exact:true}).fill(`Synthetic parcel ${ordering}`)
   await dialog.getByLabel('Message',{exact:true}).fill('Your parcel is ready for collection.')
   await capture(ordering)
   const responseReady=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/dashboard/projects/${target.id}/tickets`&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Create and email',exact:true}).click()
   const response=await responseReady,submitted=response.request().postDataJSON(),result=await response.json()
   console.log('BRAND_ORDERING '+JSON.stringify({ordering,status:response.status(),mailbox:submitted.mailboxId===target.mailbox.id?(switching?'new':'current'):submitted.mailboxId===mailbox.id?'old':'other',error:result.error||null}))
   assert.equal(response.status(),201,'brand switch creates with its current mailbox')
   assert.equal(submitted.mailboxId,target.mailbox.id,'only the current workspace mailbox is submitted')
   assert.equal(result.conversation.project_id,target.id)
   await page.waitForURL(`**/conversations/${result.conversation.id}`)
   await page.locator('.transcript-message-content').getByText('Your parcel is ready for collection.',{exact:true}).waitFor()
   await capture(`${ordering}-created`)
  }finally{
   old.release();switched.release();fresh.release()
   if(switching){await page.unroute('**'+oldPath,oldChoices);await page.unroute('**'+newPath,newChoices)}
  }
 }
}
