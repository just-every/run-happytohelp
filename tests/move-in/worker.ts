import {emailConfigured} from '../../src/modules/integrations/email-provider'
import {app} from '../../src/app'
import {consumeQueue} from '../../src/queue'
import {boundedDatabase} from '../../src/platform/d1-budget'
import type {Env} from '../../src/platform/env'
export {ConversationSocket} from '../../src/modules/conversations/socket'
export default {async fetch(request:Request,env:Env,context:ExecutionContext){const url=new URL(request.url),queue:any[]=[],effects={widget:0};const bindings={...env,JOBS:{send:async(job:any)=>{queue.push(job)}},CONVERSATIONS:{idFromName:(name:string)=>{effects.widget++;return env.CONVERSATIONS.idFromName(name)},get:(id:DurableObjectId)=>env.CONVERSATIONS.get(id)}} as unknown as Env
 if(url.pathname==='/_test/configured')return Response.json({mail:emailConfigured(bindings),model:typeof bindings.OPENAI_API_KEY==='string'&&bindings.OPENAI_API_KEY.length>0})
 if(url.pathname==='/_test/queue'){const jobs=await request.json<any[]>(),acked:any[]=[],retried:any[]=[],result=await consumeQueue({messages:jobs.map((body,i)=>({id:String(i),body,ack(){acked.push(i)},retry(){retried.push(i)}}))} as any,bindings);return Response.json({...result,queue,acked,retried,effects})}
 const budget=boundedDatabase(bindings.DB),response=await app.fetch(request,{...bindings,DB:budget.database},context),headers=new Headers(response.headers);headers.set('X-Test-Widget-Effects',String(effects.widget));headers.set('X-Test-Statements',String(budget.statements));headers.set('X-Test-Writes',String(budget.writes));headers.set('X-Test-Limits',JSON.stringify(budget.metrics));headers.set('X-Test-Queued',JSON.stringify(queue));return new Response(response.body,{status:response.status,headers})
}}
