import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'

// PUSH-002's public route workflow in the native conversation: the promise is
// visible, accepted responsibility survives a fresh browser context, and the
// honest pre-due update can be reviewed as a draft without publishing it.
export async function obligationsBrowserJourney({runtime,browser,shot}){
 const origin=runtime.origin,tenant=await runtime.seedTenant({name:'Follow-up support',email:'followup-owner@example.test',allowedOrigin:origin})
 const call=async(path,{body,token=tenant.token,method=body===undefined?'GET':'POST'}={})=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  assert.ok(response.ok,path+': '+response.status);return response.json()
 }
 const project=await call(`/api/identity/projects/${tenant.projectId}`),customer=await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key,name:'Export customer'}})
 const conversation=await call('/api/conversations',{token:customer.token,body:{projectId:tenant.projectId}}),messages=`/api/conversations/${conversation.id}/messages`
 let current=await call(messages,{token:customer.token})
 await call(messages,{token:customer.token,body:{localId:randomUUID(),content:'Please keep me updated about the export.',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId}})
 current=await call(messages,{token:customer.token})
 const promise='I will send an export update by tomorrow.'
 const sent=await call(messages,{body:{localId:randomUUID(),content:promise,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId}})
 assert.equal(sent.accepted,true)
 const base=`/api/ai-support/projects/${tenant.projectId}/conversations/${conversation.id}/obligations`,dueAt=Date.now()+3600000
 const proposal=await call(base,{body:{messageId:sent.message.id,quote:'send an export update by tomorrow',ownerId:tenant.userId,dueAt,stopCondition:'The customer receives an honest update.'}})
 await call(base+'/'+proposal.id+'/accept',{body:{version:1,ownerId:tenant.userId,dueAt}})
 const captures=[]
 for(const width of [1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  try{
   await context.addCookies([{name:'h2h_session',value:tenant.token,url:origin}])
   await page.goto(`${origin}/projects/${tenant.projectId}/conversations/${conversation.id}`)
   await page.getByText(promise,{exact:true}).first().waitFor()
   const record=(await call(base)).obligations[0]
   assert.equal(record.id,proposal.id);assert.equal(record.state,'open');assert.equal(record.accepted_by,tenant.userId);assert.equal(record.due_at,dueAt);assert.ok(Date.now()<dueAt)
   assert.equal(record.draft.requiresHumanSend,true);assert.match(record.draft.content,/do not yet have current evidence/)
   const before=(await call(messages,{token:customer.token})).messages.length
   await page.getByLabel('Reply to conversation',{exact:true}).fill(record.draft.content)
   assert.equal((await call(messages,{token:customer.token})).messages.length,before,'reviewing the generated update never sends it')
   assert.deepEqual(errors,[])
   const file=`followup-promise-draft-${width}.png`;await capture(page,shot,file);captures.push({file,width})
  }finally{await context.close()}
 }
 await writeFile(shot('followup-promise-receipt.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),passed:true,obligationId:proposal.id,dueBeforeDraft:true,captures},null,2)+'\n')
}

async function capture(page,shot,file){for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:shot(file.replace('1440',String(width))),fullPage:true})}await page.setViewportSize({width:1440,height:900})}
