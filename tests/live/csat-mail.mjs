import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {startApp} from '../journeys/kit/app.mjs'

// Explicit held-key qualification. Only this approved mailbox is contacted.
// Nothing retries an uncertain provider submission; receipt polling is read-only.
for(const name of ['EMAIL_API_KEY','EMAIL_FROM','MAILBOX_RECEIPT_URL'])assert.ok(process.env[name],name+' required')
const recipient='qa-inbox@runeditrun.com',signing=randomBytes(32).toString('hex'),sent=[]
const app=await startApp({captureQueue:true,bindings:{EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:process.env.EMAIL_API_KEY,EMAIL_FROM:process.env.EMAIL_FROM,INBOUND_EMAIL_TOKEN:signing,APP_ORIGIN:'https://app.example'},outbound:async request=>{
 assert.equal(new URL(request.url).origin,'https://api.sendgrid.com')
 const body=await request.clone().text(),payload=JSON.parse(body)
 assert.deepEqual(payload.personalizations.flatMap(value=>value.to.map(to=>to.email)),[recipient])
 if(payload.custom_args?.rer_delivery_id?.startsWith('csat:'))sent.push(payload)
 try{
  // Rebuild the HTTP proxy boundary: Node owns hop headers and body length.
  const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','expect','content-length','host'])
  const headers=Object.fromEntries([...request.headers].filter(([name])=>!hop.has(name.toLowerCase())))
  const response=await fetch(request.url,{method:request.method,headers,body,signal:AbortSignal.timeout(15000)})
  console.log(JSON.stringify({diagnostic:'provider response',survey:payload.custom_args?.rer_delivery_id?.startsWith('csat:')??false,status:response.status,hasReceipt:response.headers.has('x-message-id')}))
  return response
 }catch(error){
  console.error(JSON.stringify({diagnostic:'provider transport',name:error.name,code:/^[A-Z0-9_]{1,80}$/.test(error.cause?.code??'')?error.cause.code:'other',stage:error.message==='fetch failed'?'fetch-failed':error.message?.includes('duplex')?'duplex':error.message?.includes('Header')?'headers':error.message?.includes('body')?'body':'request-construction'}));throw Error('Provider transport failed')
 }
}})
try{
 const w=await app.seedWorkspace('live-csat-mail'),token=w.tokens.owner,p=w.projectId,endpoint=`/api/outcomes/projects/${p}`
 await app.ok(endpoint+'/settings',{token,method:'PUT',body:{enabled:true,widgetEnabled:true,scale:'five',delayMinutes:0,expiresDays:1,locale:'en'}})
 const project=await app.first('SELECT verification_secret FROM projects WHERE id=?',p)
 const visitor=await app.ok('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,identifier:recipient,email:recipient,name:'Approved QA mailbox',contact_hash:createHmac('sha256',project.verification_secret).update(recipient).digest('hex')}})
 const conversation=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:p}})
 await app.ok(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,body:{localId:'live-csat-question',content:'Please confirm my replacement parcel.',expectedRevision:0}})
 await app.ok(`/api/dashboard/projects/${p}/conversations/${conversation.id}`,{token,method:'PUT',body:{resolved:true}})
 await app.scheduled()
 const survey=await app.first('SELECT * FROM csat_surveys WHERE conversation_id=?',conversation.id)
 console.log(JSON.stringify({diagnostic:'survey delivery',state:survey?.state??'not scheduled',attempts:sent.length,delivery:survey?await app.first('SELECT state,error FROM email_deliveries WHERE id=?','csat:'+survey.id):null}));assert.equal(survey?.state,'sent','provider acceptance must be known before checking the mailbox')
 assert.equal(sent.length,1)
 const text=sent[0].content.find(part=>part.type==='text/plain').value
 const link=text.match(/https:\/\/app\.example\/api\/outcomes\/surveys\/\S+/)?.[0];assert.ok(link)
 let receipt
 const deadline=Date.now()+180000
 while(Date.now()<deadline){
  const response=await fetch(process.env.MAILBOX_RECEIPT_URL,{signal:AbortSignal.timeout(10000)})
  assert.ok(response.ok,'approved mailbox receipt endpoint must be available')
  const body=await response.json();assert.ok(Array.isArray(body.receipts))
  receipt=body.receipts.find(row=>typeof row.excerpt==='string'&&row.excerpt.includes(survey.id)&&row.auth?.dmarc==='pass')
  if(receipt)break
  await new Promise(resolve=>setTimeout(resolve,5000))
 }
 assert.ok(receipt,'unique survey invitation must be received with DMARC pass')
 const path=new URL(link).pathname,form=await app.request(path)
 assert.equal(form.status,200);await form.text()
 const submitted=await app.request(path,{body:{score:2,recovery:'not_recovered',comment:'The parcel still needs follow-up'}})
 assert.equal(submitted.status,200)
 const edit=(await submitted.text()).match(/href="(\/api\/outcomes\/surveys\/[^"/]+)"/)?.[1];assert.ok(edit)
 await app.ok(edit,{body:{score:5,recovery:'recovered',comment:'The replacement has arrived'}})
 const report=await app.ok(endpoint+'/results',{token})
 assert.equal(report.summary.rated,1);assert.equal(report.results[0].response.channel,'email');assert.equal(report.results[0].response.recovery,'recovered')
 await app.scheduled();assert.equal(sent.length,1,'rerating never sends another invitation')
 await app.ok(`/api/dashboard/projects/${p}/conversations/${conversation.id}`,{token,method:'PUT',body:{resolved:false}})
 const expired=await app.request(edit);assert.equal(expired.status,410);await expired.text()
 await app.ok(`/api/management/projects/${p}/contacts/${visitor.contactId}/erase`,{token,body:{}})
 assert.equal((await app.first('SELECT count(*) n FROM csat_response_history WHERE project_id=? AND comment<>?',p,'')).n,0)
 console.log(JSON.stringify({proof:'OUTCOMES-002 live SendGrid receipt',mailbox:'approved QA mailbox',dmarc:'pass',invitations:1,latestResponses:1,rerated:true,reopenRevoked:true,erasedComments:true,qualification:'real delivery and mailbox receipt; response through isolated native public routes, not hosted messaging cutover'}))
}catch(error){
 // Never print transport URLs, signed response links, provider payloads or keys.
 console.error('Live CSAT mail qualification failed: '+(error instanceof assert.AssertionError?error.message.split('\n')[0]:'provider or receipt operation failed'))
 process.exitCode=1
}finally{await app.close()}
