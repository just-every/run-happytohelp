import {isAgentPath} from './edition/agent-door/path'
import {canonicalNavigation} from './platform/canonical-navigation'
import {withCompiledAssetCache} from './edition/asset-cache'
import {withWorkspaceModulePreloads} from './edition/module-preloads'
import {withDocumentHeaders} from './platform/document-headers'
import {withDocumentRecovery} from './platform/document-recovery'
import {guardOverload} from './platform/d1-overload'
import {isHonoRequest} from './base/dispatch'
import type {Env} from './platform/env'
import {isPublicSitePath} from './modules/public-site/path'
import {headerSurface,withSecurityHeaders} from './platform/security-headers'
import {loginDocument} from './modules/identity/login-document'
import {staticAssetResponse} from './base/static-assets'
import {widgetAssetOrigin,widgetAssetRequest} from './modules/widget/asset-origin'
import {legacyDocumentationResponse} from './modules/public-site/legacy-docs'
import {withInstallationContact} from './modules/public-site/installation-contact'
import {inboxDocument,projectInboxPath} from './platform/inbox-document'

async function renderDocument(request:Request,execution:ExecutionContext){
 const {default:start}=await import('@tanstack/react-start/server-entry')
 const response=start.fetch(request)
 // In Vite dev a client disconnect during Start's first render can strand its module-load promise.
 if(import.meta.env.DEV)execution.waitUntil(Promise.resolve(response).then(()=>{},()=>{}))
 return response
}

async function route(request:Request,env:Env,execution:ExecutionContext,path:string,publicSite:boolean):Promise<Response>{
 const api=async(input=request)=>(await import('./app')).app.fetch(input,env,execution)
 if(!import.meta.env.DEV&&env.ASSETS&&(request.method==='GET'||request.method==='HEAD')&&projectInboxPath.test(path))return inboxDocument(request,env,api)
 if(isAgentPath(path)||path==='/auth/bootstrap'||path==='/auth/owner-claim'||path==='/auth/signout')return api()
 if(path==='/login'&&request.method==='POST'){
  const login=await loginDocument(request,env,api)
  if(login)return login
 }
 if(path.startsWith('/delegation/')){
  const {isDelegationDocument,delegationDocument}=await import('./edition/delegation/document')
  if(isDelegationDocument(request))return delegationDocument(request,env,execution,()=>renderDocument(request,execution))
  return api()
 }
 if(path.startsWith('/preview/'))return api()
 if(publicSite)return (await import('./modules/public-site')).publicSiteRoutes.fetch(request,env,execution)
 return isHonoRequest(path)?api():renderDocument(request,execution)
}

async function entry(request:Request,env:Env,execution:ExecutionContext):Promise<Response>{
 if(import.meta.env.DEV&&import.meta.env.RER_LOCAL_ORIGIN&&env.H2H_LOCAL==='true'&&!env.RER_INSTALLATION_ID)
  env={...env,APP_ORIGIN:import.meta.env.RER_LOCAL_ORIGIN}
 const canonical=canonicalNavigation(request,env)
 if(canonical)return canonical
 const asset=await staticAssetResponse(widgetAssetRequest(request,env.APP_ORIGIN),env)
 if(asset)return withDocumentHeaders(withCompiledAssetCache(request,await widgetAssetOrigin(request,asset,env.APP_ORIGIN)))
 const documentation=legacyDocumentationResponse(request)
 if(documentation)return withDocumentHeaders(withSecurityHeaders(documentation,'application',env))
 if(env.PUBLIC_HELP_HOSTS){
  const helpHost=await (await import('./modules/public-site/help-host')).publicHelpHostResponse(request,env)
  if(helpHost)return withDocumentHeaders(withSecurityHeaders(await withInstallationContact(request,helpHost,env,true),'embeddable',env))
 }
 const path=new URL(request.url).pathname
 if((request.method==='GET'||request.method==='HEAD')&&(path==='/run'||path==='/contract')){
  const page=(await import('./modules/public-site/runtime-pages')).runtimeSitePage(request)
  if(page)return withDocumentHeaders(withSecurityHeaders(await withInstallationContact(request,page,env),'application',env))
 }
 const publicSite=!path.startsWith('/preview/')&&await isPublicSitePath(path,env)
 const response=await route(request,env,execution,path,publicSite)
 return withDocumentHeaders(withSecurityHeaders(withDocumentRecovery(request,withWorkspaceModulePreloads(request,await withInstallationContact(request,response,env))),headerSurface(path,publicSite),env))
}

export const fetchRequest=(request:Request,env:Env,execution:ExecutionContext)=>guardOverload(request,()=>entry(request,env,execution))
