import assert from 'node:assert/strict'
import {contextApp} from '../context/app.mjs'
import {managedEdge,mime} from '../email/rer-edge.mjs'
import {managedInstallation} from '../email/rer-mail.mjs'
import {openaiStream} from '../openai-stream.mjs'

export async function proactiveReplyModes(){
 const c=await contextApp(),{app,ai,p,workspace}=c,base=`/api/management/projects/${p}`
 const setMode=ai_reply_mode=>app.call(base+'/ai',{token:workspace.tokens.owner,method:'PUT',body:{ai_reply_mode},status:200})
 const widgetSettings=async()=>(await app.call('/api/widget/settings?widgetKey='+workspace.widgetKey,{headers:{Origin:workspace.allowedOrigin},status:200})).data
 const transcript=async v=>(await app.call(`/api/conversations/${v.conversationId}/messages`,{token:v.token,status:200})).data.messages
 const activity=prefix=>Array.from({length:7},(_,i)=>({localId:prefix+i,action:'Payment declined at checkout '+i}))
 try{
  const v=await c.visitor('Draft visitor')
  await v.widget('contextConsent',{consent:true},200)
  for(const mode of ['draft','off']){
   await setMode(mode)
   assert.equal((await widgetSettings()).proactiveHelpEnabled,false,mode+' disables proactive help at the public widget settings door')
   await v.widget('collector',activity(mode),200)
   await app.drainJobs()
   assert.deepEqual((await v.widget('insights',{},200)).data.insights,[])
   assert.equal(ai.calls.length,0);assert.deepEqual(await transcript(v),[],mode+' sends no proactive widget message')
  }
  await setMode('auto');assert.equal((await widgetSettings()).proactiveHelpEnabled,true)
  const automatic=await c.visitor('Automatic visitor')
  await automatic.widget('contextConsent',{consent:true},200)
  ai.answer=(name,body)=>{
   const id=JSON.stringify(body).match(/action:[a-z0-9-]+/)?.[0]
   return name==='context_analysis'?{decision:'insight',help_type:'support',evidence_ids:[id],help:'Help with payment'}:name==='context_insight'?{content:'Would you like help with your payment?',buttons:[{text:'Yes, help me',action:'send'},{text:'Dismiss',action:'close'}],loading:null,evidence_ids:[id]}:{summary:'Payment errors were observed.'}
  }
  const collected=await automatic.widget('collector',activity('auto'),200);assert.ok(collected.data.job.id)
  await app.drainJobs()
  const [offer]=(await automatic.widget('insights',{},200)).data.insights;assert.ok(offer?.id,'auto delivers a proactive offer')
  const accepted=await automatic.widget('useInsight',{insight_id:offer.id,text:'Yes, help me',local_id:'auto-use',ai_message:{local_id:'auto-use-ai'}},200)
  assert.equal(accepted.data.messages.length,2)
  assert.equal((await transcript(automatic)).find(message=>message.actor_role==='ai')?.content,'Would you like help with your payment?')
 }finally{await c.close()}
}

export async function replyModeMailHolds(){
 const edge=managedEdge(),relay=edge.outbound
 let hold=false
 edge.outbound=async(request,entry)=>{
  if(new URL(request.url).hostname==='api.openai.com')return openaiStream('Your refund is being reviewed.',{input_tokens:5,output_tokens:3})
  if(hold&&request.method==='POST'&&new URL(request.url).pathname.endsWith('/send'))return Response.json({code:'mail_credential_revoked'},{status:401})
  return relay(request,entry)
 }
 const i=await managedInstallation('mode-holds',{edge,bindings:{OPENAI_API_KEY:'synthetic-hh-1'}}),{app,owner}=i,base=`/api/management/projects/${owner.projectId}`
 try{
  const assistant=(await app.ok(base+'/ais',{token:owner.token,body:{name:'Refund helper',role:'support',prompt:'Help briefly',model:'gpt-5.6-luna'}})).data
  await app.ok(base+'/ai',{token:owner.token,method:'PUT',body:{default_visitor_ai_id:'-',default_verified_user_ai_id:'-'}})
  const received=await i.ingress(mime());assert.equal(received.status,200)
  await app.drainJobs()
  await app.ok(base+'/ai',{token:owner.token,method:'PUT',body:{default_visitor_ai_id:assistant.id,default_verified_user_ai_id:assistant.id}})
  hold=true
  await app.ok(`/api/dashboard/projects/${owner.projectId}/conversations/${received.data.conversationId}/actions`,{token:owner.token,body:{action:'assignAi',data:{ai_id:assistant.id}}})
  await app.drainJobs()
  const path=`/api/conversations/${received.data.conversationId}/messages`
  const messages=(await app.ok(path,{token:owner.token})).messages,answer=messages.find(message=>message.actor_role==='ai')
  assert.ok(answer?.id,'a real auto-mode generation admitted the AI message')
  const id=`message:${answer.id}:notification`
  await app.until(async()=>{const row=await app.first('SELECT state,error FROM email_deliveries WHERE id=?',id);return row?.state==='sending'&&row.error},{message:'AI notification held'})
  const audit=async()=>(await app.ok(base+'/audit?category=integration&limit=200',{token:owner.token})).data.filter(row=>row.target_id===id&&row.action==='email.ai_withheld')
  assert.equal((await audit()).length,0)
  await app.ok(base+'/ai',{token:owner.token,method:'PUT',body:{ai_reply_mode:'draft'}})
  await app.scheduled()
  const delivery=await app.first('SELECT state,error FROM email_deliveries WHERE id=?',id)
  assert.equal(delivery.state,'failed');assert.match(delivery.error,/drafts or off/)
  const events=await audit();assert.equal(events.length,1)
  assert.equal(events[0].actor_type,'system');assert.equal(events[0].source,'system');assert.equal(events[0].outcome,'refused')
  assert.deepEqual(events[0].detail,{reason:'ai_reply_mode'})
  const safe=JSON.stringify(events)
  for(const forbidden of [app.bindings.MAIL_API_KEY,'customer@example.test','Your refund is being reviewed.'])assert.ok(!safe.includes(forbidden),'audit contains no credentials, recipient or message content')
  await app.scheduled();assert.equal((await audit()).length,1,'replay does not duplicate the terminal audit event')
 }finally{await i.close()}
}
