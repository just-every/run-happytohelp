import worker from './app-worker'
import {publicSiteRoutes,isPublicSitePath,publicHelpHostResponse} from '../../../src/modules/public-site'
import type {Env} from '../../../src/platform/env'
export {ConversationSocket} from './app-worker'
export default {...worker,async fetch(request:Request,env:Env,context:ExecutionContext){
 const host=await publicHelpHostResponse(request,env)
 if(host)return host
 if(await isPublicSitePath(new URL(request.url).pathname,env))return publicSiteRoutes.fetch(request,env,context)
 return worker.fetch(request,env,context)
}}
