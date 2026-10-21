import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
export async function workflowFixture(){
 const initial=Date.parse('2026-11-25T21:00:00Z'),app=await startApp({captureQueue:true,outbound:async request=>{if(new URL(request.url).hostname==='api.resend.com')throw new TypeError('Connection reset after request body was received');throw new Error('Unexpected external call '+request.url)},bindings:{APP_ORIGIN:'https://app.example',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',INBOUND_EMAIL_TOKEN:'workflow-gateway',H2H_WORKFLOW_NOW:String(initial)}})
 if(process.env.H2H_WORKFLOW_TRACE)console.log('fixture started')
 const w=await app.seedWorkspace('workflow'),other=await app.seedWorkspace('other-workflow'),base=`/api/dashboard/projects/${w.projectId}`
 await app.presenceAwayOff(w.projectId);await app.presenceAwayOff(other.projectId)
 const call=(path,body,method,role='owner',headers={})=>{if(process.env.H2H_WORKFLOW_TRACE)console.log('workflow',method??(body===undefined?'GET':'POST'),path);return app.call(base+path,{token:w.tokens[role],...(body===undefined?{}:{body}),...(method?{method}:{}),headers})}
 const ok=async(path,body,method,role='owner')=>{const result=await call(path,body,method,role);assert.ok(result.status>=200&&result.status<300,`${path}: ${result.status} ${JSON.stringify(result.data)}`);return result.data.data??result.data}
 const customer=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,name:'Riley Bennett',email:'riley@example.test'},headers:{Origin:w.allowedOrigin}})
 let seq=0,creations=0
 const get=id=>ok(`/conversations/${id}/ticket`)
 const send=async(id,content='The replacement has not arrived.',token=customer.token)=>{const t=await get(id);return app.ok(`/api/conversations/${id}/messages`,{token,body:{localId:`workflow-message-${++seq}`,content,expectedRevision:t.revision,expectedLastMessageId:t.last_message_id}})}
 const create=async(content='Please arrange a replacement for order TO-49312.')=>{const ticket=await app.ok('/api/conversations',{token:creations++?w.tokens.owner:customer.token,body:{projectId:w.projectId,contactId:customer.contactId}});await send(ticket.id,content);return ticket.id}
 const patch=async(id,changes)=>ok(`/conversations/${id}/ticket`,{expected_version:(await get(id)).ticket_version,...changes},'PATCH')
 const clock=async value=>{const now=typeof value==='number'?value:Date.parse(value);if(process.env.H2H_WORKFLOW_TRACE)console.log('clock',new Date(now).toISOString());await app.configure({H2H_WORKFLOW_NOW:String(now)});if(process.env.H2H_WORKFLOW_TRACE)console.log('clock ready');return now}
 const publish=async d=>{const {rule}=await ok('/workflow-rules',d);return (await ok(`/workflow-rules/${rule.id}/publish`,{})).rule}
 return {app,w,other,base,call,ok,customer,get,send,create,patch,clock,publish,initial}
}
