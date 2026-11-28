import type {Env} from '../../platform/env'
import {canonicalNavigation} from '../../platform/canonical-navigation'
import {withDocumentHeaders} from '../../platform/document-headers'
import {withSecurityHeaders} from '../../platform/security-headers'
import {withCompiledAssetCache} from '../../edition/asset-cache'
import {staticAssetResponse} from '../../base/static-assets'
import {demoMode} from '../../demo/mode'
import {dispatchDoor,dispatchedUrl} from './dispatch-door'
import {forwardSocket} from './socket-door'
import {configuredHelpProject} from '../public-site/help-host-config'

export async function fetchEntry(request:Request,env:Env,execution:ExecutionContext):Promise<Response>{
 const canonical=canonicalNavigation(request,env)
 if(canonical)return canonical
 const {pathname}=new URL(request.url)
 if(pathname!=='/widget.js'){
  const asset=await staticAssetResponse(request,env)
  if(asset)return withDocumentHeaders(withCompiledAssetCache(request,asset))
 }
 // Vite and the binding-free build renderer run locally. A hosted demo already runs inside its visitor's object.
 if(import.meta.env.DEV||demoMode(env)||env.TSS_PRERENDERING==='true')
  return (await import('../../server-fetch')).fetchRequest(request,env,execution)

 // Hibernating sockets belong to their original conversation/project object. Only a configured custom help host
 // checks its host policy inside the application first; a socket proxied through a pool object would keep that
 // object billed for the connection's lifetime, so every other host connects from here.
 if(!configuredHelpProject(request,env)){
  const socket=forwardSocket(request,env,pathname)
  if(socket)return withSecurityHeaders(await socket,'application',env)
 }

 // Spread HTTP traffic over reusable objects without reading a body, choosing a tenant or storing session state.
 const shard=crypto.randomUUID()[0]
 const stub=env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName('http:'+shard))
 const forwarded=new Request(dispatchDoor,request)
 forwarded.headers.set(dispatchedUrl,request.url)
 try{return await stub.fetch(forwarded)}
 catch(error){
  if(!(error instanceof Error&&('retryable' in error||'overloaded' in error)))throw error
  const {overloadAnswer}=await import('../../platform/d1-overload')
  const answer=overloadAnswer(request)
  return withSecurityHeaders(Response.json(answer.body,{status:answer.status,headers:{...answer.headers,'Cache-Control':'no-store'}}),'application',env)
 }
}
