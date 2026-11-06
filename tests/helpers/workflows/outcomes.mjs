import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {createRuntime} from '../emitted-runtime.mjs'
import {findDatabase} from '../upgrade-snapshot.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'
import {durableAutomationOutcomes} from './outcomes-runtime.mjs'

// Built Settings and public HTTP commands; SQLite is a read-only outcome oracle.
export async function automationOutcomes(){
 const runtime=await createRuntime({queueConsumers:true,outboundFixture:new URL('./outcomes-network.mjs',import.meta.url).href,vars:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-workflow-key',EMAIL_FROM:'support@example.test'}}),browser=await launchBrowser()
 let passed=false
 try{
  const owner=await runtime.seedTenant({name:'Refund support',email:'lead@example.test',allowedOrigin:runtime.origin}),base=`/api/dashboard/projects/${owner.projectId}`
  const request=async(path,body,token=owner.token,method=body===undefined?'GET':'POST',headers={})=>{
   const response=await fetch(runtime.origin+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...headers},body:body===undefined?undefined:JSON.stringify(body)})
   const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data
  }
  const api=(path,body,method)=>request(base+path,body,owner.token,method),get=async id=>(await api(`/conversations/${id}/ticket`)).data
  await request(`/api/management/projects/${owner.projectId}/settings`,{is_presence_away_enabled:false},owner.token,'PUT')
  const project=await request(`/api/identity/projects/${owner.projectId}`)
  const customer=await request('/api/identity/widget/session',{widgetKey:project.widget_key,email:'requester@example.test',name:'Refund requester'},'', 'POST',{Origin:runtime.origin})
  const create=async priority=>{
   const ticket=await request('/api/conversations',{projectId:owner.projectId,contactId:customer.contactId})
   await request(`/api/conversations/${ticket.id}/messages`,{localId:crypto.randomUUID(),content:'Please review my return.',expectedRevision:0},customer.token)
   await api(`/conversations/${ticket.id}/ticket`,{priority},'PATCH')
   return ticket.id
  }
  const historical=await create('high'),tag=(await api(`/conversations/${historical}/tags`,{name:'VIP refund'})).data
  await api('/routing-operators',{operators:[{user_id:owner.userId,available:true,capacity:100,skills:[]}]},'PUT')
  const database=await findDatabase(join(runtime.directory,'state/v3/d1'))
  const snapshot=()=>{
   const db=new DatabaseSync(database,{readOnly:true})
   try{
    const tables=['conversations','messages','ticket_history','conversation_tags','ticket_field_values','routing_decisions','workflow_runs','workflow_notifications','notification_trigger_claims','notification_inbox','email_deliveries','native_integration_events','native_integration_intents']
    return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]))
   }finally{db.close()}
  }
  const edges=async()=>{try{return (await readFile(join(runtime.directory,'automation-edge.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}catch(error){if(error.code==='ENOENT')return [];throw error}}
  const context=await browser.newContext({viewport:{width:1440,height:1000}})
  try{
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}])
   const page=await context.newPage();page.setDefaultTimeout(20000)
   await page.goto(`${runtime.origin}/projects/${owner.projectId}/workflow-settings?tab=rules`)
   await page.getByRole('button',{name:'Rules',exact:true}).click()
   await page.getByRole('heading',{name:'Event and hourly rules',exact:true}).waitFor()
   const definitions=[
    {name:'Route refunds',kind:'routing',actions:[],routing:{strategy:'named',user_id:owner.userId,skills:[]}},
    {name:'Tag VIP refunds',kind:'event',actions:[{type:'route'},{type:'tags',add:[tag.id],remove:[]}]},
    {name:'Set refund status',kind:'event',actions:[{type:'status',status_id:'pending'}]},
    {name:'Remind refund assignee',kind:'event',actions:[{type:'notify',kind:'assignee',message:'Refund reminder {{ticket.id}}'},{type:'notify',kind:'customer_update',message:'Refund update {{ticket.id}}'}]},
   ],rules=[]
   for(const [position,definition] of definitions.entries()){
    await page.getByRole('button',{name:'New rule',exact:true}).click()
    const form=page.locator('.workflow-form')
    await form.getByLabel('Name',{exact:true}).fill(definition.name)
    await form.getByLabel('Order',{exact:true}).fill(String(position))
    await form.getByLabel('Rule type',{exact:true}).selectOption(definition.kind)
    await form.getByLabel('When',{exact:true}).selectOption('changed')
    await form.getByRole('button',{name:'Add required condition',exact:true}).click()
    await form.getByLabel('Ticket field',{exact:true}).selectOption('priority')
    await form.getByLabel('Value',{exact:true}).selectOption('high')
    if(definition.routing){
     await form.getByLabel('Strategy',{exact:true}).selectOption('named')
     await form.getByLabel('Operator',{exact:true}).selectOption(owner.userId)
    }
    for(const [i,action] of definition.actions.entries()){
     await form.getByRole('button',{name:'Add action',exact:true}).click()
     await form.getByLabel(`Action ${i+1}`,{exact:true}).selectOption(action.type)
     if(action.type==='tags')await form.getByRole('group',{name:'Add tags',exact:true}).getByLabel('VIP refund',{exact:true}).check()
     if(action.type==='status')await form.getByLabel('Status',{exact:true}).selectOption('pending')
     if(action.type==='notify'){
      await form.getByLabel('Notify',{exact:true}).nth(i).selectOption(action.kind)
      await form.getByLabel('Notification message',{exact:true}).nth(i).fill(action.message)
     }
    }
    await form.getByRole('button',{name:'Save draft',exact:true}).click()
    const card=page.locator('article.workflow-item').filter({has:page.getByRole('heading',{name:`${position}. ${definition.name}`,exact:true})})
    await card.getByRole('button',{name:'Preview draft',exact:true}).waitFor()
    const stored=(await api('/workflow-rules')).rules.find(rule=>rule.draft.name===definition.name)
    const expected={...definition,position,event_kind:'changed',conditions:{all:[{field:'priority',op:'eq',value:'high'}],any:[]}}
    assert.deepEqual(stored.draft,expected,`${definition.name}: saved Settings definition`)
    assert.equal(stored.state,'draft');assert.equal(stored.version,0);assert.equal(stored.owner_id,owner.userId)
    const before=snapshot(),network=await edges()
    const response=page.waitForResponse(r=>r.url().endsWith(`/workflow-rules/${stored.id}/preview`))
    await card.getByRole('button',{name:'Preview draft',exact:true}).click()
    const preview=await (await response).json()
    assert.equal(preview.side_effects,false);assert.ok(preview.results.some(row=>row.conversation_id===historical&&row.matched))
    assert.deepEqual(snapshot(),before,`${definition.name}: preview writes zero ticket, notification or webhook rows`)
    assert.deepEqual(await edges(),network,`${definition.name}: preview makes zero external requests`)
    console.log('AUTOMATION-001 sandbox',definition.name,JSON.stringify({before:Object.fromEntries(Object.entries(before).map(([key,rows])=>[key,rows.length])),after:Object.fromEntries(Object.entries(snapshot()).map(([key,rows])=>[key,rows.length])),external_requests_before:network.length,external_requests_after:(await edges()).length}))
    page.once('dialog',dialog=>dialog.accept())
    await card.getByRole('button',{name:'Publish draft',exact:true}).click()
    await card.getByText(/Published version 1/).first().waitFor()
    const published=(await api('/workflow-rules')).rules.find(rule=>rule.id===stored.id)
    assert.equal(published.version,1);assert.equal(published.state,'published')
    assert.deepEqual(published.published,expected);assert.deepEqual(published.versions[0].definition,expected)
    assert.equal(published.versions[0].published_by,owner.userId)
    assert.deepEqual(snapshot(),before,'publishing never replays historical tickets')
    rules.push(published)
   }
   await page.reload()
   for(const rule of rules)await page.getByRole('heading',{name:`${rule.position}. ${rule.name}`,exact:true}).waitFor()
   const nonmatching=await create('normal'),unchanged=await get(nonmatching),matching=await create('high')
   const until=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}assert.fail('workflow did not settle')}
   const runs=async id=>(await api(`/workflow-runs?conversation_id=${id}`)).runs.filter(run=>rules.some(rule=>rule.id===run.rule_id))
   await until(async()=>{const rows=await runs(matching);return rows.length===3&&rows.every(run=>run.state==='complete')})
   const result=await get(matching)
   assert.equal(result.assigned_to,owner.userId);assert.equal(result.status_id,'pending');assert.ok(result.tags.some(row=>row.id===tag.id))
   const decision=(await api(`/conversations/${matching}/routing`)).decision
   assert.equal(decision.rule_id,rules[0].id);assert.equal(decision.version,1);assert.equal(decision.winner_id,owner.userId);assert.match(decision.explanation,/Route refunds/)
   for(const run of await runs(matching)){assert.equal(run.version,1);assert.equal(run.rule_name,rules.find(rule=>rule.id===run.rule_id).name);assert.ok(JSON.parse(run.explanation).stop_condition)}
   assert.deepEqual(await get(nonmatching),unchanged,'nonmatching ticket and its history stay unchanged')
   assert.deepEqual(await runs(nonmatching),[])
   assert.deepEqual((await edges()).filter(row=>row.host==='api.resend.com'&&row.body.text?.startsWith('Refund reminder')).map(row=>row.body.to).flat(),['lead@example.test'])
   assert.deepEqual((await edges()).filter(row=>row.host==='api.resend.com'&&row.body.text?.startsWith('Refund update')).map(row=>row.body.to).flat(),['requester@example.test'])
  }finally{await context.close()}
  passed=true
 }finally{await browser.close();await runtime.close(passed)}
 await durableAutomationOutcomes()
}
