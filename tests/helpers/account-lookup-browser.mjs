import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRuntime} from './emitted-runtime.mjs'
import {launchBrowser,evidence} from '../journeys/kit/browser.mjs'

// Reuse the ticket browser registration. Only DNS and mail delivery are network fakes.
export async function accountLookupBrowser(){
 const scratch=await mkdtemp(join(tmpdir(),'hh-account-edge-')),mail=join(scratch,'mail.jsonl'),edge=join(scratch,'edge.mjs')
 await writeFile(mail,'')
 await writeFile(edge,`import {appendFileSync} from 'node:fs';export default async request=>{if(request.url==='https://api.resend.com/emails'){appendFileSync(${JSON.stringify(mail)},JSON.stringify(await request.json())+'\\n');return Response.json({id:crypto.randomUUID()})}if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.com.'}]});throw Error('Unexpected network edge')}`)
 const origin='http://127.0.0.1:18847',runtime=await createRuntime({port:18847,outboundFixture:edge,vars:{APP_ORIGIN:origin,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-hh-1',EMAIL_FROM:'support@example.com'}}),browser=await launchBrowser(),shot=await evidence('account-lookup')
 let success=false
 try{
  const owner={email:'synthetic-hh-owner@example.test',password:'synthetic-hh-owner-password',ownerName:'Alex Rivers',name:'Northstar Support'},request=async(path,body,token,method=body===undefined?'GET':'POST')=>{
   const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
   const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result
  }
  const {projectId:p}=await request('/api/identity/bootstrap',{...owner,allowedOrigin:origin}),login=await request('/api/identity/login',owner),base=`/api/management/projects/${p}`,api=(path,body,method)=>request(path,body,login.token,method)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const capture=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});if(name==='02-configure-form'){const control=page.getByRole('button',{name:'Move down',exact:true}).first();await control.scrollIntoViewIfNeeded();await page.mouse.move(1,1);await control.hover();await page.waitForTimeout(350);if(width===390)console.log('Phone move-control target:',await control.evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})))}else await page.waitForTimeout(350);await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:name!=='02-configure-form'});}await page.setViewportSize({width:1440,height:1000})}
  await page.goto(origin+`/login?returnTo=/projects/${p}/ticket-settings`);await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click()
  await page.getByRole('button',{name:'Fields',exact:true}).click();await page.getByRole('button',{name:'New field',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Support account');await page.getByLabel('Type',{exact:true}).selectOption('account');for(const group of ['Roles that can read this field','Roles that can edit this field']){const checks=page.getByRole('group',{name:group,exact:true}).getByRole('checkbox');for(const check of await checks.all())await check.uncheck()}await capture('01-configure-account');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  const field=(await api(base+'/ticket-fields')).data.find(field=>field.name==='Support account');assert.equal(field.type,'account')
  const detail=(await api(base+'/ticket-fields',{name:'Request detail',type:'text'})).data
  const form=(await api(`/api/forms/projects/${p}/forms`,{title:'Account help',enabled:true,fields:[{fieldId:field.id,required:true},{fieldId:detail.id}]})).data
  await page.goto(origin+`/projects/${p}/edit?tab=forms`);await page.getByRole('button',{name:'Edit Account help',exact:true}).click();await page.getByRole('heading',{name:'Account help',exact:true}).waitFor();const move=page.getByRole('button',{name:'Move down',exact:true}).first();await move.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.locator('[role=tooltip]').filter({hasText:'Move down'}).waitFor();await capture('02-configure-form');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  const customer='synthetic-hh-customer@example.com'
  await request(`/api/portal/${p}/access/request`,{email:customer,returnTo:`/help/${p}/requests/${form.id}`})
  const delivered=(await readFile(mail,'utf8')).trim().split('\n').map(JSON.parse).find(item=>[].concat(item.to).includes(customer));assert.ok(delivered)
  const link=delivered.text.match(/http:\/\/127\.0\.0\.1:18847\/api\/portal\/\S+/)[0],customerContext=await browser.newContext({viewport:{width:1440,height:1000}})
  const customerPage=await customerContext.newPage();await customerPage.goto(link)
  const contact=(await api(base+'/contacts?search='+encodeURIComponent(customer))).data.find(row=>row.email===customer)
  assert.ok(contact)
  const company=(await api(base+'/companies',{name:'Northstar account',portalCompanyView:true})).company
  await api(base+`/companies/${company.id}/members/${contact.id}`,{},'PUT')
  await customerPage.reload();await customerPage.getByLabel('Subject',{exact:false}).fill('Account access question');await customerPage.getByLabel('Message',{exact:false}).fill('Please help with my account.');await customerPage.getByLabel('Support account',{exact:false}).selectOption(company.id)
  await api(base+`/companies/${company.id}`,{portalCompanyView:false},'PATCH')
  await customerPage.getByRole('button',{name:'Submit request',exact:true}).click();await customerPage.locator('.request-field-error').filter({hasText:'Choose an available account'}).waitFor();assert.equal(await customerPage.getByLabel('Support account',{exact:false}).getAttribute('aria-invalid'),'true')
  const customerCapture=async name=>{for(const width of [1440,390]){await customerPage.setViewportSize({width,height:width===390?844:1000});await customerPage.screenshot({path:shot(`${name}-${width}.png`),fullPage:true});}await customerPage.setViewportSize({width:1440,height:1000})}
  await customerCapture('03-refused-account');await api(base+`/companies/${company.id}`,{portalCompanyView:true},'PATCH');await customerPage.getByRole('button',{name:'Submit request',exact:true}).click();await customerPage.getByRole('link',{name:'View your request',exact:true}).waitFor();await customerCapture('04-submitted')
  const ticketId=(await customerPage.getByRole('link',{name:'View your request'}).getAttribute('href')).split('/').at(-1)
  await page.goto(origin+`/projects/${p}/conversations/${ticketId}`);await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#ticket-section-fields-heading').click();await page.getByLabel('Support account',{exact:true}).waitFor();assert.equal(await page.getByLabel('Support account',{exact:true}).inputValue(),company.id);await page.getByLabel('Support account',{exact:true}).scrollIntoViewIfNeeded();await capture('05-ticket-value')
  await customerContext.close();await context.close();success=true;console.log('Account lookup: configured, refused, submitted and inspected; browser proof at 1440 and 390.')
 }finally{await browser.close();await runtime.close(success);await rm(scratch,{recursive:true,force:true})}
}
