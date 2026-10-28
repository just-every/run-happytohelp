import {runScheduled} from '../../src/jobs'
import {Hono} from 'hono'
import {app} from '../../src/app'
import {dispatchIntegrations} from '../../src/modules/api-integrations/dispatch'
export {ConversationSocket} from '../../src/modules/conversations/socket'
const tests=new Hono<any>()
tests.post('/_test/scheduled',async c=>{await runScheduled(c.env);return c.json({scheduled:true})})
tests.post('/_test/dispatch',async c=>{await dispatchIntegrations(c.env,(await c.req.json()).projectId);return c.json({dispatched:true})})
export default {fetch(request:Request,env:any,ctx:ExecutionContext){return new URL(request.url).pathname.startsWith('/_test/')?tests.fetch(request,env,ctx):app.fetch(request,env,ctx)}}
