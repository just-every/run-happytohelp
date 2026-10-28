import {admitMessage} from '../../src/modules/conversations/admission'
import {Hono} from 'hono'
import {app} from '../../src/app'
import {auditDatabase} from '../move-in/sql-audit'
export {ConversationSocket} from '../../src/modules/conversations/socket'
const probes=new Hono<any>()
probes.post('/_test/ai',async c=>{const b=await c.req.json();return c.json(await admitMessage(c.env,{...b,actor:{id:'owner',projectId:'p',role:'owner'},projectId:'p'}))})
export default {async fetch(request:Request,env:any,context:ExecutionContext){
 if(new URL(request.url).pathname.startsWith('/_test/'))return probes.fetch(request,env,context)
 const audit=auditDatabase(env.DB),response=await app.fetch(request,{...env,DB:audit.database},context),body=await response.arrayBuffer(),headers=new Headers(response.headers)
 headers.set('X-Test-Statements',String(audit.reads.length));headers.set('X-Test-Max-Rows',String(Math.max(0,...audit.reads.map(x=>x.rows))))
 return new Response(body,{status:response.status,headers})
}}
