import type {ErrorHandler,Hono} from 'hono'
import {busyPage,busyPageHeaders} from '../modules/public-site/busy-page'
/** D1 can refuse work under load or during a transient storage interruption.
 * Retry the whole read after a short wait, including middleware and authentication.
 * If the read is still unavailable, answer 503 with Retry-After. Writes are never
 * re-run. Only an explicit overload refusal gets the busy response for a write. */
const waits=[250,500,1000]
/** Seconds the client waits after the retries above were also refused. */
export const overloadRetryAfter=3
const overloaded=new WeakSet<Request>()
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const read=(request:Request)=>request.method==='GET'||request.method==='HEAD'

export function d1TemporarilyUnavailable(error:unknown,readOnly=true){
 const seen=new Set<unknown>()
 for(let cause=error;cause&&typeof cause==='object'&&!seen.has(cause);cause=(cause as {cause?:unknown}).cause){
  seen.add(cause)
  const message=(cause as {message?:unknown}).message
  if(typeof message!=='string')continue
  if(message.includes('D1 DB is overloaded'))return true
  if(readOnly&&/^D1_ERROR:\s*(?:Network connection lost|D1 DB reset because its code was updated|Internal error (?:in D1 DB storage|while starting up D1 DB storage) caused object to be reset|Cannot resolve D1 DB due to transient issue on remote node)\b/i.test(message))return true
 }
 return false
}

/** Either inbox list door read with a search term, exactly as the route reads `q` or `search`. */
function inboxSearchRead(request:Request){
 if(request.method!=='GET')return false
 const url=new URL(request.url)
 return /^\/api\/dashboard\/(?:projects\/[^/]+\/)?conversations$/.test(url.pathname)&&Boolean((url.searchParams.get('q')||url.searchParams.get('search')||'').trim())
}
const busyMessage=(request:Request)=>inboxSearchRead(request)?'Search is busy. Try again in a few seconds.':'The workspace is busy. Try again in a few seconds.'
export const overloadAnswer=(request:Request)=>({body:{error:busyMessage(request)},status:503 as const,headers:{'Retry-After':String(overloadRetryAfter)}})

/** The error handler's check: a request that met an overload is marked for the dispatch to retry. */
export function overloadedRequest(request:Request,error:unknown){
 if(!d1TemporarilyUnavailable(error,read(request)))return false
 overloaded.add(request)
 return true
}

const redispatched=new WeakSet<Request>()
/** A read whose dispatch may run again as a whole: its side effects follow platform/read-effects.ts. */
export const mayDispatchAgain=(request:Request)=>redispatched.has(request)

/** A read has no body, so dispatching it again re-runs every D1 call it makes on the same bindings (their
 * per-binding caches stay warm). A dispatch answers, never throws, an overload: callers never nest this. */
export async function retryOverloaded(request:Request,dispatch:()=>Response|Promise<Response>){
 if(read(request))redispatched.add(request)
 for(let attempt=0;;attempt++){
  overloaded.delete(request)
  const response=await dispatch()
  if(!overloaded.has(request)||!read(request)||attempt>=waits.length)return response
  await response.body?.cancel()
  await sleep(waits[attempt])
 }
}

/** A browser's own page load: a read that accepts HTML, other than a script's fetch (the Help Center's progressive
 * navigation sends Accept: text/html from fetch, Sec-Fetch-Mode: cors, and keeps the cheap JSON answer). */
function pageLoad(request:Request){
 const mode=request.headers.get('Sec-Fetch-Mode')
 return read(request)&&Boolean(request.headers.get('Accept')?.includes('text/html'))&&(!mode||mode==='navigate')
}
const busyResponse=(request:Request)=>{
 if(pageLoad(request)){const url=new URL(request.url);return new Response(busyPage(overloadRetryAfter,url.pathname+url.search),{status:503,headers:busyPageHeaders(overloadRetryAfter)})}
 const answer=overloadAnswer(request);return Response.json(answer.body,{status:answer.status,headers:{...answer.headers,'Cache-Control':'no-store'}})
}

/** A Hono app the Worker entry dispatches to directly (the public site, the help host) follows the same rule as
 * the application: its error handler marks a request that met an overload and answers busy (any other error
 * keeps the app's own handler, which Hono's types keep private), and its fetch retries a read as a whole. */
export function answerOverloads(app:Hono<any,any,any>){
 const own=(app as unknown as {errorHandler:ErrorHandler}).errorHandler,dispatchOnce=app.fetch
 app.onError((error,c)=>overloadedRequest(c.req.raw,error)?busyResponse(c.req.raw):own(error,c))
 app.fetch=(request,...rest)=>retryOverloaded(request,()=>dispatchOnce(request,...rest))
}

/** The Worker entry reads D1 before any application route (public site and help host lookups): an overload
 * thrown there re-runs a read the same way and otherwise answers 503. */
export async function guardOverload(request:Request,run:()=>Promise<Response>){
 for(let attempt=0;;attempt++){
  try{return await run()}
  catch(error){
   if(!d1TemporarilyUnavailable(error,read(request)))throw error
   if(!read(request)||attempt>=waits.length)return busyResponse(request)
   await sleep(waits[attempt])
  }
 }
}
