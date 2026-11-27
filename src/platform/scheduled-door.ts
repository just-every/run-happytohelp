import type {Env} from './env'
import {workflowEnvironment} from '../modules/workflows/clock'

// A minute's due work costs more CPU than a Cron invocation holds on Workers Free (10 ms), and a Queue delivery
// has that same allowance. The tick (scheduled-tick.ts) therefore asks one Durable Object, whose request has the
// Durable Object CPU allowance, to run the whole ordered pass. The object is the conversation class's
// `scheduled:pass`; it stores nothing and holds no sockets. The Worker entry exports the object's class, so this
// file stays free of the pass: it loads when a tick arrives.
const scheduledDoor='https://conversation.internal/scheduled'
interface ScheduledPass {maintenance:boolean;workflowScope:'all'|'time'|null}

/** The tick's side. A failed pass fails the tick, as it did when the pass ran in the Cron invocation; nothing
 * retries it, and the next minute's tick discovers whatever is still due. */
export async function requestScheduledPass(env:Env,pass:ScheduledPass){
 const answer=await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName('scheduled:pass')).fetch(scheduledDoor,{method:'POST',body:JSON.stringify(pass)})
 if(!answer.ok)throw new Error('Scheduled work failed')
}

/** Only the Worker's own code can address the internal door; a socket upgrade arrives with its public address. */
export const isScheduledPass=(url:URL)=>url.origin+url.pathname===scheduledDoor

/** The object's side. The pass has this request's own statement budget; only the local clock read precedes it. */
export async function receiveScheduledPass(request:Request,env:Env):Promise<Response>{
 const pass=await request.json<ScheduledPass>()
 const discoveryStatements=String(env.H2H_LOCAL)==='true'&&env.H2H_WORKFLOW_NOW===undefined?1:0
 const {runScheduledInvocation}=await import('./scheduled')
 try{await runScheduledInvocation(await workflowEnvironment(env),{now:Date.now(),maintenance:pass.maintenance,discoveryStatements,workflowScope:pass.workflowScope})}
 catch(error){console.error('Scheduled work failed',error);return new Response('failed',{status:500})}
 return new Response('ok')
}
