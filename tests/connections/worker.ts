import {integrationSettings} from '../../src/modules/api-integrations/settings'
import {requesterAdmission,requesterKeys} from '../../src/modules/api-integrations/requester-admission'
import {boundedDatabase} from '../../src/platform/d1-budget'
import {runScheduled} from '../../src/jobs'
import {raceDatabase} from './race-db'
import {Hono} from 'hono'
import {app} from '../../src/app'
import {api} from '../../src/modules/api-integrations/routes'
import {memberErasureRegistry,unclassifiedMemberTables} from '../../src/modules/management/member-erasure'
import {dispatchIntegrations} from '../../src/modules/api-integrations/dispatch'
export {ConversationSocket} from '../../src/modules/conversations/socket'
const tests=new Hono<any>()
tests.get('/_test/credential-routes',c=>c.json(integrationSettings.routes.map(({method,path})=>({method,path}))))
tests.get('/_test/member-schema',async c=>{const registry=await memberErasureRegistry(c.env.DB);return c.json({errors:registry.errors,entries:Object.fromEntries(Object.entries(registry.entries).map(([name,entry])=>[name,{level:entry.level,accountOnly:!!entry.accountOnly}]))})})
tests.get('/_test/admission-plan',async c=>{const query=requesterAdmission('p',requesterKeys('p',[{kind:'email',value:'synthetic-hh-scale@example.test'}]));const result=await c.env.DB.prepare(query.state.sql).bind(...query.state.params).all();const plan=await c.env.DB.prepare('EXPLAIN QUERY PLAN '+query.state.sql).bind(...query.state.params).all();return c.json({result,plan:plan.results})})
tests.get('/_test/api-routes',c=>c.json(api.routes.map(({method,path})=>({method,path}))))
tests.get('/_test/member-inventory',async c=>c.json(await unclassifiedMemberTables(c.env.DB)))
tests.post('/_test/scheduled-metered',async c=>{const budget=boundedDatabase(c.env.DB);await runScheduled({...c.env,DB:budget.database});return c.json(budget.metrics)})
tests.post('/_test/scheduled',async c=>{await runScheduled(c.env);return c.json({scheduled:true})})
tests.post('/_test/dispatch',async c=>{await dispatchIntegrations(c.env,(await c.req.json()).projectId);return c.json({dispatched:true})})
tests.post('/_test/race',async c=>{const b=await c.req.json(),db=raceDatabase(c.env.DB,b.race,b.match,b.skipBatches||0);return app.fetch(new Request('https://app.example'+b.path,{method:b.method||'POST',headers:c.req.raw.headers,body:JSON.stringify(b.body)}),{...c.env,DB:db},c.executionCtx)})
tests.post('/_test/dispatch-race',async c=>{const b=await c.req.json();await dispatchIntegrations({...c.env,DB:raceDatabase(c.env.DB,b.race,b.match)},b.projectId||'p');return c.json({dispatched:true})})
export default {fetch(request:Request,env:any,ctx:ExecutionContext){return new URL(request.url).pathname.startsWith('/_test/')?tests.fetch(request,env,ctx):app.fetch(request,env,ctx)}}
