// Demo mode first: it guards fetch before any other module can keep it (DEMO.md).
import {withDemo} from './vendor/base/modules/demo/index.mjs'
import {demoOwner,seedDemo} from './demo'
import {canonicalNavigation} from './platform/canonical-navigation'
import {withCompiledAssetCache} from './edition/asset-cache'
import {withWorkspaceModulePreloads} from './edition/module-preloads'
import {withDocumentHeaders} from './platform/document-headers'
import {consumeQueue} from './queue'
import start from '@tanstack/react-start/server-entry'
import type { Env,Job } from './platform/env'
import { app } from './app'
import { runScheduled } from './jobs'
import {dispatchOperatorNotifications} from './modules/integrations/notifications'
import {purgeExpiredAudit} from './modules/audit/retention'
import { dispatch } from './base/dispatch'
import { publicSiteRoutes,isPublicSitePath,publicHelpHostResponse } from './modules/public-site'
import { handleEmail } from './modules/integrations'
import { headerSurface,withSecurityHeaders } from './platform/security-headers'
import { delegationDocument,isDelegationDocument } from './edition/delegation/document'
import {loginDocument} from './modules/identity/login-document'
import {staticAssetResponse} from './base/static-assets'
import {widgetAssetOrigin,widgetAssetRequest} from './modules/widget/asset-origin'
import {legacyDocumentationResponse} from './modules/public-site/legacy-docs'
export { ConversationSocket } from './modules/conversations/socket'
// vite dev only: TanStack Start memoizes its module-load promise inside the first document request's runner call, so a client abort mid-load wedges every later document; keep the render alive past a disconnect.
async function keepDevRenderAlive(request:Request,execution:ExecutionContext):Promise<Response>{const response=start.fetch(request);if(import.meta.env.DEV)execution.waitUntil(Promise.resolve(response).then(()=>{},()=>{}));return response}
async function route(request:Request,env:Env,execution:ExecutionContext,path:string,publicSite:boolean):Promise<Response>{

 if(path==='/auth/bootstrap'||path==='/auth/owner-claim')return app.fetch(request,env,execution);
 const login=await loginDocument(request,env,request=>app.fetch(request,env,execution));if(login)return login;
 if(isDelegationDocument(request))return delegationDocument(request,env,execution,()=>keepDevRenderAlive(request,execution));if(path.startsWith('/delegation/'))return app.fetch(request,env,execution);if(path.startsWith('/preview/'))return app.fetch(request,env,execution);if(publicSite)return publicSiteRoutes.fetch(request,env,execution);return dispatch(request,()=>app.fetch(request,env,execution),()=>keepDevRenderAlive(request,execution))
}
export default withDemo({
 async fetch(request:Request,env:Env,execution:ExecutionContext){if(import.meta.env.DEV && import.meta.env.RER_LOCAL_ORIGIN && env.H2H_LOCAL==='true' && !env.RER_INSTALLATION_ID)env={...env,APP_ORIGIN:import.meta.env.RER_LOCAL_ORIGIN};const canonical=canonicalNavigation(request,env);if(canonical)return canonical;const asset=await staticAssetResponse(widgetAssetRequest(request,env.APP_ORIGIN),env);if(asset)return withDocumentHeaders(withCompiledAssetCache(request,await widgetAssetOrigin(request,asset,env.APP_ORIGIN)));const documentation=legacyDocumentationResponse(request);if(documentation)return withDocumentHeaders(withSecurityHeaders(documentation,'application',env));const helpHost=await publicHelpHostResponse(request,env);if(helpHost)return withDocumentHeaders(withSecurityHeaders(helpHost,'embeddable',env));const path=new URL(request.url).pathname,publicSite=!path.startsWith('/preview/')&&await isPublicSitePath(path,env);
 return withDocumentHeaders(withSecurityHeaders(withWorkspaceModulePreloads(request,await route(request,env,execution,path,publicSite)),headerSurface(path,publicSite),env))},
 async queue(batch:MessageBatch<Job>,env:Env){await consumeQueue(batch,env)},
 // Fixed invocation reservations: jobs 940, operator mail 54, audit 6. Each
 // branch admits complete units before using its share (platform/scheduled-budget).
 async scheduled(_event:ScheduledController,env:Env){await Promise.all([runScheduled(env),dispatchOperatorNotifications(env),purgeExpiredAudit(env)])},
 email:handleEmail,
} satisfies ExportedHandler<Env,Job>,{seed:seedDemo,owner:demoOwner})
