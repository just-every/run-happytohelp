import assert from 'node:assert/strict'
import {startApp} from '../journeys/kit/app.mjs'

// Only external mail, DNS, and Turnstile are faked; all identities, D1 and admission are real.
export async function selfServiceFixture(){
 const mail=[],challenges=[]
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',INBOUND_EMAIL_TOKEN:'fixture-survey-signing-key-for-self-service',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-provider-key',EMAIL_FROM:'support@example.com',FORMS_TURNSTILE_SITE_KEY:'synthetic-site',FORMS_TURNSTILE_SECRET_KEY:'synthetic-secret'},outbound:async request=>{
  if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.com.'}]})
  if(request.url==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){const body=new URLSearchParams(await request.text());challenges.push(body);return Response.json({success:['valid-challenge','wrong-site'].includes(body.get('response')),hostname:body.get('response')==='wrong-site'?'foreign.example':'app.example'})}
  if(request.url==='https://api.resend.com/emails'){const body=await request.json();mail.push(body);return Response.json({id:'message-'+mail.length})}
  throw new Error('Unexpected provider request '+request.url)
 }})
 const workspace=await app.seedWorkspace('self-service'),foreign=await app.seedWorkspace('self-service-foreign'),p=workspace.projectId,owner={token:workspace.tokens.owner},admin=`/api/forms/projects/${p}/forms`,api=`/api/forms/${p}`
 await app.db.prepare("INSERT INTO email_settings VALUES(?,'Northstar Support','support@example.com','help@example.com',1,1)").bind(p).run()
 const field=async body=>(await app.ok(`/api/management/projects/${p}/ticket-fields`,{...owner,body})).data
 const reason=await field({name:'Reason',type:'dropdown',options:['question','refund']}),order=await field({name:'Order number',type:'regex',validation:{pattern:'^NS-[0-9]+$'}}),internal=await field({name:'Private risk score',type:'number',read_roles:['owner'],write_roles:['owner']})
 const config={title:'Order problem',description:'Tell us what happened to your Northstar order.',locale:'en',enabled:true,fields:[{fieldId:reason.id,required:true},{fieldId:order.id,required:true,condition:{fieldId:reason.id,operator:'equals',value:'refund'}}],translations:{es:{title:'Problema con un pedido',fields:{subject:{label:'Asunto'},message:{label:'Mensaje'},[reason.id]:{label:'Motivo',options:{refund:'Reembolso',question:'Pregunta'}},[order.id]:{label:'Número de pedido'}}}}}
 const form=(await app.ok(admin,{...owner,body:config})).data
 const valid={subject:'Refund for a duplicate charge',message:'I was charged twice for my Northstar subscription. Please help.',fields:{[reason.id]:'refund',[order.id]:'NS-10482'},turnstileToken:'valid-challenge',localId:'request-order-10482'}
 const signin=async(email,returnTo)=>{
  const before=mail.length,response=await app.call(`/api/portal/${p}/access/request`,{body:{email,returnTo},headers:{Origin:'https://app.example'},status:202});assert.equal(response.data.accepted,true)
  const delivered=mail.slice(before).find(entry=>[].concat(entry.to).includes(email));assert.ok(delivered,'customer receives email sign-in')
  const url=new URL(delivered.text.match(/https:\/\/app\.example\/api\/portal\/\S+/)[0]),verification=await app.request(url.pathname+url.search)
  assert.equal(verification.status,303,await verification.clone().text());const cookie=verification.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^h2h_portal=/)
  return {headers:{Cookie:cookie,Origin:'https://app.example'},path:url.pathname+url.search,location:verification.headers.get('location')}
 }
 return {app,mail,challenges,workspace,foreign,p,owner,admin,api,reason,order,internal,config,form,valid,signin}
}
