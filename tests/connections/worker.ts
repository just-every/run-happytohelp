import {routeRule} from '../../src/modules/access/route-permissions'
import {consumeQueue} from '../../src/queue'
import {integrationSettings} from '../../src/modules/api-integrations/settings'
import {requesterAdmission,requesterKeys} from '../../src/modules/api-integrations/requester-admission'
import {boundedDatabase} from '../../src/platform/d1-budget'
import {runScheduled} from '../../src/jobs'
import {raceDatabase} from './race-db'
import {Hono} from 'hono'
import {app} from '../../src/app'
import {api} from '../../src/modules/api-integrations/routes'
import {memberErasureRegistry} from '../../src/modules/management/member-erasure'
import {dispatchIntegrations} from '../../src/modules/api-integrations/dispatch'
export {ConversationSocket} from '../../src/modules/conversations/socket'
const tests=new Hono<any>()
tests.get('/_test/api001-role-inventory',c=>c.json({unclassified:[...new Set(app.routes.filter(route=>!['GET','HEAD','OPTIONS','ALL'].includes(route.method)&&routeRule(route.method,route.path)===undefined).map(route=>`${route.method} ${route.path}`))],helpscout:app.routes.filter(route=>['GET','PUT','POST','DELETE'].includes(route.method)&&route.path.includes('helpscout')).map(route=>({method:route.method,path:route.path,permission:routeRule(route.method,route.path)}))}))
tests.get('/_test/credential-routes',c=>c.json(integrationSettings.routes.map(({method,path})=>({method,path}))))
tests.get('/_test/member-schema',async c=>{const registry=await memberErasureRegistry(c.env.DB);return c.json({errors:registry.errors,entries:Object.fromEntries(Object.entries(registry.entries).map(([name,entry])=>[name,{level:entry.level,accountOnly:!!entry.accountOnly}]))})})
tests.get('/_test/admission-plan',async c=>{const query=requesterAdmission('p',requesterKeys('p',[{kind:'email',value:'synthetic-hh-scale@example.test'}]));const result=await c.env.DB.prepare(query.state.sql).bind(...query.state.params).all();const plan=await c.env.DB.prepare('EXPLAIN QUERY PLAN '+query.state.sql).bind(...query.state.params).all();return c.json({result,plan:plan.results})})
tests.get('/_test/api-routes',c=>c.json(api.routes.map(({method,path})=>({method,path}))))
tests.post('/_test/scheduled-metered',async c=>{const budget=boundedDatabase(c.env.DB);await runScheduled({...c.env,DB:budget.database});return c.json(budget.metrics)})
tests.post('/_test/scheduled',async c=>{await runScheduled(c.env);return c.json({scheduled:true})})
tests.post('/_test/dispatch',async c=>{await dispatchIntegrations(c.env,(await c.req.json()).projectId);return c.json({dispatched:true})})
tests.post('/_test/race',async c=>{const b=await c.req.json(),db=raceDatabase(c.env.DB,b.race,b.match,b.skipBatches||0);return app.fetch(new Request('https://app.example'+b.path,{method:b.method||'POST',headers:c.req.raw.headers,body:JSON.stringify(b.body)}),{...c.env,DB:db},c.executionCtx)})
tests.post('/_test/dispatch-race',async c=>{const b=await c.req.json();await dispatchIntegrations({...c.env,DB:raceDatabase(c.env.DB,b.race,b.match)},b.projectId||'p');return c.json({dispatched:true})})
function meteredDatabase(db:D1Database){
 const metrics={rows_read:0,statements:0},raw=new WeakMap<object,D1PreparedStatement>()
 const record=(r:any)=>{metrics.rows_read+=r?.meta?.rows_read??0;metrics.statements++;return r}
 const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>{const proxy={bind:(...args:any[])=>wrap(statement.bind(...args)),all:async()=>record(await statement.all()),run:async()=>record(await statement.run()),first:async(column?:string)=>{const r=record(await statement.all());return column?r.results[0]?.[column]??null:r.results[0]??null},raw:async()=>{throw Error('Use metered D1 results')}} as D1PreparedStatement;raw.set(proxy,statement);return proxy}
 return {metrics,database:{prepare:(sql:string)=>wrap(db.prepare(sql)),batch:async(statements:D1PreparedStatement[])=>(await db.batch(statements.map(s=>raw.get(s)??s))).map(record)} as D1Database}
}
export default {async fetch(request:Request,env:any,ctx:ExecutionContext){
 const queue:any[]=[];env={...env,JOBS:{send:async(job:any)=>{queue.push(job)}}}
 if(new URL(request.url).pathname==='/_test/queue'){const jobs=await request.json<any[]>(),retried:number[]=[];await consumeQueue({messages:jobs.map((body,i)=>({id:String(i),body,ack(){},retry(){retried.push(i)}}))} as any,env);return Response.json({retried},{headers:{'X-Test-Queued':JSON.stringify(queue)}})}
 if(request.headers.get('X-Test-Meter')==='1'){
  const meter=meteredDatabase(env.DB),response=await app.fetch(request,{...env,DB:meter.database},ctx),out=new Response(response.body,response)
  out.headers.set('X-Test-D1',JSON.stringify(meter.metrics));return out
 }
 const response=await (new URL(request.url).pathname.startsWith('/_test/')?tests.fetch(request,env,ctx):app.fetch(request,env,ctx));const out=new Response(response.body,response);out.headers.set('X-Test-Queued',JSON.stringify(queue));return out}}
