import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

export async function ticketFixture(options={}){
 const app=await startApp({...options,captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',INBOUND_EMAIL_TOKEN:'ticket-gateway',...options.bindings}})
 const w=await app.seedWorkspace('tickets'),foreign=await app.seedWorkspace('elsewhere')
 await app.presenceAwayOff(w.projectId);await app.presenceAwayOff(foreign.projectId)
 const base=`/api/dashboard/projects/${w.projectId}`
 const call=(path,body,role='owner',method)=>app.call(base+path,{token:w.tokens[role],...(body!==undefined?{body}:{}),...(method?{method}:{})})
 const ok=async(path,body,role='owner',method)=>{const result=await call(path,body,role,method);assert.ok(result.status>=200&&result.status<300,JSON.stringify(result.data));return result.data.data??result.data}
 const visitor=(await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,name:'Dana Whitfield',email:'dana.whitfield@example.test'},headers:{Origin:w.allowedOrigin}}))
 const create=async(index=0)=>{
  const c=await app.ok('/api/conversations',{body:{projectId:w.projectId,contactId:visitor.contactId},token:index===0?visitor.token:w.tokens.owner})
  await app.ok(`/api/conversations/${c.id}/messages`,{body:{localId:`question-${index}`,content:`Order TO-${48200+index}: the Ridgeline boot has a torn seam. Can you arrange a replacement?`,expectedRevision:0},token:visitor.token})
  return c.id
 }
 const get=id=>ok(`/conversations/${id}/ticket`)
 const patch=async(id,changes,role='owner')=>ok(`/conversations/${id}/ticket`,{expected_version:(await get(id)).ticket_version,...changes},role,'PATCH')
 let id
 try{id=await create()}catch(error){await app.close();throw error}
 return {app,w,foreign,base,call,ok,visitor,create,id,get,patch}
}
