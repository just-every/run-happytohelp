import type {Env} from '../../platform/env'

// The Durable Object's side of a dispatched request (request-dispatch.ts). The Worker entry exports the object's
// class, so this file stays free of the application: the application loads when a request arrives.
export const dispatchDoor='https://conversation.internal/dispatch'
export const renderDoor='https://conversation.internal/render'
export const dispatchedUrl='X-H2H-Dispatched-Url'

/** Only the Worker entry can address the internal door; a socket upgrade arrives with its public address. */
export const isDispatched=(url:URL)=>url.origin+url.pathname===dispatchDoor

export function originalRequest(forwarded:Request){
 const request=new Request(forwarded.headers.get(dispatchedUrl)!,forwarded)
 request.headers.delete(dispatchedUrl)
 return request
}

/** The client's request as it arrived, answered by the application inside this object's invocation. */
export async function receiveDispatched(forwarded:Request,env:Env,state:DurableObjectState):Promise<Response>{
 const {app}=await import('../../app')
 return app.fetch(originalRequest(forwarded),env,{waitUntil:work=>state.waitUntil(work),passThroughOnException(){}} as ExecutionContext)
}
