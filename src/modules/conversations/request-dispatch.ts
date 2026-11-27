import type {Env} from '../../platform/env'
import {demoMode} from '../../demo/mode'
import {overloadAnswer} from '../../platform/d1-overload'
import {dispatchDoor,dispatchedUrl} from './dispatch-door'

// Two requests do more work than a Worker request's CPU allowance holds on Workers Free (10 ms):
// - a message send: admission, then the workflow pass, assistant, notices and broadcasts its message earns;
// - a project's inbox list: a page of conversations with every relation the inbox shows, shaped for the browser.
// The Worker entry hands each to a Durable Object, whose invocation has the Durable Object CPU allowance, and
// answers with what that object returns. The object runs the application's own route (dispatch-door.ts), so the
// request is authenticated, authorized and answered exactly as it is when the application is called directly.
const dispatched:[method:string,path:RegExp,object:string][]=[
 ['POST',/^\/api\/conversations\/([^/]{1,200})\/messages$/,'send'],
 ['GET',/^\/api\/dashboard\/projects\/([^/]{1,200})\/conversations$/,'inbox'],
]

/** The object's answer to a dispatched request, or null for every other request. A demo visitor's copy already
 * runs inside a Durable Object, so its requests stay where they are. */
export function dispatchRequest(request:Request,env:Env,path:string):Promise<Response>|null{
 if(demoMode(env))return null
 for(const [method,pattern,object] of dispatched){
  const subject=request.method===method?pattern.exec(path)?.[1]:undefined
  if(!subject)continue
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
 return null
}
