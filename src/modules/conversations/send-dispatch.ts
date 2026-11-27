import type {Env} from '../../platform/env'
import {demoMode} from '../../demo/mode'
import {overloadAnswer} from '../../platform/d1-overload'
import {sendDoor,sentUrl} from './send-door'

// A message send is the conversation's heaviest request: admission, then the workflow pass, assistant, notices
// and broadcasts its message earns. The Worker entry hands it to the conversation's own Durable Object, whose
// invocation has the Durable Object CPU allowance instead of the request's (10 ms on Workers Free), and answers
// with what that object returns. The object runs the application's own route (send-door.ts), so the send is
// admitted, authorized and followed up exactly as it is when the application is called directly.
const sendPath=/^\/api\/conversations\/([^/]{1,200})\/messages$/

/** The conversation object's answer to a message send, or null for every other request. A demo visitor's copy
 * already runs inside a Durable Object, so its sends stay where they are. */
export function dispatchSend(request:Request,env:Env,path:string):Promise<Response>|null{
 if(request.method!=='POST'||demoMode(env))return null
 const conversation=sendPath.exec(path)?.[1]
 if(!conversation)return null
 // The entry alone names the address the client asked for; a client's own copy of the header is replaced.
 const forwarded=new Request(sendDoor,request)
 forwarded.headers.set(sentUrl,request.url)
 // An object that cannot be reached (it is reset while a release replaces its code) answers busy. A send that had
 // already committed is replayed, not repeated, when the client sends it again with the same local id.
 return env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(`send:${conversation}`)).fetch(forwarded).catch(()=>{
  console.error('Conversation object unavailable for a message send')
  const answer=overloadAnswer(request)
  return Response.json(answer.body,{status:answer.status,headers:{...answer.headers,'Cache-Control':'no-store'}})
 })
}
