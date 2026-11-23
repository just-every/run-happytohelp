import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {strangerFixture} from '../stranger11-browser.mjs'

const target='desk-fixture/engineering'
const issue={id:901,number:17,state:'open',assignee:null,updated_at:'2026-10-23T08:00:00Z'}
const closed={...issue,state:'closed',updated_at:'2026-10-23T08:05:00Z'}

export default async request=>{
 const url=new URL(request.url),path='/repos/'+target+'/issues'
 assert.equal(url.origin,'https://api.github.com')
 assert.ok([path,path+'/17'].includes(url.pathname))
 return Response.json(request.method==='GET'?closed:issue)
}

export async function escalationDraftBrowser(){
 const f=await strangerFixture({vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outboundFixture:import.meta.url})
 const {origin,projectId,base,page,request}=f
 const release=Promise.withResolvers()
 let success=false
 try{
  const ticket=await f.ticket('Jordan Northstar'),escalations='/api/escalations/projects/'+projectId
  const webhookSecret='synthetic-engineering-webhook'
  await request(escalations+'/connections',{provider:'github',target,token:'synthetic-engineering-token',webhook_secret:webhookSecret})
  const escalation=escalations+'/conversations/'+ticket.id
  await request(escalation+'/links',{provider:'github',mode:'create',title:'Damaged order follow-up',message_ids:[],attachment_ids:[],request_id:'engineering-case'})
  const body=JSON.stringify({action:'closed',repository:{full_name:target},issue:closed})
  const webhook=await fetch(origin+'/api/escalations/webhooks/'+projectId+':github',{
   method:'POST',headers:{'Content-Type':'application/json','x-github-event':'issues','x-github-delivery':'engineering-closed',
    'x-hub-signature-256':'sha256='+createHmac('sha256',webhookSecret).update(body).digest('hex')},body,
  })
  assert.equal(webhook.status,200)
  const [draft]=(await request(escalation)).data.drafts
  await page.route(origin+base+'/conversations/'+ticket.id+'/macro-draft',async route=>{
   await release.promise
   await route.continue()
  })
  await page.goto(origin+'/projects/'+projectId+'/conversations/'+ticket.id+'?view=open')
  const panel=page.getByRole('button',{name:'Show conversation panel',exact:true})
  if(await panel.isVisible())await panel.click()
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  await page.getByRole('button',{name:/^Escalations/}).click()
  const review=page.getByRole('button',{name:'Review customer update',exact:true})
  await review.waitFor()
  const composer=page.getByRole('textbox',{name:'Reply to conversation'})
  assert.equal(await composer.isEnabled(),false,'draft restoration is still in flight')
  assert.equal(await review.isEnabled(),false,'an escalation cannot bypass draft restoration')
  release.resolve()
  await review.click()
  assert.equal(await composer.inputValue(),draft.content)
  const sent=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/drafts/'+draft.id+'/send'))
  await page.getByRole('button',{name:'Send',exact:true}).click()
  assert.equal((await sent).status(),200)
  await page.locator('.transcript-message-content').getByText(draft.content,{exact:true}).waitFor()
  success=true
 }finally{
  release.resolve()
  await f.close(success)
 }
}
