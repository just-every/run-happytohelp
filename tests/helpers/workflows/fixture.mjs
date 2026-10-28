import assert from 'node:assert/strict'
export async function workflowFixture(shared){
 const {app,w,foreign:other,visitor:customer}=shared,slack=shared.network.slack
 const initial=Date.parse('2026-11-25T21:00:00Z')
 if(process.env.H2H_WORKFLOW_TRACE)console.log('fixture started')
 await app.configure({H2H_WORKFLOW_NOW:String(initial),EMAIL_PROVIDER:'development',EMAIL_API_KEY:undefined})
 const base=`/api/dashboard/projects/${w.projectId}`
 // The lead changes availability for the existing support team. Away replies
 // later in this lifecycle must be system messages, never teammate replies.
 await app.ok(`/api/management/projects/${w.projectId}/availability`,{token:w.tokens.owner,method:'PUT',body:{is_availability_schedule_enabled:false,is_presence_away_enabled:true}})
 const call=(path,body,method,role='owner',headers={})=>{if(process.env.H2H_WORKFLOW_TRACE)console.log('workflow',method??(body===undefined?'GET':'POST'),path);return app.call(base+path,{token:w.tokens[role],...(body===undefined?{}:{body}),...(method?{method}:{}),headers})}
 const ok=async(path,body,method,role='owner')=>{const result=await call(path,body,method,role);assert.ok(result.status>=200&&result.status<300,`${path}: ${result.status} ${JSON.stringify(result.data)}`);return result.data.data??result.data}
 let seq=0
 const get=id=>ok(`/conversations/${id}/ticket`)
 const send=async(id,content='The replacement has not arrived.',token=customer.token)=>{const t=await get(id);return app.ok(`/api/conversations/${id}/messages`,{token,body:{localId:`workflow-message-${++seq}`,content,expectedRevision:t.revision,expectedLastMessageId:t.last_message_id}})}
 const create=async(content='Please arrange a replacement for order TO-49312.')=>{const ticket=await app.ok('/api/conversations',{token:w.tokens.owner,body:{projectId:w.projectId,contactId:customer.contactId}});await send(ticket.id,content);return ticket.id}
 const patch=async(id,changes)=>ok(`/conversations/${id}/ticket`,{expected_version:(await get(id)).ticket_version,...changes},'PATCH')
 const clock=async value=>{const now=typeof value==='number'?value:Date.parse(value);if(process.env.H2H_WORKFLOW_TRACE)console.log('clock',new Date(now).toISOString());await app.configure({H2H_WORKFLOW_NOW:String(now)});if(process.env.H2H_WORKFLOW_TRACE)console.log('clock ready');return now}
 const publish=async d=>{const {rule}=await ok('/workflow-rules',d);return (await ok(`/workflow-rules/${rule.id}/publish`,{})).rule}
 return {slack,app,w,other,base,call,ok,customer,get,send,create,patch,clock,publish,initial}
}
