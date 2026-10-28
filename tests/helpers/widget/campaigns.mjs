import assert from 'node:assert/strict'

// One consenting visit sees an offer while an active support team is available.
// Its show/open/reporting and native resolution stay attached to that visit.
export async function campaignsJourney({app,workspace:w,contact,conversation,owner,socketTo}){
 const p=w.projectId,endpoint=`/api/management/projects/${p}/widget-campaigns`
 await app.call(`/api/management/projects/${p}/availability`,{token:owner,method:'PUT',body:{is_presence_away_enabled:true},status:200})
 const availability=async()=>(await app.call(`/api/widget/settings?widgetKey=${w.widgetKey}`,{headers:{Origin:w.allowedOrigin},status:200})).data.availability
 assert.equal((await availability()).available,false)
 const team=await socketTo(`/api/projects/${p}/socket`,{Cookie:`h2h_session=${owner}`,Origin:'https://app.example'});assert.equal(team.status,101)
 team.socket.send(JSON.stringify({type:'presence',idleMs:0}))
 await app.until(async()=>(await availability()).available,{message:'active support team available'})
 const body={name:'Checkout help',enabled:true,sender:'Support',brand:'Returns desk',message:'Need help checking out?',pathPrefix:'/checkout',trigger:{type:'time',seconds:20},audience:'all',delaySeconds:20,dailyCap:1,timezone:'UTC',quietHours:{enabled:false,start:20,end:8},revision:0}
 const saved=(await app.call(endpoint+'/checkout-help',{token:owner,method:'PUT',body,status:200})).data
 assert.equal((await app.call(endpoint+'/checkout-help',{token:w.tokens.operator,method:'PUT',body:{...body,revision:saved.revision}})).status,403)
 const event=(action,data,status=200)=>app.call(`/api/conversations/${conversation.id}/widget-events`,{token:contact.token,body:{action,data},status})
 await app.call(`/api/management/projects/${p}/settings`,{token:owner,method:'PUT',body:{is_contact_tracking_enabled:true,proactive_help_enabled:true},status:200})
 const visit={path:'/checkout',elapsedSeconds:20,scrollPercent:50,exitIntent:false,visitId:crypto.randomUUID(),cartValue:100}
 assert.equal((await event('campaignEvaluate',visit)).data.offer,null)
 await event('contextConsent',{consent:true})
 assert.equal((await event('campaignEvaluate',{...visit,path:'/account'})).data.offer,null)
 const attempts=await Promise.all([event('campaignEvaluate',visit),event('campaignEvaluate',visit)])
 const offers=attempts.map(result=>result.data.offer).filter(Boolean);assert.equal(offers.length,1)
 const offer=offers[0]
 await event('campaignEvent',{id:offer.id,event:'show'});await event('campaignEvent',{id:offer.id,event:'show'});await event('campaignEvent',{id:offer.id,event:'open'})
 const report=async()=>(await app.ok(`/api/dashboard/projects/${p}/reports?period=30`,{token:owner})).campaigns.find(row=>row.id===saved.id)
 assert.equal((await report()).impressions,1);assert.equal((await report()).opens,1)
 assert.equal((await report()).conversations,0,'an opened offer never manufactures a customer request')
 return async()=>{
  try{
   assert.equal((await report()).conversations,1,'the actual native customer message receives attribution')
   await app.ok(`/api/dashboard/projects/${p}/conversations/${conversation.id}`,{token:owner,method:'PUT',body:{resolved:true}})
   assert.equal((await report()).resolutions,1)
   await event('contextConsent',{consent:false});assert.equal((await event('campaignEvaluate',visit)).data.offer,null)
   assert.equal((await report()).impressions,0,'withdrawn campaign attribution disappears from reports')
   team.socket.send(JSON.stringify({type:'presence',idleMs:16*60_000}))
   await app.until(async()=>!(await availability()).available,{timeout:20000,message:'idle support team away'})
   assert.equal((await app.call(`/api/management/projects/${p}/availability`,{token:w.tokens.operator,method:'PUT',body:{is_presence_away_enabled:false}})).status,403)
  }finally{team.socket.close()}
 }
}
