import type {Env} from '../../platform/env'
import {demoMode} from '../../demo/mode'
import {overloadAnswer} from '../../platform/d1-overload'
import {dispatchDoor,dispatchedUrl,renderDoor} from './dispatch-door'

// A message send, inbox reads and first loads of the app or Start renderer can exceed Workers Free's
// CPU allowance. The existing object runs the original handler with the caller's request and authority.
// An object is named by the path's subject, or by a field of the JSON body (a body without it is answered here).
const dispatched:[method:string,path:RegExp,object:string,bodyField?:string,door?:string][]=[
 ['POST',/^\/api\/conversations\/([^/]{1,200})\/messages$/,'send'],
 ['GET',/^\/api\/dashboard\/(conversations)$/,'inbox-global'],
 ['GET',/^\/api\/dashboard\/projects\/([^/]{1,200})\/conversations(?:\/counts|\/[^/]{1,200}\/(?:collaboration|macro-draft|workflows))?$/,'inbox'],
 ['GET',/^\/api\/dashboard\/projects\/([^/]{1,200})\/reports(?:\/team)?$/,'reports'],
 ['GET',/^\/api\/escalations\/projects\/([^/]{1,200})\/connections$/,'inbox'],
 ['GET',/^\/api\/projects\/([^/]{1,200})\/socket$/,'project-socket'],
 ['GET',/^\/api\/management\/(bootstrap)$/,'workspace'],
 ['GET',/^\/api\/identity\/(session)$/,'identity'],
 ['GET',/^\/api\/management\/projects\/([^/]{1,200})\/(?:activation|widget-addresses)$/,'settings'],
 ['POST',/^\/api\/management\/projects\/([^/]{1,200})\/activation\/check$/,'settings'],
 ['POST',/^\/api\/identity\/(magic-link(?:\/consume)?)$/,'signin'],
 ['POST',/^\/api\/identity\/widget\/session$/,'widget','widgetKey'],
 ['POST',/^\/api\/conversations$/,'start','projectId'],
 ['GET',/^\/(login(?:\/magic)?)\/?$/,'signin',undefined,renderDoor],
 ['GET',/^\/(conversations)(?:\/[^/]{1,200})?\/?$/,'workspace',undefined,renderDoor],
 ['GET',/^\/projects\/((?!create\/)[^/]{1,200})\/(?:activation|articles|contacts|conversations\/[^/]{1,200}|edit|reports)\/?$/,'workspace',undefined,renderDoor],
 ['GET',/^\/(_serverFn)\/[a-f0-9]{64}$/,'workspace',undefined,renderDoor],
]
async function bodyField(request:Request,field:string){
 const value=(await request.clone().json().catch(()=>null) as Record<string,unknown>|null)?.[field]
 return typeof value==='string'&&value.length>0&&value.length<=200?value:undefined
}

/** The object's answer to a dispatched request, or null for every other request. A demo visitor's copy already
 * runs inside a Durable Object, so its requests stay where they are. */
export async function dispatchRequest(request:Request,env:Env,path:string):Promise<Response|null>{
 // The build-only asset renderer has no application bindings. The demo is already inside an object.
 if(!env.CONVERSATIONS||demoMode(env))return null
 const route=dispatched.find(([method,pattern])=>request.method===method&&pattern.test(path))
 if(!route)return null
 const [,pattern,object,field,door=dispatchDoor]=route,subject=field?await bodyField(request,field):pattern.exec(path)![1]
 if(!subject)return null
 // The entry alone names the address the client asked for; a client's own copy of the header is replaced.
 const forwarded=new Request(door,request)
 forwarded.headers.set(dispatchedUrl,request.url)
 // An object that cannot be reached (it is reset while a release replaces its code) answers busy. A send that
 // had already committed is replayed, not repeated, when the client sends it again with the same local id.
 return env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(`${object}:${subject}`)).fetch(forwarded).catch(()=>{
  console.error('Durable Object unavailable for a dispatched request')
  const answer=overloadAnswer(request)
  return Response.json(answer.body,{status:answer.status,headers:{...answer.headers,'Cache-Control':'no-store'}})
 })
}
