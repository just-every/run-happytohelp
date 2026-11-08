/** D1 refuses work with "D1 DB is overloaded" (too many resources consumed within its 10 s
 * window, or requests queued too long). An inbox search is a read that may meet it after a few
 * searches in a row on a large workspace: it is retried as a whole, then answered 503. */
const waits=[250,500,1000]
/** Seconds the client waits after the retries above were also refused. */
export const overloadRetryAfter=3
const overloaded=new WeakSet<Request>()

export function d1Overloaded(error:unknown){
 const seen=new Set<unknown>()
 for(let cause=error;cause&&typeof cause==='object'&&!seen.has(cause);cause=(cause as {cause?:unknown}).cause){
  seen.add(cause)
  const message=(cause as {message?:unknown}).message
  if(typeof message==='string'&&message.includes('D1 DB is overloaded'))return true
 }
 return false
}

/** Either inbox list door read with a search term, exactly as the route reads `q` or `search`. */
export function inboxSearchRead(request:Request){
 if(request.method!=='GET')return false
 const url=new URL(request.url)
 return /^\/api\/dashboard\/(?:projects\/[^/]+\/)?conversations$/.test(url.pathname)&&Boolean((url.searchParams.get('q')||url.searchParams.get('search')||'').trim())
}

/** The error handler's check: an overloaded inbox search is marked for the dispatch to retry. */
export function overloadedInboxSearch(request:Request,error:unknown){
 if(!inboxSearchRead(request)||!d1Overloaded(error))return false
 overloaded.add(request)
 return true
}

/** A search has no body, so dispatching it again re-runs every D1 call it makes, middleware and
 * authentication included, on the same bindings (their per-binding caches stay warm). */
export async function retryOverloadedSearch(request:Request,dispatch:()=>Response|Promise<Response>){
 for(let attempt=0;;attempt++){
  overloaded.delete(request)
  const response=await dispatch()
  if(!overloaded.has(request)||attempt>=waits.length)return response
  await response.body?.cancel()
  await new Promise(resolve=>setTimeout(resolve,waits[attempt]))
 }
}
