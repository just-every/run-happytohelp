import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {deletedRequestStatements} from './portal-outcomes.mjs'
import {createRuntime} from './emitted-runtime.mjs'

// Called by the existing public browser journey, without another registration.
export async function portalBrowser({browser,shot}){
 const directory=await mkdtemp(join(tmpdir(),'h2h-portal-mail-')),capture=join(directory,'mail.jsonl')
 const network=new URL('./portal-browser-mail.mjs',import.meta.url);network.searchParams.set('capture',capture)
 const runtime=await createRuntime({outboundFixture:network.href,vars:{APP_ORIGIN:'http://127.0.0.1',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-provider-key',EMAIL_FROM:'support@example.test'}})
 let passed=false
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage()
 page.setDefaultTimeout(20000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 try{
  const origin=runtime.origin,tenant=await runtime.seedTenant({name:'Harbor Support',email:'portal-owner@example.test',allowedOrigin:origin}),p=tenant.projectId,P=`/api/portal/${p}`
  const call=async(path,{body,method=body===undefined?'GET':'POST',status=200,customer=false}={})=>{
   const response=await context.request.fetch(origin+path,{method,headers:{Origin:origin,...(customer?{}:{Authorization:'Bearer '+tenant.token})},...(body===undefined?{}:{data:body})})
   assert.equal(response.status(),status,path+': '+(await response.text()).slice(0,300));return response.json()
  }
  const signin=async(email,project=p)=>{
   await page.goto(origin+`/portal/${project}`)
   await page.getByLabel('Email address',{exact:true}).fill(email)
   await page.getByRole('button',{name:'Email a sign-in link',exact:true}).click()
   await page.getByRole('status').waitFor()
   const messages=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse)
   const delivered=messages.filter(message=>[].concat(message.to).includes(email)).at(-1)
   assert.ok(delivered,'real sign-in email reached the provider edge')
   const link=new URL(delivered.text.match(/http:\/\/127\.0\.0\.1\/api\/portal\/\S+/)[0])
   const response=await page.goto(origin+link.pathname+link.search)
   assert.equal(response.status(),200);await page.getByRole('heading',{name:'My requests',exact:true}).waitFor()
   return link.pathname+link.search
  }
  const form=(await call(`/api/forms/projects/${p}/forms`,{status:201,body:{title:'Portal setup request',enabled:true,fields:[]}})).data
  await page.goto(origin+`/portal/${p}`);await page.getByLabel('Email address',{exact:true}).waitFor()
  await fits(page);await capturePage(page,shot,'signin')
  const usedLink=await signin('portal-reader@harbor.example')
  const customer=await call(P+'/preferences',{customer:true}),contactEmail=customer.email
  const ticket=(await call(`/api/forms/${p}/${form.id}/submissions`,{customer:true,status:201,body:{subject:'Harbor shipment tracking',message:'Please help find my shipment.',localId:'browser-portal-setup',fields:{}}})).ticket
  const open=()=>page.goto(origin+`/portal/${p}/requests/${ticket.id}`)
  await page.goto(origin+`/portal/${p}/requests`)
  assert.equal(await page.locator('.help-center-content li a').count(),1)
  await page.getByRole('link',{name:'Harbor shipment tracking',exact:true}).click()
  await page.getByRole('heading',{name:'Harbor shipment tracking',exact:true}).waitFor();await fits(page)
  await page.getByLabel('Message',{exact:true}).fill('Please deliver to the side entrance.')
  const send=page.getByRole('button',{name:'Send reply',exact:true});await send.scrollIntoViewIfNeeded();assert.ok(await send.isVisible())
  await capturePage(page,shot,'request-reply')
  await send.click();await page.getByText('Please deliver to the side entrance.',{exact:true}).waitFor()
  await call(`/api/dashboard/projects/${p}/conversations/${ticket.id}`,{method:'PUT',body:{resolved:true}})
  await open();await page.getByRole('button',{name:'Reopen request',exact:true}).click()
  await page.getByText('Status: open',{exact:true}).waitFor()
  assert.ok((await call(P+`/tickets/${ticket.id}`,{customer:true})).messages.some(message=>message.content==='Please deliver to the side entrance.'))
  await page.goto(origin+`/portal/${p}/requests`);await fits(page);await capturePage(page,shot,'list')
  await page.goto(origin+`/portal/${p}/preferences`);await page.getByLabel('Receive replies to your requests by email',{exact:true}).uncheck()
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();await page.getByRole('status').waitFor();assert.equal((await call(P+'/preferences',{customer:true})).updateEmails,false)
  await fits(page);await capturePage(page,shot,'preferences')
  const safePage=async(path,kind)=>{
   const response=await page.goto(origin+path)
   assert.equal(response.status(),kind==='notfound'?404:200)
   await page.getByRole(kind==='notfound'?'heading':'button',{name:kind==='notfound'?'Request not found':'Email a sign-in link',exact:true}).waitFor()
   assert.ok(!(await page.locator('.help-center-content').innerText()).includes(ticket.subject))
   await fits(page)
  }
  const outsider=await runtime.seedTenant({name:'Orchard Support',email:'orchard-owner@example.test',allowedOrigin:origin})
  await safePage(`/portal/${outsider.projectId}/requests/${ticket.id}`,'signin');await capturePage(page,shot,'foreign-session')
  // Issued link reuse is a readable refusal, not an application error page.
  const reused=await page.goto(origin+usedLink);assert.equal(reused.status(),400)
  await page.getByText('Invalid or expired sign-in link',{exact:true}).waitFor();await fits(page);await capturePage(page,shot,'reused-link')
  // Company membership is granted/revoked through native management, never inferred.
  await call(P+'/access/logout',{customer:true,body:{}})
  await signin('portal-member@harbor.example')
  const member=(await call(`/api/management/projects/${p}/contacts`)).data.find(row=>row.email==='portal-member@harbor.example')
  const requester=(await call(`/api/management/projects/${p}/contacts`)).data.find(row=>row.email===contactEmail)
  const company=(await call(`/api/management/projects/${p}/companies`,{status:201,body:{name:'Harbor',portalCompanyView:true}})).company
  const base=`/api/management/projects/${p}/companies/${company.id}`
  for(const person of [member,requester])await call(base+`/members/${person.id}`,{method:'PUT',body:{}})
  await open();await page.getByRole('heading',{name:ticket.subject,exact:true}).waitFor()
  await call(base+`/members/${member.id}`,{method:'DELETE'})
  await safePage(`/portal/${p}/requests/${ticket.id}`,'notfound');await capturePage(page,shot,'membership-refusal')
  assert.equal((await call(P+'/preferences',{customer:true})).email,'portal-member@harbor.example')
  await call(base+`/members/${member.id}`,{method:'PUT',body:{}})
  await call(base,{method:'PATCH',body:{portalCompanyView:false}})
  await safePage(`/portal/${p}/requests/${ticket.id}`,'notfound');await capturePage(page,shot,'entitlement-refusal')
  await call(P+'/access/logout',{customer:true,body:{}});await signin(contactEmail)
  // Stage an absent request because the product has no request deletion command.
  await runtime.execute(deletedRequestStatements(ticket.id).join(';'))
  await safePage(`/portal/${p}/requests/${ticket.id}`,'notfound');await capturePage(page,shot,'deleted-refusal')
  assert.equal((await call(P+'/preferences',{customer:true})).email,contactEmail)
  await call(`/api/management/projects/${p}/contacts/${requester.id}/erase`,{body:{}})
  await safePage(`/portal/${p}/requests/${ticket.id}`,'signin');await capturePage(page,shot,'erasure-refusal')
  await call(P+'/tickets',{customer:true,status:401});assert.deepEqual(errors,[]);passed=true
 }finally{await context.close();await runtime.close(passed);await rm(directory,{recursive:true,force:true})}
}
async function fits(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'portal has no horizontal scroll at 1440')}
async function capturePage(page,shot,name){
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:shot(`portal-${name}-${width}.png`),fullPage:true})}
 await page.setViewportSize({width:1440,height:900})
}
