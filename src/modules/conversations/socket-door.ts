import {devAdmitted} from '@runeditrun/rer/modules/operator-auth/dev-admission'
import type {Context} from 'hono'
import {getPath,getQueryParam,tryDecodeURIComponent} from 'hono/utils/url'
import type {LocalAdmission} from '../../platform/auth'
import type {AppEnv,Env} from '../../platform/env'
import {dispatchedUrl,originalRequest} from './dispatch-door'

export const socketDoor='https://conversation.internal/socket'
const socketPath=/^\/api\/(projects|conversations)\/([^/]+)\/socket$/
const localEntryHeader='X-H2H-Socket-Local-Entry'
export type SocketScope={projectId:string;conversationId?:never}|{conversationId:string;projectId?:never}
type Upgrade=(request:Request,scope:SocketScope,token:string)=>Promise<Response>
const acceptSocket=Symbol('acceptSocket')
type SocketEnvironment=Env&LocalAdmission&{[acceptSocket]?:Upgrade}

function bearer(request:Request){return request.headers.get('Authorization')?.replace(/^Bearer /,'')}
function sessionCookie(request:Request){return request.headers.get('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]}

/** Forward directly to the object that owns the hibernating socket. No application or D1 work at the Worker entry. */
export function forwardSocket(request:Request,env:Env,path:string):Promise<Response>|Response|null{
 if(request.method!=='GET'&&request.method!=='HEAD')return null
 const match=socketPath.exec(path.includes('%')?getPath(request):path)
 if(!match)return null
 const url=new URL(request.url),project=match[1]==='projects',origin=request.headers.get('Origin')
 if(project&&origin&&origin!==url.origin)return Response.json({error:'Origin not allowed'},{status:403})
 const id=tryDecodeURIComponent(match[2]),queryToken=getQueryParam(request.url,'token') as string|undefined
 const token=bearer(request)||queryToken||sessionCookie(request)
 if(!token)return Response.json({error:'Authentication required'},{status:401})
 return forwardUpgrade(request,env,project?`project:${id}`:id,token.startsWith('dev_'))
}

async function forwardUpgrade(request:Request,env:Env,name:string,local:boolean){
 // The dev gate is installed only in the local Worker, so carry its decision through the internal door.
 if(local&&!await devAdmitted(request))return Response.json({error:'Local development entry required'},{status:401})
 const forwarded=new Request(socketDoor,request)
 forwarded.headers.set(dispatchedUrl,request.url)
 forwarded.headers.delete(localEntryHeader)
 if(local)forwarded.headers.set(localEntryHeader,'1')
 return env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(name)).fetch(forwarded)
}

/** Retain the existing application admission and CORS checks in the object that accepts the connection. */
export async function receiveSocket(forwarded:Request,env:Env,state:DurableObjectState,upgrade:Upgrade){
 const {dispatchApplicationRequest}=await import('../../app')
 const socketEnv:SocketEnvironment={...env,[acceptSocket]:upgrade}
 const request=originalRequest(forwarded)
 if(request.headers.get(localEntryHeader)==='1'){
  const auth=await import('../../platform/auth')
  socketEnv[auth.localEntryAdmitted]=true
 }
 request.headers.delete(localEntryHeader)
 return dispatchApplicationRequest(request,socketEnv,{waitUntil:work=>state.waitUntil(work),passThroughOnException(){}} as ExecutionContext)
}

export function upgradeSocket(c:Context<AppEnv>,scope:SocketScope){
 const request=c.req.raw,token=c.req.query('token')||bearer(request)||sessionCookie(request)||''
 const upgrade=(c.env as SocketEnvironment)[acceptSocket]
 if(!upgrade)throw new Error('Socket admission requires the owning Durable Object')
 return upgrade(request,scope,token)
}
