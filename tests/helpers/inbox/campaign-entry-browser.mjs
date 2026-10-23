import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRuntime} from '../emitted-runtime.mjs'
import {seedTicketBrowser,ticketOwner} from './ticket-browser-fixture.mjs'
import {launchBrowser,evidence} from '../../journeys/kit/browser.mjs'

/** Public built pages and routes, with only the DNS/mail network edge faked. */
export async function campaignEntryBrowser(){
 const directory=await mkdtemp(join(tmpdir(),'h2h-entry-browser-')),mailPath=join(directory,'mail.ndjson'),fixturePath=join(directory,'provider.mjs')
 await writeFile(mailPath,'')
 await writeFile(fixturePath,`import {appendFile} from 'node:fs/promises';export default async request=>{if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]});if(request.url!=='https://api.resend.com/emails')throw Error('Unexpected provider request');const mail=await request.json();await appendFile(${JSON.stringify(mailPath)},JSON.stringify(mail)+'\\n');return mail.text?.includes('synthetic-happytohelp-90')&&[].concat(mail.to).includes('browser-notice-fail@example.test')?Response.json({error:'Recipient refused'},{status:422}):Response.json({id:crypto.randomUUID()});};`)
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-80',EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-81',H2H_SETUP_TOKEN:'synthetic-happytohelp-82',APP_ORIGIN:'https://app.example'},outboundFixture:pathToFileURL(fixturePath).href}),browser=await launchBrowser(),shot=await evidence('campaign-entry')
 const mails=async()=>(await readFile(mailPath,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),until=async check=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const result=await check();if(result)return result;await new Promise(done=>setTimeout(done,100))}throw Error('Browser fixture did not settle')}
 let success=false
 try{
  const setup=await fetch(runtime.origin+'/api/identity/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...ticketOwner,allowedOrigin:runtime.origin,setupToken:'synthetic-happytohelp-82'})});assert.equal(setup.status,200);const initial=await setup.json()
  const f=await seedTicketBrowser(runtime.origin,1,{owner:ticketOwner,projectId:initial.projectId}),{projectId,base,api,owner}=f,management=`/api/management/projects/${projectId}`,context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage()
  page.setDefaultTimeout(15000)
  await api(management+'/email-settings',{from_address:'support@example.test',from_name:'Trailhead support',inbound_address:'help@example.test',is_enabled:true},'PUT')
  const mailbox=(await api(management+'/mailboxes',{provider:'forwarding',address:'helpdesk@example.test',displayName:'Trailhead support'})).data
  await api(management+`/mailboxes/${mailbox.id}/reconnect`,{})
  const form=(await api(`/api/forms/projects/${projectId}/forms`,{title:'Order follow-up',enabled:true,fields:[{fieldId:f.fields[4].id,required:true},{fieldId:f.fields[0].id,required:true,condition:{fieldId:f.fields[4].id,operator:'equals',value:'Damaged'}}]})).data
  const capture=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} overflow at ${width}`);assert.ok(await page.locator('.modal-body').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1)),`${name} dialog overflow at ${width}`);await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true});}await page.setViewportSize({width:1440,height:900})}
  await page.goto(runtime.origin+`/login?returnTo=/projects/${projectId}/conversations`)
  await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click()
  await page.getByRole('button',{name:'New ticket',exact:true}).click()
  let dialog=page.getByRole('dialog')
  await dialog.getByLabel('Ticket type',{exact:true}).selectOption('walk_in')
  await dialog.getByLabel('Search requesters by name, email or phone').fill('customer-0@')
  await dialog.locator('input[name="ticket-requester"]').first().check()
  await dialog.getByLabel('Group',{exact:true}).selectOption(f.group.id)
  await dialog.getByLabel('Ticket form',{exact:true}).selectOption(form.id)
  await dialog.getByLabel('Reason *',{exact:true}).selectOption('Damaged')
  await dialog.getByLabel('Order number *',{exact:true}).fill('TO-48213')
  await dialog.getByLabel('Subject',{exact:true}).fill('Walk-in replacement request')
  await dialog.getByLabel('Private notes',{exact:true}).fill('Customer brought the damaged boots to the store.')
  await dialog.locator('.modal-body').evaluate(node=>node.scrollTop=0);await capture('outbound-requester')
  await dialog.getByLabel('Ticket form',{exact:true}).scrollIntoViewIfNeeded();await capture('outbound-configuration')
  const close=dialog.getByRole('button',{name:'Close dialog',exact:true});await close.focus();await page.getByRole('tooltip').filter({hasText:'Close dialog'}).waitFor()
  await dialog.getByRole('button',{name:'Create internal ticket',exact:true}).click()
  await page.waitForURL(url=>url.pathname.includes('/conversations/ticket-'))
  const loggedId=new URL(page.url()).pathname.split('/').pop(),logged=(await api(`${base}/conversations/${loggedId}/ticket`)).data
  assert.equal(logged.channel,'walk_in');assert.equal(logged.request_form_id,form.id);assert.equal(logged.fields[f.fields[0].id],'TO-48213')
  assert.equal((await mails()).some(mail=>mail.text?.includes('Customer brought the damaged boots')),false,'walk-in notes never leave by mail')
  const signIn=async(email,customerPage)=>{
   const before=(await mails()).length;await api(`/api/portal/${projectId}/access/request`,{email})
   const mail=await until(async()=>(await mails()).slice(before).find(mail=>mail.subject==='Sign in to your support requests'&&[].concat(mail.to).includes(email)))
   const url=new URL(mail.text.match(/https:\/\/app\.example\/api\/portal\/\S+/)[0]);await customerPage.goto(runtime.origin+url.pathname+url.search)
   const response=await customerPage.request.put(runtime.origin+`/api/portal/${projectId}/preferences`,{headers:{Origin:runtime.origin},data:{locale:'en',surveyEmails:false,updateEmails:true}});assert.equal(response.status(),200)
   return (await api(management+'/contacts?'+new URLSearchParams({search:email}))).data.find(contact=>contact.email===email).id
  }
  const customerContext=await browser.newContext(),customerPage=await customerContext.newPage(),requesterIds=[]
  for(const email of ['browser-notice-one@example.test','browser-notice-fail@example.test','browser-notice-three@example.test'])requesterIds.push(await signIn(email,customerPage))
  await page.goto(runtime.origin+`/projects/${projectId}/conversations`);await page.getByRole('button',{name:'New ticket',exact:true}).click();dialog=page.getByRole('dialog')
  await dialog.getByLabel('Ticket type',{exact:true}).selectOption('service')
  await dialog.getByLabel('Search requesters by name, email or phone').fill('browser-notice-')
  await until(async()=>await dialog.locator('input[name="ticket-requester"]').count()===3)
  for(const checkbox of await dialog.locator('input[name="ticket-requester"]').all())await checkbox.check()
  await dialog.getByLabel('Subject',{exact:true}).fill('Replacement shipment update')
  await dialog.getByLabel('Message',{exact:true}).fill('synthetic-happytohelp-90: Your replacement shipment is delayed.')
  await dialog.getByRole('button',{name:'Preview service notice',exact:true}).click();await dialog.getByRole('heading',{name:'Review service notice',exact:true}).waitFor()
  assert.equal((await mails()).filter(mail=>mail.text?.includes('synthetic-happytohelp-90')).length,0,'UI preview never sends')
  await dialog.getByRole('region',{name:'Service notice preview'}).scrollIntoViewIfNeeded();await capture('service-notice-preview')
  await dialog.getByRole('button',{name:'Confirm service notice',exact:true}).click();await dialog.getByRole('heading',{name:'Delivery outcomes',exact:true}).waitFor()
  await until(async()=>(await mails()).filter(mail=>mail.text?.includes('synthetic-happytohelp-90')).length===3)
  await until(async()=>{await dialog.getByRole('button',{name:'Refresh outcomes',exact:true}).click();return (await dialog.getByRole('region',{name:'Service notice outcomes'}).innerText()).includes('failed')})
  assert.equal((await mails()).filter(mail=>mail.text?.includes('synthetic-happytohelp-90')).length,3,'refresh never resends')
  await dialog.getByRole('region',{name:'Service notice outcomes'}).scrollIntoViewIfNeeded();await capture('service-notice-outcomes');await dialog.getByRole('button',{name:'Close',exact:true}).click()
  // Customer account lookup choices and a retained typed reference in the built form.
  const account=(await api(management+'/companies',{name:'Rosa Books browser',domains:[],portalCompanyView:false})).company
  await api(management+`/companies/${account.id}/members/${requesterIds[2]}`,{},'PUT')
  const lookup=(await api(base+'/ticket-fields',{name:'Support account',type:'account_lookup'})).data
  const accountForm=(await api(`/api/forms/projects/${projectId}/forms`,{title:'Account support',enabled:true,fields:[{fieldId:lookup.id,required:true}],translations:{es:{title:'Ayuda con tu cuenta',fields:{subject:{label:'Asunto'},message:{label:'Mensaje'},[lookup.id]:{label:'Cuenta'}}}}})).data
  await page.goto(runtime.origin+`/projects/${projectId}/ticket-settings`);await page.getByRole('button',{name:'Fields',exact:true}).click();await page.getByRole('heading',{name:'Support account',exact:true}).waitFor();await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Support account',exact:true})}).getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.getByLabel('Type',{exact:true}).inputValue(),'account_lookup');await page.getByLabel('Type',{exact:true}).scrollIntoViewIfNeeded();await capture('account-field-settings')
  const anonymous=await browser.newContext(),anonymousPage=await anonymous.newPage()
  await anonymousPage.goto(runtime.origin+`/help/${projectId}/requests/${accountForm.id}`);await anonymousPage.getByLabel('Support account').waitFor();assert.equal(await anonymousPage.getByLabel('Support account').locator('option').count(),1,'anonymous form exposes no account choices')
  for(const width of [1440,390]){await anonymousPage.setViewportSize({width,height:844});await anonymousPage.screenshot({path:shot(`account-form-anonymous-${width}.png`),fullPage:true})}
  await customerPage.goto(runtime.origin+`/help/${projectId}/requests/${accountForm.id}?locale=es`);await customerPage.getByRole('heading',{name:'Ayuda con tu cuenta',exact:true}).waitFor();await until(async()=>await customerPage.getByLabel('Cuenta').inputValue()===account.id)
  await customerPage.getByLabel('Asunto',{exact:true}).fill('Ayuda con mi cuenta');await customerPage.getByLabel('Mensaje',{exact:true}).fill('Necesito ayuda para actualizar mi cuenta.')
  for(const width of [1440,390]){await customerPage.setViewportSize({width,height:844});assert.ok(await customerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await customerPage.screenshot({path:shot(`account-form-signed-${width}.png`),fullPage:true})}
  await customerPage.getByRole('button',{name:'Submit request',exact:true}).click();await customerPage.getByRole('link',{name:'View your request',exact:true}).waitFor()
  const submitted=(await customerPage.getByRole('link',{name:'View your request'}).getAttribute('href')).split('/').pop();assert.equal((await api(`${base}/conversations/${submitted}/ticket`)).data.fields[lookup.id],account.id)
  success=true
 }finally{await browser.close();await runtime.close(success);await rm(directory,{recursive:true,force:true})}
}
