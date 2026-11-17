import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createRuntime} from './emitted-runtime.mjs'
import {seedTicketBrowser} from './inbox/ticket-browser-fixture.mjs'
import {launchBrowser,evidence,auditPage} from '../journeys/kit/browser.mjs'

async function withWorkspace(name,journey){
 const runtime=await createRuntime({queueConsumers:true,vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}}),browser=await launchBrowser()
 let passed=false
 try{
  const fixture=await seedTicketBrowser(runtime.origin,2),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),shot=await evidence('stranger13')
  page.setDefaultTimeout(20000)
  try{
   await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent(`/projects/${fixture.projectId}/conversations`))
   await page.getByLabel('Email',{exact:true}).fill(fixture.owner.email);await page.getByLabel('Password',{exact:true}).fill(fixture.owner.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations')
   const capture=async label=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:shot(`${name}-${label}-${width}.png`),fullPage:true})}await page.setViewportSize({width:1440,height:1000})}
   await journey({runtime,fixture,context,page,capture});passed=true
  }finally{await context.close()}
 }finally{await browser.close();await runtime.close(passed)}
}

export const credentialBindingsBrowser=()=>withWorkspace('bindings',async({runtime,fixture,page,capture})=>{
 const {projectId,api,group,tags}=fixture,root=`/api/management/projects/${projectId}`,tokens=root+'/connections/tokens'
 const mailbox=(await api(root+'/mailboxes',{provider:'forwarding',address:'synthetic-support@example.test',displayName:'Returns mailbox'})).data
 const form=(await api(`/api/forms/projects/${projectId}/forms`,{title:'Returns request',fields:[],enabled:false})).data
 const prior=await api(tokens,{name:'Prior integration',source_product:'synthetic-prior',scopes:['conversations:read']})
 const before=(await api(tokens)).data,credential=before.find(item=>item.name==='Prior integration')
 assert.ok(prior.token&&credential)
 await page.goto(runtime.origin+`/projects/${projectId}/api-settings`)
 await page.getByLabel('Token name',{exact:true}).fill('Returns integration');await page.getByLabel('Source product',{exact:true}).fill('synthetic-returns')
 await page.getByText('Credential bindings',{exact:true}).click()
 const choices={Brands:fixture.owner.name,Mailboxes:'Returns mailbox (synthetic-support@example.test)',Groups:group.name,Forms:'Returns request',Priorities:'High',Tags:tags[0].name,Credentials:'Prior integration'}
 for(const [label,name] of Object.entries(choices))await page.getByLabel(label,{exact:true}).selectOption({label:name})
 await page.getByLabel('conversations:create',{exact:true}).check();await auditPage(page);await capture('selected')
 await page.getByRole('button',{name:'Create token',exact:true}).click();await page.getByLabel('New token',{exact:true}).waitFor()
 assert.ok((await page.getByLabel('New token',{exact:true}).inputValue()).length>20)
 await page.getByRole('button',{name:'Dismiss token',exact:true}).click()
 const row=(await api(tokens)).data.find(item=>item.name==='Returns integration')
 assert.deepEqual(JSON.parse(row.bindings_json),{brands:[projectId],mailboxes:[mailbox.id],groups:[group.id],forms:[form.id],priorities:['high'],tags:[tags[0].id],credentials:[credential.id]})
 const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Returns integration',exact:true})})
 for(const name of Object.values(choices))assert.ok((await card.innerText()).includes(name))
 // Another workspace's option IDs and names never enter this workspace's list.
 const foreign=await runtime.seedTenant({name:'Synthetic hidden brand',email:'synthetic-hidden@example.test'}),options=(await api(tokens)).bindingOptions
 assert.ok(!JSON.stringify(options).includes(foreign.projectId)&&!JSON.stringify(options).includes('Synthetic hidden brand'))
})

export const workspaceCreationBrowser=()=>withWorkspace('workspace',async({runtime,fixture,page,capture})=>{
 const toggle=page.getByRole('button',{name:/^Switch workspace:/})
 await toggle.click();const workspaceMenu=page.locator('.navbar-workspace-menu')
 await workspaceMenu.getByRole('link',{name:'Create workspace',exact:true}).waitFor();await capture('switcher')
 await workspaceMenu.getByRole('link',{name:'Create workspace',exact:true}).click();await page.getByRole('button',{name:'Create project',exact:true}).waitFor()
 await page.goto(runtime.origin+`/projects/${fixture.projectId}/conversations`)
 await page.getByRole('button',{name:'Account menu',exact:true}).filter({visible:true}).click()
 const account=page.locator('.native-account-dropdown').filter({visible:true});await account.getByRole('link',{name:'Create workspace',exact:true}).waitFor();await capture('account')
 await account.getByRole('link',{name:'Create workspace',exact:true}).click()
 await page.getByLabel('Name',{exact:true}).fill('Synthetic second workspace');await page.getByLabel('Website',{exact:true}).fill(runtime.origin);await page.getByLabel('Widget website origin',{exact:true}).fill(runtime.origin)
 await page.getByRole('button',{name:'Create project',exact:true}).click();await page.waitForURL('**/activation')
 await page.getByRole('heading',{name:'Setup',exact:true}).waitFor();const newId=new URL(page.url()).pathname.split('/')[2]
 assert.notEqual(newId,fixture.projectId)
 const workspaces=(await fixture.api('/api/management/projects')).data
 assert.equal(workspaces.find(item=>item.id===newId).role,'owner')
 await page.getByRole('button',{name:/^Switch workspace:/}).filter({hasText:'Synthetic second workspace'}).waitFor()
 await auditPage(page);await capture('created')
})

