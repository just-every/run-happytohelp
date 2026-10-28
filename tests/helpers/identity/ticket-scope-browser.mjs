import assert from 'node:assert/strict'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'

/** Emitted native Roles and inbox paths; extends the existing security journey. */
export async function ticketScopeBrowserJourney(browser,runtime){
 const shot=await evidence('hh-access001-team-scope-n3'),contexts=[]
 let current
 try{
  const origin=runtime.origin
  const api=async(path,body,method='GET',token)=>{
   const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
   const data=await response.json();return {status:response.status,data}
  }
  const made=await runtime.seedTenant({name:'Lantern Support',email:'scope-owner@example.test',allowedOrigin:origin})
  const p=made.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}`,ownerToken=made.token
  const ownerApi=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await api(path,body,method,ownerToken);assert.ok(r.status<300,JSON.stringify(r));return r.data}
  const groups=[]
  for(const name of ['Returns','Shipping','Finance'])groups.push((await ownerApi(`${P}/ticket-groups`,{name,members:[]})).data)
  const invited=await ownerApi(`${P}/agents`,{email:'jordan@example.test',role:'operator'})
  const invitation=new URL(invited.data.invitationUrl).searchParams.get('token')
  const accepted=await api('/api/identity/accept-token',{token:invitation,name:'Jordan Agent',password:'scope-agent-correct-horse'},'POST');assert.equal(accepted.status,200)
  const login=await api('/api/identity/login',{email:'jordan@example.test',password:'scope-agent-correct-horse'},'POST');assert.equal(login.status,200)
  const agentToken=login.data.token,agentId=login.data.actor.id
  const project=(await ownerApi(`/api/identity/projects/${p}`)),tickets=[]
  for(const [index,name] of ['Return label for boots','Shipping update for order','Private finance dispute','Ungrouped delivery question'].entries()){
   const session=await api('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Morgan Customer',email:`morgan-${index}@example.test`},'POST');assert.equal(session.status,201)
   const created=await api('/api/conversations',{projectId:p},'POST',session.data.token);assert.equal(created.status,201)
   const id=created.data.id;tickets.push(id)
   assert.equal((await api(`/api/conversations/${id}/messages`,{localId:`scope-browser-${index}`,content:`${name}: synthetic customer request`,expectedRevision:0},'POST',session.data.token)).status,200)
   await ownerApi(`${D}/conversations/${id}/ticket`,{subject:name,...(index<3?{group_id:groups[index].id}:{})},'PATCH')
  }
  const open=async(token,viewport)=>{const context=await browser.newContext({viewport});contexts.push(context);await context.addCookies([{name:'h2h_session',value:token,url:origin}]);const page=await context.newPage();page.setDefaultTimeout(20000);current=page;return page}
  const inspect=async(page,name)=>{if(page.viewportSize().width===1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': no horizontal overflow');await page.screenshot({path:shot(name+'.png'),fullPage:true})}
  const owner=await open(ownerToken,viewports.desktop)
  await owner.goto(origin+`/projects/${p}/roles`);await owner.getByRole('button',{name:'New role'}).click()
  await owner.getByLabel('Name',{exact:true}).fill('Returns and shipping agent')
  await owner.getByRole('radio',{name:'Selected groups',exact:true}).check()
  await owner.getByLabel('Returns',{exact:true}).check();await owner.getByLabel('Shipping',{exact:true}).check()
  await owner.getByLabel('Include ungrouped tickets',{exact:true}).check()
  await inspect(owner,'roles-selected-1440');await owner.setViewportSize(viewports.mobile);await inspect(owner,'roles-selected-390');await owner.setViewportSize(viewports.desktop)
  await owner.getByRole('button',{name:'Create role',exact:true}).click();await owner.getByRole('heading',{name:'Returns and shipping agent',exact:true}).waitFor()
  const role=(await ownerApi(`${P}/roles`)).data.custom.find(r=>r.name==='Returns and shipping agent')
  assert.deepEqual(role.ticketScope,{groupIds:[groups[0].id,groups[1].id],includeUngrouped:true})
  const card=()=>owner.locator('article').filter({has:owner.getByRole('heading',{name:role.name,exact:true})})
  await owner.reload();await card().getByRole('button',{name:'Edit',exact:true}).click()
  assert.equal(await owner.getByLabel('Returns',{exact:true}).isChecked(),true);assert.equal(await owner.getByLabel('Shipping',{exact:true}).isChecked(),true);assert.equal(await owner.getByLabel('Include ungrouped tickets',{exact:true}).isChecked(),true)
  await owner.getByLabel('Include ungrouped tickets',{exact:true}).uncheck()
  await owner.getByRole('button',{name:'Save role',exact:true}).click();await owner.getByText('Role saved.',{exact:true}).waitFor()
  await ownerApi(`${P}/agents/${agentId}`,{role:role.id},'PUT')
  const agent=await open(agentToken,viewports.desktop)
  for(const viewport of [viewports.desktop,viewports.mobile]){
   await owner.setViewportSize(viewport);await agent.setViewportSize(viewport)
   await card().getByRole('button',{name:'Edit',exact:true}).click();await owner.keyboard.press('Tab');await owner.getByRole('radio',{name:'Selected groups',exact:true}).focus()
   if(viewport.width===1440)assert.ok(await owner.getByRole('radio',{name:'Selected groups',exact:true}).evaluate(el=>el.matches(':focus-visible')),'keyboard focus is visible')
   if(viewport.width===1440){const heights=await owner.locator('.role-scope-choice').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));assert.ok(heights.every(h=>h>=44),'scope targets are at least 44px')}
   await inspect(owner,`roles-reloaded-${viewport.width}`);await owner.getByRole('button',{name:'Cancel',exact:true}).click()
   await agent.goto(origin+`/projects/${p}/conversations?view=open`);await agent.getByText('Return label for boots',{exact:true}).first().waitFor()
   if(viewport.width===1440){assert.equal(await agent.getByText('Private finance dispute',{exact:true}).count(),0);assert.equal(await agent.getByText('Ungrouped delivery question',{exact:true}).count(),0)}
   await inspect(agent,`restricted-inbox-${viewport.width}`)
   await agent.goto(origin+`/projects/${p}/conversations/${tickets[0]}`);await agent.getByText('Return label for boots: synthetic customer request',{exact:true}).waitFor();await inspect(agent,`permitted-ticket-${viewport.width}`)
   if(viewport.width===1440){
    // Hold the real close request at the browser edge. Optimistic status must not
    // admit an overlapping reopen before the first native mutation has settled.
    const mutationUrl=origin+`${D}/conversations/${tickets[0]}`
    let releaseClose
    const closeGate=new Promise(resolve=>{releaseClose=resolve})
    const holdClose=async route=>{
     if(route.request().method()==='PUT'&&route.request().postDataJSON()?.resolved===true)await closeGate
     await route.continue()
    }
    const isMutation=(response,resolved)=>response.url()===mutationUrl&&response.request().method()==='PUT'&&response.request().postDataJSON()?.resolved===resolved
    await agent.route(mutationUrl,holdClose)
    const closeRequested=agent.waitForRequest(request=>request.url()===mutationUrl&&request.method()==='PUT'&&request.postDataJSON()?.resolved===true)
    const closed=agent.waitForResponse(response=>isMutation(response,true))
    try{
     await agent.getByRole('button',{name:'Close',exact:true}).click();await closeRequested
     const reopen=agent.getByRole('button',{name:'Reopen',exact:true});await reopen.waitFor()
     assert.equal(await reopen.isDisabled(),true,'the optimistic reopen waits for the pending close')
     const panelToggle=agent.locator('.conversation-assistant-toggle')
     if(await panelToggle.getAttribute('aria-expanded')==='true')await panelToggle.click()
     await agent.waitForFunction(()=>document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden')==='true')
     await inspect(agent,'pending-close-1440');await agent.setViewportSize(viewports.mobile)
     await agent.waitForFunction(()=>{const box=document.querySelector('.conversation-header-actions')?.getBoundingClientRect();return box&&box.left>=0&&box.right<=innerWidth})
     await inspect(agent,'pending-close-390');await agent.setViewportSize(viewports.desktop)
     releaseClose();assert.equal((await closed).status(),200,'the scoped close commits')
     const reopened=agent.waitForResponse(response=>isMutation(response,false))
     await reopen.click();assert.equal((await reopened).status(),200,'the scoped reopen commits after close')
     await agent.getByRole('button',{name:'Close',exact:true}).waitFor()
     const stored=await api(`${D}/conversations/${tickets[0]}`,undefined,'GET',agentToken)
     assert.equal(stored.status,200);assert.equal(stored.data.data.resolved_at,null,'reopen remains durable')
     await agent.reload();await agent.getByRole('button',{name:'Close',exact:true}).waitFor()
    }finally{releaseClose();await closed.catch(()=>{});await agent.unroute(mutationUrl,holdClose)}
   }
   await agent.goto(origin+`/projects/${p}/conversations/${tickets[2]}`);await agent.getByText(/This ticket is unavailable/).waitFor();if(viewport.width===1440)assert.equal(await agent.getByText('Private finance dispute: synthetic customer request',{exact:true}).count(),0);await inspect(agent,`denied-ticket-${viewport.width}`)
  }
  await agent.setViewportSize(viewports.desktop)
  await agent.goto(origin+`/projects/${p}/conversations/${tickets[0]}`);await agent.getByText('Return label for boots: synthetic customer request',{exact:true}).waitFor()
  assert.equal((await api(`${D}/conversations/${tickets[0]}/notes`,{content:'Return label reviewed by scoped agent'},'POST',agentToken)).status,201)
  // Narrow through the actual editor while the operator holds the ticket open.
  await owner.setViewportSize(viewports.desktop);await card().getByRole('button',{name:'Edit',exact:true}).click()
  await owner.getByLabel('Returns',{exact:true}).uncheck();await owner.getByLabel('Shipping',{exact:true}).uncheck()
  await owner.getByText('This role will see no tickets.',{exact:true}).waitFor();await inspect(owner,'roles-empty-1440')
  await owner.setViewportSize(viewports.mobile);await inspect(owner,'roles-empty-390')
  await owner.getByRole('button',{name:'Save role',exact:true}).click();await owner.getByText('Role saved.',{exact:true}).waitFor()
  await agent.getByText(/This ticket is unavailable/).waitFor();assert.equal(await agent.getByText('Return label for boots: synthetic customer request',{exact:true}).count(),0,'open transcript cleared after narrowing');await inspect(agent,'revoked-open-ticket-1440')
  await agent.setViewportSize(viewports.mobile);await inspect(agent,'revoked-open-ticket-390')
  await agent.goto(origin+`/projects/${p}/conversations?view=open`);await agent.setViewportSize(viewports.desktop);assert.equal(await agent.getByText('Return label for boots',{exact:true}).count(),0);await inspect(agent,'empty-inbox-1440');await agent.setViewportSize(viewports.mobile);await inspect(agent,'empty-inbox-390')
  // A deleted group is a real failed save; the form retains the attempted selection.
  const temporary=(await ownerApi(`${P}/ticket-groups`,{name:'Temporary review group',members:[]})).data
  await owner.reload();await card().getByRole('button',{name:'Edit',exact:true}).click();await owner.getByLabel('Temporary review group',{exact:true}).check()
  await ownerApi(`${P}/ticket-groups/${temporary.id}`,undefined,'DELETE')
  await owner.setViewportSize(viewports.desktop)
  await owner.getByRole('button',{name:'Save role',exact:true}).click();await owner.getByText(/Your changes are kept here/).waitFor();assert.equal(await owner.getByLabel('Temporary review group',{exact:true}).isChecked(),true)
  await inspect(owner,'roles-failed-save-1440');await owner.setViewportSize(viewports.mobile);await inspect(owner,'roles-failed-save-390')
  assert.deepEqual((await ownerApi(`${P}/roles`)).data.custom.find(r=>r.id===role.id).ticketScope,{groupIds:[],includeUngrouped:false},'failed save leaves stored policy unchanged')
  assert.equal((await api(`${D}/conversations/${tickets[0]}`,undefined,'GET',ownerToken)).status,200,'native owner recovery survives empty scope')
 }catch(error){await current?.screenshot({path:shot('failure.png'),fullPage:true}).catch(()=>{});throw error}
 finally{for(const context of contexts)await context.close()}
}
