import type {Context,MiddlewareHandler} from 'hono'
import {d1Overloaded,mayDispatchAgain} from './d1-overload'
/** A read (GET, HEAD) that meets D1's overload is dispatched again as a whole (d1-overload.ts), and a read answered
 * 503 is asked again by its caller. So a read's side effect never runs among its reads:
 * - a record it makes (an analytics event, a read receipt, an audit row) is held until the dispatch has answered,
 *   then written as the dispatch's last D1 statement, every held record in one atomic batch. A dispatch that met an
 *   overload or answers 503 records nothing, and an overload of that batch is an overload of the read: nothing is
 *   recorded and the read is dispatched again;
 * - work that cannot wait for the answer (a single-use token's consumption, a provider's code exchange, an
 *   authorization receipt, a rate counter) runs once per request: a dispatch of the same request again gets the first
 *   dispatch's outcome instead of running it again. */
type Check=(result:D1Result)=>void
interface Held {statements:Map<D1Database,{statement:D1PreparedStatement;check?:Check}[]>}
const held=new WeakMap<Request,Held>()
const settled=new WeakMap<Request,Map<string,Promise<unknown>>>()
const isRead=(request:Request)=>request.method==='GET'||request.method==='HEAD'

/** Record `statement` after this read has answered (see above). `check` sees its result once written and may throw
 * (for example 409 when a guarded insert found its access gone). A request that is never dispatched again (a write,
 * or a read an application dispatches in-process without the overload retry) runs the statement now. */
export async function afterReads(c:Context<any>,statement:D1PreparedStatement,check?:Check){
 const request=c.req.raw,scope=isRead(request)?held.get(request):undefined
 if(!scope){
  if(isRead(request)&&mayDispatchAgain(request))throw new Error('A retried read recorded a write outside its application\'s read-effects scope')
  const result=await statement.run();check?.(result);return
 }
 const db=c.env.DB as D1Database,list=scope.statements.get(db)??[]
 list.push({statement,check});scope.statements.set(db,list)
}

/** The outermost middleware of an application the Worker dispatches to: every other middleware and the handler,
 * with all their D1 reads, run inside it, so the held records are the dispatch's last statements. */
export const readEffects:MiddlewareHandler=async(c,next)=>{
 const request=c.req.raw
 if(!isRead(request))return next()
 const scope:Held={statements:new Map()}
 held.set(request,scope)
 try{await next()}finally{held.delete(request)}
 if(!scope.statements.size||c.res.status===503||c.error&&d1Overloaded(c.error))return
 for(const [db,list] of scope.statements){
  const results=await db.batch(list.map(entry=>entry.statement))
  list.forEach((entry,index)=>entry.check?.(results[index]))
 }
}

/** The first dispatch's outcome of `run` for this request, under `key`, for every dispatch of the same request. A
 * failure is not kept: a dispatch again runs it again. */
export function oncePerRequest<T>(request:Request,key:string,run:()=>Promise<T>):Promise<T>{
 let outcomes=settled.get(request)
 if(!outcomes)settled.set(request,outcomes=new Map())
 const known=outcomes.get(key)
 if(known)return known as Promise<T>
 const outcome=run()
 outcomes.set(key,outcome)
 outcome.catch(()=>{if(outcomes.get(key)===outcome)outcomes.delete(key)})
 return outcome
}
