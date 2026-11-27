import type {Env,Job,LegacyCleanupJob} from './env'

// A Queue delivery has a Worker invocation's CPU allowance (10 ms on Workers Free), and a job costs more than that.
// The consumer therefore hands each message to a Durable Object, whose request has the Durable Object CPU
// allowance, and acknowledges or retries the message as that object answers. The object is the conversation
// class's `job:<type>:<id>`; it stores nothing and holds no sockets. The Worker entry exports the object's class,
// so this file stays free of the jobs: they load when a message arrives.
const jobDoor='https://conversation.internal/job'
type Queued=Job|LegacyCleanupJob

/** The consumer's side. An object that cannot be reached fails the delivery, and the Queue redelivers it. */
export async function deliverJobs(batch:MessageBatch<Queued>,env:Env){
 for(const message of batch.messages){
  const job=message.body
  const answer=await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(`job:${job.type}:${job.id}`)).fetch(jobDoor,{method:'POST',body:JSON.stringify(job)})
  if(answer.ok)message.ack();else message.retry()
 }
}

/** Only the Worker's own code can address the internal door; a socket upgrade arrives with its public address. */
export const isJob=(url:URL)=>url.origin+url.pathname===jobDoor

/** The object's side: the one message, consumed with this request's own statement budget. */
export async function receiveJob(request:Request,env:Env):Promise<Response>{
 const body=await request.json<Queued>();let retry=false
 const {consumeQueue}=await import('../queue')
 await consumeQueue({messages:[{body,ack(){},retry(){retry=true}}]} as unknown as MessageBatch<Queued>,env)
 return new Response(null,{status:retry?503:204})
}
