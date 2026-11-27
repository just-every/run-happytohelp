import type {Env} from '../../platform/env'

// The conversation object's side of a dispatched message send (send-dispatch.ts). The Worker entry exports the
// object's class, so this file stays free of the application: the application loads when a send arrives.
export const sendDoor='https://conversation.internal/send'
export const sentUrl='X-H2H-Send-Url'

/** Only the Worker entry can address the internal door; a socket upgrade arrives with its public address. */
export const isSend=(url:URL)=>url.origin+url.pathname===sendDoor

/** The client's request as it arrived, answered by the application inside this object's invocation. */
export async function receiveSend(forwarded:Request,env:Env,state:DurableObjectState):Promise<Response>{
 const request=new Request(forwarded.headers.get(sentUrl)!,forwarded)
 request.headers.delete(sentUrl)
 const {app}=await import('../../app')
 return app.fetch(request,env,{waitUntil:work=>state.waitUntil(work),passThroughOnException(){}} as ExecutionContext)
}
