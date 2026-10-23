import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {viewports} from '../../journeys/kit/browser.mjs'

export async function timeAuthorityBrowser({runtime,browser,shot}){
 const origin=runtime.origin,tenant=await runtime.seedTenant({name:'Bounded task authority',email:'bounded@example.test',allowedOrigin:origin})
 const context=await browser.newContext(),page=await context.newPage(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 try{
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:origin}])
  const api=async(path,data,token=tenant.token,method=data===undefined?'GET':'POST')=>{
   const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(data===undefined?{}:{body:JSON.stringify(data)})})
   const result=await response.json();assert.ok(response.ok,JSON.stringify({status:response.status,result}));return result
  }
  const pairing=await api(`/api/projects/${tenant.projectId}/local-agents/pairings`,{})
  const computer=(await api('/api/local-agents/pair',{code:pairing.data.code,name:'Time-bound computer',provider:'codex',capabilities:['terminal']})).data
  const project=await api('/api/identity/projects/'+tenant.projectId)
  for(const viewport of Object.values(viewports)){
   await page.setViewportSize(viewport)
   const visitor=await api('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Bounded task customer'})
   const conversation=await api('/api/conversations',{projectId:tenant.projectId},visitor.token)
   await api(`/api/conversations/${conversation.id}/messages`,{localId:randomUUID(),content:'Please investigate this product failure read-only.',expectedRevision:0},visitor.token)
   const open=async()=>{await page.goto(`${origin}/projects/${tenant.projectId}/conversations/${conversation.id}`);await page.locator('.conversation-assistant-toggle').waitFor();const toggle=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await toggle.isVisible())await toggle.click();await page.getByRole('tab',{name:'Delegate',exact:true}).click()}
   await open()
   const limit=page.getByLabel('Task authority (minutes)',{exact:true});await limit.waitFor();assert.equal(await limit.inputValue(),'15')
   assert.equal(await limit.getAttribute('min'),'1');assert.equal(await limit.getAttribute('max'),'15')
   await limit.fill('1');await page.getByLabel('Instructions',{exact:true}).fill('Read only; report evidence and propose any change for approval.')
   await page.screenshot({path:shot(`time-authority-form-${viewport.width}.png`),fullPage:true})
   const path=`/api/projects/${tenant.projectId}/conversations/${conversation.id}/delegations`
   const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST'),page.getByRole('button',{name:/^(Send|Queue) task$/}).click()])
   assert.equal(response.status(),200);const job=(await response.json()).data
   assert.equal(job.authority.granted_by,tenant.userId);assert.equal(job.authority.minutes,1);assert.equal(job.authority.expires_at-job.authority.granted_at,60000)
   await page.locator('.delegation-job.is-queued').waitFor();await page.getByText(/Authority expires/).waitFor()
   await page.screenshot({path:shot(`time-authority-granted-${viewport.width}.png`),fullPage:true})
   await runtime.execute(`UPDATE local_events SET payload=json_set(payload,'$.expires_at',0) WHERE job_id='${job.id}' AND event_id='authority';`)
   assert.equal((await api('/api/local-agents/claim',{claim_id:randomUUID()},computer.token)).data,null)
   await open();await page.getByText('Task authority expired · local outcome unconfirmed',{exact:true}).waitFor()
   assert.equal((await api(path)).data[0].status,'cancelled')
   await page.screenshot({path:shot(`time-authority-expired-${viewport.width}.png`),fullPage:true})
   assert.equal((await api(`/api/conversations/${conversation.id}/messages`,undefined,visitor.token)).messages.filter(m=>m.actor_role!=='contact').length,0)
  }
  assert.deepEqual(errors,[])
 }finally{await context.close()}
}