export const mergePickerBrowser=()=>withWorkspace('merge',async({runtime,fixture,page,context,capture})=>{
 const {projectId,base,api,tickets}=fixture,first=tickets[0],second=tickets[1]
 await api(`${base}/conversations/${first.id}/notes`,{content:'Synthetic private source note'})
 const foreign=await runtime.seedTenant({name:'Synthetic hidden merge',email:'synthetic-merge-other@example.test'})
 const foreignCall=async(path,body,method='POST')=>{const response=await context.request.fetch(runtime.origin+path,{method,headers:{Authorization:'Bearer '+foreign.token},data:body});assert.ok(response.ok());return response.json()}
 const foreignContact=(await foreignCall(`/api/management/projects/${foreign.projectId}/contacts`,{name:'Dana Whitfield',email:'synthetic-foreign-requester@example.test'})).data
 const foreignTicket=await foreignCall('/api/conversations',{projectId:foreign.projectId,contactId:foreignContact.id})
 await foreignCall(`/api/dashboard/projects/${foreign.projectId}/conversations/${foreignTicket.id}/ticket`,{subject:second.subject},'PATCH')
 await page.goto(runtime.origin+`/projects/${projectId}/conversations/${first.id}`)
 await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('menuitem',{name:'Merge ticket…',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Merge duplicate tickets',exact:true}),query=dialog.getByLabel('Requester or ticket subject',{exact:true})
 await query.fill('delivery address');await dialog.getByRole('button',{name:'Search tickets',exact:true}).click()
 const option=dialog.getByRole('radio',{name:new RegExp(second.subject.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});await option.waitFor();await option.check()
 await query.fill('Dana Whitfield');await dialog.getByRole('button',{name:'Search tickets',exact:true}).click();await option.waitFor()
 const response=await context.request.get(runtime.origin+`/api/dashboard/projects/${projectId}/ticket-merge-search?q=Dana`),found=await response.json()
 assert.ok(found.data.some(item=>item.id===second.id)&&!found.data.some(item=>item.id===foreignTicket.id))
 await dialog.getByLabel('Surviving ticket',{exact:true}).selectOption(second.id)
 await dialog.getByRole('button',{name:'Preview merge',exact:true}).click();await dialog.getByText('No customer notification is sent.',{exact:false}).waitFor()
 assert.match(await dialog.innerText(),new RegExp('Surviving: '+second.id));assert.match(await dialog.innerText(),new RegExp('Source: '+first.id));await auditPage(page);await capture('preview')
 await dialog.getByRole('button',{name:'Confirm merge',exact:true}).click();await page.waitForURL('**/conversations/'+second.id)
 const state=(await api(`${base}/conversations/${first.id}/ticket`)).data
 assert.equal(state.merged_into,second.id)
 const history=(await api(`${base}/conversations/${second.id}/merged-history`)).data
 assert.ok(history.some(item=>item.conversation_id===first.id));assert.ok(JSON.stringify(history).includes('Synthetic private source note'))
})

export async function missingProviderProcedureBrowser(){
 const runtime=await createRuntime({queueConsumers:true}),browser=await launchBrowser();let passed=false
 try{
  const owner=await runtime.seedTenant({name:'Synthetic procedure workspace',email:'synthetic-procedure@example.test'}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),shot=await evidence('stranger13')
  try{
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}]);page.setDefaultTimeout(20000)
   await page.goto(runtime.origin+`/projects/${owner.projectId}/procedures`)
   await page.getByLabel('Procedure key',{exact:true}).fill('exchange');await page.getByLabel('Maximum simulation cost (USD)',{exact:true}).fill('0.10')
   await page.getByRole('button',{name:'Save immutable version',exact:true}).click();await page.getByRole('button',{name:'exchange · Version 1',exact:true}).click();await page.getByRole('button',{name:'Run synthetic simulation',exact:true}).click()
   const root=`/api/projects/${owner.projectId}/procedures`,versions=(await (await context.request.get(runtime.origin+root)).json()).versions;let run
   for(let n=0;n<60;n++){run=(await (await context.request.get(runtime.origin+`${root}/exchange/versions/${versions[0].id}/simulations`)).json()).runs[0];if(run?.status==='blocked')break;await page.waitForTimeout(500)}
   assert.equal(run.status,'blocked')
   await page.getByRole('button',{name:'Refresh receipts',exact:true}).click();await page.getByRole('button',{name:'Inspect cases',exact:true}).click()
   const receipt=page.getByLabel('Simulation receipt');await receipt.getByText('Not run',{exact:true}).first().waitFor()
   assert.equal(await receipt.getByText('Not run',{exact:true}).count(),4);assert.doesNotMatch(await receipt.innerText(),/uncertain|replayed automatically/)
   await receipt.getByText('Add OPENAI_API_KEY',{exact:true}).waitFor();await receipt.getByRole('link',{name:'AI settings',exact:true}).waitFor()
   const details=(await (await context.request.get(runtime.origin+`/api/training/projects/${owner.projectId}/runs/${run.id}`)).json()).data
   assert.equal(details.reserved_cost,0);assert.equal(details.spent_cost,0);assert.ok(details.cases.every(item=>!item.attempt_id&&!item.started_at&&!item.provider_rounds.length))
   await auditPage(page)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await receipt.scrollIntoViewIfNeeded();await page.screenshot({path:shot(`simulation-blocked-${width}.png`)})}
   passed=true
  }finally{await context.close()}
 }finally{await browser.close();await runtime.close(passed)}
}
