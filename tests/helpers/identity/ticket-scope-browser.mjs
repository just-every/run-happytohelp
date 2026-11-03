import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRuntime} from '../emitted-runtime.mjs'
import {evidence} from '../../journeys/kit/browser.mjs'

/** Extends the current identity browser journey. Assertions run at 1440; the
 * same public flows supply the separate phone proof without a viewport matrix. */
export async function ticketScopeBrowserJourney(browser,{width=1440,proofOnly=false,before=false,runtime:provided,localOwner}={}){
 const runtime=provided??await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development'}}),origin=runtime.origin,contexts=[],shot=await evidence('ticket-scope'),errors=[]
 const verify=(actual,expected,message)=>{if(!proofOnly&&!before)assert.deepEqual(actual,expected,message)}
 const request=async(path,body,token,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  return {status:response.status,data:await response.json()}
 }
 const good=async(...args)=>{const r=await request(...args);assert.ok(r.status>=200&&r.status<300,`${args[0]}: ${r.status} ${JSON.stringify(r.data)}`);return r.data.data??r.data}
 let passed=false
 try{
  const fixture=randomUUID().slice(0,8),password='synthetic-hh-304-password',email=who=>`synthetic-hh-304-${who}-${fixture}@example.test`
  let owner,tenant
  if(localOwner){owner=await good('/api/identity/login',localOwner);tenant={projectId:owner.actor.projectId}}
  else{tenant=await good('/api/identity/bootstrap',{email:email('owner'),password,name:'Synthetic scope workspace',ownerName:'Synthetic Owner',allowedOrigin:origin});owner=await good('/api/identity/login',{email:email('owner'),password})}
  const projectId=tenant.projectId??owner.actor.projectId,P=`/api/management/projects/${projectId}`,D=`/api/dashboard/projects/${projectId}/conversations`,R=P+'/roles',rolesUrl=origin+`/projects/${projectId}/roles`
  const members={}
  for(const [who,role] of [['admin','admin'],['agent','operator'],['collaborator','collaborator']]){
   const invitation=await good(P+'/agents',{email:email(who),role},owner.token)
   await good('/api/identity/accept-token',{token:new URL(invitation.invitationUrl).searchParams.get('token'),name:'Synthetic '+who,password})
   members[who]=await good('/api/identity/login',{email:email(who),password})
  }
  const group=await good(P+'/ticket-groups',{name:'Synthetic Care '+fixture,members:[members.agent.actor.id,members.collaborator.actor.id]},owner.token)
  const other=await good(P+'/ticket-groups',{name:'Synthetic Other '+fixture,members:[]},owner.token)
  const definition={name:'Synthetic ticket role '+fixture,base:'operator',permissions:['conversations.manage','conversations.reply','conversations.notes','conversations.follow']}
  const selected={groupIds:[group.id],includeUngrouped:false},role=await good(R,{...definition,ticketScope:selected},owner.token)
  await good(P+'/agents/'+members.agent.actor.id,{role:role.id},owner.token,'PUT')
  const collabRole=await good(R,{name:'Synthetic collaborator '+fixture,base:'collaborator',permissions:['conversations.notes','conversations.follow'],ticketScope:selected},owner.token)
  await good(P+'/agents/'+members.collaborator.actor.id,{role:collabRole.id},owner.token,'PUT')
  if(before&&runtime.execute)await runtime.execute(`UPDATE project_roles SET ticket_scope_json='${JSON.stringify(selected)}' WHERE id IN ('${role.id}','${collabRole.id}')`)
  const project=await good('/api/identity/projects/'+projectId,undefined,owner.token)
  const visitor=await good('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Synthetic customer '+fixture})
  const visible=await good('/api/conversations',{projectId},visitor.token),hidden=await good('/api/conversations',{projectId},visitor.token)
  await good(D+'/'+visible.id+'/ticket',{group_id:group.id},owner.token,'PATCH');await good(D+'/'+hidden.id+'/ticket',{group_id:other.id},owner.token,'PATCH')
  const transcript='Synthetic visible transcript '+fixture,draft='Synthetic private unsent draft '+fixture
  await good('/api/conversations/'+visible.id+'/messages',{localId:'synthetic-hh-304-opening',content:transcript,expectedRevision:0},visitor.token)
  await good('/api/conversations/'+hidden.id+'/messages',{localId:'synthetic-hh-304-hidden',content:'Synthetic hidden transcript '+fixture,expectedRevision:0},visitor.token)
  const pageFor=async(token,url,{recordClose=false}={})=>{
   const context=await browser.newContext({viewport:{width,height:width===390?844:900}});contexts.push(context)
   if(recordClose)await context.addInitScript(()=>{const Native=window.WebSocket;window.__h2hClosed=[];window.__h2hAccessFrames=[];window.WebSocket=class extends Native{constructor(...args){super(...args);this.addEventListener('close',event=>window.__h2hClosed.push({url:this.url,code:event.code}));this.addEventListener('message',event=>{if(typeof event.data==='string'&&event.data.includes('"access_changed"'))window.__h2hAccessFrames.push(Date.now())})}}})
   await context.addCookies([{name:'h2h_session',value:token,url:origin}]);const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(url);return page
  }
  const capture=async(page,name)=>{await page.screenshot({path:shot(`${name}-${width}${before?'-before':''}.png`),fullPage:true});return shot(`${name}-${width}${before?'-before':''}.png`)}
  const ownerPage=await pageFor(owner.token,rolesUrl)
  await ownerPage.getByRole('heading',{name:'Custom roles',exact:true}).waitFor()
  const paths={owner:await capture(ownerPage,'roles-owner')}
  const adminPage=await pageFor(members.admin.token,rolesUrl)
  await adminPage.getByRole('heading',{name:'Custom roles',exact:true}).waitFor()
  paths.admin=await capture(adminPage,'roles-admin')
  if(!before){
   // New role defaults to All; an explicit empty selection persists as No tickets.
   await adminPage.getByRole('button',{name:'New role',exact:true}).click()
   verify(await adminPage.getByLabel('All tickets',{exact:true}).isChecked(),true)
   await adminPage.getByLabel('Name',{exact:true}).fill('Synthetic empty '+fixture)
   await adminPage.getByLabel('Selected groups',{exact:true}).check()
   await adminPage.getByRole('status').filter({hasText:'No groups selected'}).waitFor()
   paths.empty=await capture(adminPage,'roles-empty')
   await adminPage.getByRole('button',{name:'Create role',exact:true}).click()
   await adminPage.getByRole('status').filter({hasText:'Role created'}).waitFor()
   await adminPage.reload()
   const card=adminPage.locator('.roles-card').filter({has:adminPage.getByRole('heading',{name:'Synthetic empty '+fixture,exact:true})})
   await card.getByText('No tickets',{exact:true}).waitFor();await card.getByRole('button',{name:'Edit',exact:true}).click()
   verify(await adminPage.getByLabel('Selected groups',{exact:true}).isChecked(),true)
   await adminPage.getByLabel(group.name,{exact:true}).check();await adminPage.getByLabel('Include ungrouped tickets',{exact:true}).check()
   // Phone proof records the actual new controls' hit rectangles.
   const targets=await adminPage.locator('.role-scope-choice').evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width})))
   verify(targets.every(target=>target.height>=44&&target.width>=44),true,'scope controls are usable')
   await adminPage.getByRole('button',{name:'Save role',exact:true}).click();await adminPage.getByRole('status').filter({hasText:'Role saved'}).waitFor();await adminPage.reload()
   const persisted=(await good(R,undefined,owner.token)).custom.find(r=>r.name==='Synthetic empty '+fixture)
   verify(persisted.ticketScope,{groupIds:[group.id],includeUngrouped:true})
   // A real duplicate-name conflict is visible, with the unsaved form retained.
   const ownerCard=ownerPage.locator('.roles-card').filter({has:ownerPage.getByRole('heading',{name:definition.name,exact:true})})
   await ownerCard.getByRole('button',{name:'Edit',exact:true}).click();await ownerPage.getByLabel('Name',{exact:true}).fill('Synthetic empty '+fixture)
   await ownerPage.getByRole('button',{name:'Save role',exact:true}).click();await ownerPage.getByRole('alert').filter({hasText:/already exists/}).first().waitFor()
   paths.failed=await capture(ownerPage,'roles-failed-save')
   verify(await ownerPage.getByLabel('Name',{exact:true}).inputValue(),'Synthetic empty '+fixture)
   await ownerPage.getByLabel('Name',{exact:true}).fill(definition.name)
   const overflow=await Promise.all([ownerPage,adminPage].map(page=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)))
   verify(overflow,[false,false])
   console.log(`PROBE ACCESS-001 P10 ${width}: native owner/admin Roles, empty/default/selection/ungrouped/save/reload/real conflict -> ${JSON.stringify({paths,targets,overflow,persisted:persisted.ticketScope})}`)
  }else console.log(`PROBE ACCESS-001 P10 BEFORE ${width}: native owner/admin Roles -> ${JSON.stringify({paths,scopeControls:await ownerPage.getByRole('group',{name:'Ticket access'}).count()})}`)
  const agent=await pageFor(members.agent.token,origin+`/projects/${projectId}/conversations/${visible.id}`,{recordClose:true})
  const prompts=[];agent.on('dialog',dialog=>{prompts.push(dialog.message());dialog.dismiss()})
  await agent.getByPlaceholder('Type your reply…').waitFor();await agent.getByText(transcript,{exact:true}).first().waitFor();await agent.getByPlaceholder('Type your reply…').fill(draft)
  // A window marker and the navigation entry prove the page is never reloaded or navigated by a saved role.
  const pageStamp=await agent.evaluate(()=>{window.__h2hStays=crypto.randomUUID();return {marker:window.__h2hStays,entries:performance.getEntriesByType('navigation').length,href:location.href}})
  const device=await good('/api/mobile/v1/devices',{platform:'ios',scopes:['read']},members.agent.token)
  // Live access frame: a role save that leaves this ticket readable changes nothing the agent sees; the open ticket is re-read, never reset.
  const agentRead=()=>request(D+'/'+visible.id,undefined,members.agent.token)
  const frames=()=>agent.evaluate(()=>window.__h2hAccessFrames.length)
  if(!before){
   const ticketReads=[];agent.on('request',req=>{if(req.method()==='GET'&&new URL(req.url()).pathname===D+'/'+visible.id)ticketReads.push(Date.now())})
   const intact=async(label)=>{
    const read=await agentRead();verify(read.status,200,`${label}: the agent's read of the ticket is still 200`)
    verify(await agent.getByText(transcript,{exact:true}).count()>0,true,`${label}: transcript stands`)
    verify(await agent.getByPlaceholder('Type your reply…').inputValue(),draft,`${label}: draft text stands`)
    verify(await agent.getByText(/This ticket is unavailable/).count(),0,`${label}: no unavailable state`)
    verify(prompts,[],`${label}: no leave prompt`)
    verify(await agent.evaluate(()=>({marker:window.__h2hStays,entries:performance.getEntriesByType('navigation').length,href:location.href})),pageStamp,`${label}: no reload or navigation`)
    verify(await agent.locator('.conversation-list-items').filter({hasText:'Synthetic customer '+fixture}).count()>0,true,`${label}: inbox stands`)
   }
   const saveRole=async(body,label)=>{
    const before=ticketReads.length,seen=await frames()
    verify((await request(R+'/'+role.id,body,owner.token,'PUT')).status,200,`${label}: role save`)
    // The frame makes the open ticket re-read itself, with no further message from the customer.
    await agent.waitForFunction(count=>window.__h2hAccessFrames.length>count,seen);const deadline=Date.now()+5000
    while(ticketReads.length===before&&Date.now()<deadline)await agent.waitForTimeout(100)
    verify(ticketReads.length>before,true,`${label}: the frame re-read the open ticket`)
    await agent.waitForTimeout(500);await intact(label)
   }
   await saveRole({...definition,ticketScope:selected},'unchanged')
   await saveRole({...definition,name:definition.name+' renamed',ticketScope:selected},'renamed')
   await saveRole({...definition,name:definition.name+' renamed',ticketScope:{groupIds:[group.id,other.id],includeUngrouped:true}},'widened')
   // A re-read that fails for a reason other than access (a 500, then a dropped connection) keeps the ticket and the draft.
   for(const [label,fail] of [['500 on re-read',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetic outage'}})})],['network error on re-read',route=>route.abort('failed')]]){
    let blocked=0;const handler=route=>{if(route.request().method()==='GET'){blocked++;return fail(route)}return route.continue()}
    const matcher=url=>url.pathname===D+'/'+visible.id||url.pathname.startsWith(D+'/'+visible.id+'/buckets')
    await agent.route(matcher,handler)
    const seen=await frames()
    verify((await request(R+'/'+role.id,{...definition,name:definition.name+' renamed',ticketScope:{groupIds:[group.id,other.id],includeUngrouped:true}},owner.token,'PUT')).status,200,`${label}: role save`)
    await agent.waitForFunction(count=>window.__h2hAccessFrames.length>count,seen);const deadline=Date.now()+5000;while(!blocked&&Date.now()<deadline)await agent.waitForTimeout(100)
    verify(blocked>0,true,`${label}: the frame re-read the open ticket and it failed`)
    await agent.waitForTimeout(500)
    verify(await agent.getByText(transcript,{exact:true}).count()>0,true,`${label}: transcript stands`)
    verify(await agent.getByPlaceholder('Type your reply…').inputValue(),draft,`${label}: draft stands`)
    verify(await agent.getByText(/This ticket is unavailable/).count(),0,`${label}: not marked unavailable`)
    verify(prompts,[],`${label}: no leave prompt`);verify(await agent.evaluate(()=>window.__h2hStays),pageStamp.marker,`${label}: no reload`)
    await agent.unroute(matcher,handler)
   }
   // Back to the original scope, then the live narrowing below.
   await request(R+'/'+role.id,{...definition,ticketScope:selected},owner.token,'PUT')
   await agent.waitForTimeout(500);await intact('restored')
   paths.stays=await capture(agent,'agent-role-saves-keep-draft')
  }
  // Edit with members: warning precedes Save, and the saved notice echoes sign-out.
  if(!before){
   await ownerPage.getByText(/Saving this role signs out the mobile devices/).waitFor()
   await ownerPage.getByLabel('All tickets',{exact:true}).check()
   paths.warning=await capture(ownerPage,'roles-warning')
   await ownerPage.getByLabel('Selected groups',{exact:true}).check()
   const saving=ownerPage.waitForResponse(response=>response.url().endsWith('/roles/'+role.id)&&response.request().method()==='PUT')
   const framesSeen=await frames(),narrowRead=agent.waitForResponse(response=>new URL(response.url()).pathname===D+'/'+visible.id&&response.request().method()==='GET')
   await ownerPage.getByRole('button',{name:'Save role',exact:true}).click();verify((await saving).status(),200)
   await ownerPage.getByRole('status').filter({hasText:/Mobile devices of its members/}).waitFor()
   // Narrowed: the frame alone re-reads the open ticket, the read is 404 and the generic state shows within about 2 s, with no customer message.
   await agent.waitForFunction(count=>window.__h2hAccessFrames.length>count,framesSeen)
   // The alert can render before the inbox refresh clears the selected ticket.
   const waitForUnavailable=()=>Promise.all([
    agent.getByRole('alert').filter({hasText:/This ticket is unavailable/}).waitFor({timeout:2000}),
    agent.getByText(transcript,{exact:true}).first().waitFor({state:'detached',timeout:2000}),
    agent.getByPlaceholder('Type your reply…').waitFor({state:'detached',timeout:2000})
   ])
   await waitForUnavailable()
   verify((await narrowRead).status(),404,'the re-read after the frame is 404')
   verify(await agent.getByText(transcript,{exact:true}).count(),0);verify(await agent.getByPlaceholder('Type your reply…').count(),0)
   verify(await agent.locator('body').evaluate((body,text)=>body.innerHTML.includes(text),draft),false)
   verify((await agentRead()).status,404,'the next read of the hidden ticket is 404')
   // Live revocation also rechecks at the next frame: the server closes this ticket's stream 1008.
   await agent.waitForFunction(id=>window.__h2hClosed.some(close=>close.code===1008&&close.url.includes('/api/conversations/'+id+'/socket')),visible.id)
   await waitForUnavailable()
   verify(await agent.getByText(transcript,{exact:true}).count(),0);verify(await agent.getByPlaceholder('Type your reply…').count(),0)
   verify(await agent.locator('body').evaluate((body,text)=>body.innerHTML.includes(text),draft),false)
   // The next read of the hidden ticket is the same generic state, with no hidden content in the DOM.
   await agent.reload()
   await waitForUnavailable()
   verify(await agent.getByText(transcript,{exact:true}).count(),0);verify(await agent.getByPlaceholder('Type your reply…').count(),0)
   verify(await agent.locator('body').evaluate((body,text)=>body.innerHTML.includes(text),transcript),false)
  }else if(runtime.execute)await runtime.execute(`UPDATE project_roles SET ticket_scope_json='${JSON.stringify({groupIds:[other.id],includeUngrouped:false})}' WHERE id='${role.id}'`)
  const livePath=await capture(agent,'agent-revoked'),mobile=await request('/api/mobile/v1/tickets',undefined,device.token)
  verify(mobile.status,401);verify(mobile.data.code,'mobile_session_invalid')
  console.log(`PROBE ACCESS-001 P11 ${before?'BEFORE ':''}${width}: agent ticket/draft open, owner narrows role, stream closes at the next frame, reload reads generic unavailable -> ${JSON.stringify({path:livePath,transcriptPresent:await agent.getByText(transcript,{exact:true}).count(),draftPresent:await agent.getByPlaceholder('Type your reply…').count()})}`)
  const collaborator=await pageFor(members.collaborator.token,origin+`/projects/${projectId}/conversations/${visible.id}`)
  await collaborator.getByText(transcript,{exact:true}).first().waitFor()
  await collaborator.getByRole('button',{name:'Add internal note',exact:true}).click()
  const dialog=collaborator.getByRole('dialog');await dialog.getByRole('textbox').fill('Synthetic collaborator note '+fixture)
  await dialog.getByRole('button',{name:'Add',exact:true}).click();await collaborator.getByText('Synthetic collaborator note '+fixture,{exact:true}).first().waitFor()
  await collaborator.getByRole('button',{name:'Actions',exact:true}).click();await collaborator.getByRole('menuitemcheckbox',{name:'Follow',exact:true}).click();await collaborator.getByRole('button',{name:'Actions',exact:true}).click();await collaborator.getByRole('menuitemcheckbox',{name:'Following',exact:true}).waitFor();await collaborator.keyboard.press('Escape')
  const reply=await request('/api/conversations/'+visible.id+'/messages',{content:'Synthetic forbidden public reply',localId:'synthetic-hh-304-collaborator'},members.collaborator.token)
  const fields=await request(D+'/'+visible.id+'/ticket',{priority:'urgent'},members.collaborator.token,'PATCH')
  verify(reply.status,403);verify(fields.status,403)
  const collaboratorPath=await capture(collaborator,'collaborator-allowed')
  await collaborator.goto(origin+`/projects/${projectId}/conversations/${hidden.id}`)
  await collaborator.getByRole('alert').filter({hasText:before?/load this conversation/:/This ticket is unavailable/}).waitFor()
  verify(await collaborator.getByText('Synthetic hidden transcript '+fixture,{exact:true}).count(),0)
  const hiddenPath=await capture(collaborator,'collaborator-hidden')
  console.log(`PROBE ACCESS-001 P12 ${before?'BEFORE ':''}${width}: scoped collaborator read/note/follow, reply/field refusal, hidden ticket; member mobile after warned role save -> ${JSON.stringify({allowed:collaboratorPath,hidden:hiddenPath,reply:reply.status,fields:fields.status,mobile:{status:mobile.status,code:mobile.data.code},warning:paths.warning})}`)
  verify(errors,[],'no browser runtime error');passed=true
 }finally{for(const context of contexts)await context.close();if(!provided)await runtime.close(passed)}
}
