import {randomUUID} from 'node:crypto'

/** Real widget, person reply/resolution and customer rating; no inserted rows. */
export async function protectedFeedback({request,origin,owner,allowedOrigin}){
 const json=async(path,{token,body,method=body===undefined?'GET':'POST',originHeader=origin}={})=>{
  const response=await request(origin+path,{method,headers:{Origin:originHeader,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  if(!response.ok)throw new Error('Native feedback fixture refused with HTTP '+response.status)
  return response.json()
 }
 const project=await json('/api/identity/projects/'+owner.projectId,{token:owner.token})
 const visitor=await json('/api/identity/widget/session',{originHeader:allowedOrigin,body:{widgetKey:project.widget_key,name:'Synthetic report customer'}})
 const conversation=await json('/api/conversations',{token:visitor.token,body:{projectId:owner.projectId}})
 await json(`/api/dashboard/projects/${owner.projectId}/conversations/${conversation.id}`,{token:owner.token,method:'PUT',body:{ai_id:null,agent_id:owner.userId}})
 const path=`/api/conversations/${conversation.id}/messages`
 await json(path,{token:visitor.token,body:{localId:randomUUID(),content:'Please check my support report.',expectedRevision:0}})
 const current=await json(path,{token:owner.token})
 await json(path,{token:owner.token,body:{localId:randomUUID(),content:'The synthetic report check is complete.',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId,resolve:true}})
 const resolved=await json(path,{token:visitor.token})
 await json(`/api/conversations/${conversation.id}/widget-events`,{token:visitor.token,body:{action:'rateResolution',data:{resolutionId:resolved.resolution.id,value:1,comment:'Synthetic protected identifier 321-54-6789.'}}})
 return conversation.id
}
