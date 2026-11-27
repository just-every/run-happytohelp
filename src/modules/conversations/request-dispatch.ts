import type {Env} from '../../platform/env'
import {demoMode} from '../../demo/mode'
import {overloadAnswer} from '../../platform/d1-overload'
import {dispatchDoor,dispatchedUrl} from './dispatch-door'

// Four requests do more work than a Worker request's CPU allowance holds on Workers Free (10 ms), the last two on an
// isolate's first request, when the application loads inside the request:
// - a message send: admission, then the workflow pass, assistant, notices and broadcasts its message earns;
// - a project's inbox list: a page of conversations with every relation the inbox shows, shaped for the browser;
// - a widget visitor's session (POST /api/identity/widget/session) and the conversation a visitor starts.
// The Worker entry hands each to a Durable Object, whose invocation has the Durable Object CPU allowance, and
// answers with what that object returns. The object runs the application's own route (dispatch-door.ts), so the
// request is authenticated, authorized and answered exactly as it is when the application is called directly.
// An object is named by the path's subject, or by a field of the JSON body (a body without it is answered here).
const dispatched:[method:string,path:RegExp,object:string,bodyField?:string][]=[
 ['POST',/^\/api\/conversations\/([^/]{1,200})\/messages$/,'send'],
 ['GET',/^\/api\/dashboard\/projects\/([^/]{1,200})\/conversations$/,'inbox'],
 ['POST',/^\/api\/identity\/widget\/session$/,'widget','widgetKey'],
 ['POST',/^\/api\/conversations$/,'start','projectId'],
]
async function bodyField(request:Request,field:string){
 const value=(await request.clone().json().catch(()=>null) as Record<string,unknown>|null)?.[field]
 return typeof value==='string'&&value.length>0&&value.length<=200?value:undefined
}

/** The object's answer to a dispatched request, or null for every other request. A demo visitor's copy already
 * runs inside a Durable Object, so its requests stay where they are. */
export async function dispatchRequest(request:Request,env:Env,path:string):Promise<Response|null>{
 if(demoMode(env))return null
 const route=dispatched.find(([method,pattern])=>request.method===method&&pattern.test(path))
 if(!route)return null
 const [,pattern,object,field]=route,subject=field?await bodyField(request,field):pattern.exec(path)![1]
 if(!subject)return null
 // The entry alone names the address the client asked for; a client's own copy of the header is replaced.
 const forwarded=new Request(dispatchDoor,request)
 forwarded.headers.set(dispatchedUrl,request.url)
 // An object that cannot be reached (it is reset while a release replaces its code) answers busy. A send that
 // had already committed is replayed, not repeated, when the client sends it again with the same local id.
 return env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(`${object}:${subject}`)).fetch(forwarded).catch(()=>{
  console.error('Durable Object unavailable for a dispatched request')
  const answer=overloadAnswer(request)
  return Response.json(answer.body,{status:answer.status,headers:{...answer.headers,'Cache-Control':'no-store'}})
 })
}
